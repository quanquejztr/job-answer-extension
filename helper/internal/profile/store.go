package profile

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"jobanswer/helper/internal/limits"
)

// Store is the helper-owned profile store. Every mutation is a
// read-modify-write under an exclusive advisory file lock, so separate
// processes (the host is spawned per request) cannot lose updates.
type Store struct {
	dir string
	fs  FS
	now func() time.Time
}

// NewStore returns a store rooted at the absolute directory dir. A nil clock
// or filesystem selects time.Now and the real filesystem. It touches nothing
// on disk.
func NewStore(dir string, now func() time.Time, fsys FS) (*Store, error) {
	if dir == "" || !filepath.IsAbs(dir) {
		return nil, ErrUnsafePath
	}
	if now == nil {
		now = time.Now
	}
	if fsys == nil {
		fsys = OSFS{}
	}
	return &Store{dir: filepath.Clean(dir), fs: fsys, now: now}, nil
}

func (s *Store) path() string { return filepath.Join(s.dir, FileName) }

// opError keeps errors.Is(err, ErrStorage) true without any detail from
// the underlying error.
type opError struct{ op string }

func (e opError) Error() string        { return ErrStorage.Error() + ": " + e.op }
func (e opError) Is(target error) bool { return target == ErrStorage }

func fail(op string) error { return opError{op} }

// checkDir validates the data directory. It returns exists=false if absent.
func (s *Store) checkDir() (exists bool, err error) {
	info, err := s.fs.Lstat(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fail("stat directory")
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return false, ErrUnsafePath
	}
	if info.Mode().Perm()&0o022 != 0 || !ownedBy(info, s.fs.UID()) {
		return false, ErrUnsafePath
	}
	return true, nil
}

// checkFile validates profile.json. It returns exists=false if absent.
func (s *Store) checkFile() (exists bool, err error) {
	info, err := s.fs.Lstat(s.path())
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fail("stat file")
	}
	if !info.Mode().IsRegular() {
		return false, ErrUnsafePath
	}
	if info.Mode().Perm()&0o022 != 0 || !ownedBy(info, s.fs.UID()) {
		return false, ErrUnsafePath
	}
	return true, nil
}

func (s *Store) ensureDir() error {
	exists, err := s.checkDir()
	if err != nil {
		return err
	}
	if !exists {
		if err := s.fs.MkdirAll(s.dir, 0o700); err != nil {
			return fail("create directory")
		}
		if err := s.fs.Chmod(s.dir, 0o700); err != nil { // independent of umask
			return fail("chmod directory")
		}
		if exists, err = s.checkDir(); err != nil || !exists {
			if err == nil {
				err = fail("create directory")
			}
			return err
		}
	}
	return nil
}

// read loads the profile; an absent file yields an empty profile.
func (s *Store) read() (*Profile, error) {
	exists, err := s.checkFile()
	if err != nil {
		return nil, err
	}
	if !exists {
		return emptyProfile(), nil
	}
	f, err := s.fs.OpenFile(s.path(), os.O_RDONLY, 0)
	if err != nil {
		return nil, fail("open file")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, fail("stat file")
	}
	if !info.Mode().IsRegular() {
		return nil, ErrUnsafePath
	}
	if info.Size() > limits.MaxProfileBytes {
		return nil, ErrTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(f, limits.MaxProfileBytes+1))
	if err != nil {
		return nil, fail("read file")
	}
	if len(data) > limits.MaxProfileBytes {
		return nil, ErrTooLarge
	}
	return decodeProfile(data)
}

// Load returns a copy of the profile. If the file is absent it returns an
// empty valid profile and writes nothing.
func (s *Store) Load() (*Profile, error) {
	exists, err := s.checkDir()
	if err != nil {
		return nil, err
	}
	if !exists {
		return emptyProfile(), nil
	}
	p, err := s.read()
	if err != nil {
		return nil, err
	}
	return p.clone(), nil
}

// mutate runs fn on the current profile under the exclusive lock and writes
// the result atomically. On any error nothing is changed on disk.
func (s *Store) mutate(fn func(p *Profile, now string) error) error {
	if err := s.ensureDir(); err != nil {
		return err
	}
	unlock, err := s.fs.Lock(filepath.Join(s.dir, LockFileName))
	if err != nil {
		if errors.Is(err, ErrUnsafePath) {
			return err
		}
		return fail("lock")
	}
	defer func() { _ = unlock() }()

	p, err := s.read()
	if err != nil {
		return err
	}
	before := p.ContentChars()
	if err := fn(p, s.now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	p.normalizeNil()
	// The cap is checked on the profile as it would be written, so a replaced
	// item counts its new text instead of its old text. A save that does not
	// grow an already over-cap (hand-edited) profile is still allowed, so the
	// user can delete or shorten content to get back under the cap.
	if after := p.ContentChars(); after > before {
		if err := checkTotal(p); err != nil {
			return err
		}
	}
	if err := validateProfile(p); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false) // keep the on-disk size close to the content size
	enc.SetIndent("", "  ")
	if err := enc.Encode(p); err != nil {
		return fail("encode")
	}
	data := buf.Bytes()
	if len(data) > limits.MaxProfileBytes {
		return exceeded("profile size")
	}
	return s.atomicWrite(data)
}

// atomicWrite replaces profile.json: temp file (O_EXCL, 0600) in the same
// directory, write, fsync, close, rename, fsync directory. Any failure removes
// the temp file and leaves the previous profile.json untouched.
func (s *Store) atomicWrite(data []byte) error {
	// Holding the lock means any leftover temp file is from a crashed writer.
	if names, err := s.fs.ReadDir(s.dir); err == nil {
		for _, n := range names {
			if !strings.HasPrefix(n, tempPrefix) {
				continue
			}
			tp := filepath.Join(s.dir, n)
			if info, err := s.fs.Lstat(tp); err == nil && info.Mode().IsRegular() {
				_ = s.fs.Remove(tp)
			}
		}
	}
	var rnd [8]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return fail("random")
	}
	tmp := filepath.Join(s.dir, tempPrefix+hex.EncodeToString(rnd[:]))
	f, err := s.fs.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fail("create temp")
	}
	cleanup := func(op string) error {
		_ = s.fs.Remove(tmp)
		return fail(op)
	}
	if err := f.Chmod(0o600); err != nil { // independent of umask
		_ = f.Close()
		return cleanup("chmod temp")
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return cleanup("write temp")
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return cleanup("sync temp")
	}
	if err := f.Close(); err != nil {
		return cleanup("close temp")
	}
	if err := s.fs.Rename(tmp, s.path()); err != nil {
		return cleanup("rename")
	}
	if err := s.fs.SyncDir(s.dir); err != nil {
		// The new file is already in place and complete; durability of the
		// rename is unconfirmed, so report failure.
		return fail("sync directory")
	}
	return nil
}

func nextID(p *Profile, prefix string) string {
	id := prefix + strconv.Itoa(p.NextID)
	p.NextID++
	return id
}

// SetResume saves the single résumé (replacing any previous one) and returns
// it. The text is trimmed and validated; the source must be pasted, pdf, or
// docx.
func (s *Store) SetResume(in ResumeInput) (Resume, error) {
	text, source, err := cleanResume(in)
	if err != nil {
		return Resume{}, err
	}
	var out Resume
	err = s.mutate(func(p *Profile, now string) error {
		out = Resume{Text: text, Source: source, UpdatedAt: now}
		r := out
		p.Resume = &r
		return nil
	})
	if err != nil {
		return Resume{}, err
	}
	return out, nil
}

// UpsertStory creates (empty ID) or updates a story and returns it.
func (s *Store) UpsertStory(in StoryInput) (Story, error) {
	var out Story
	title, err := cleanText(in.Title, limits.MaxTitleChars, "story title")
	if err != nil {
		return out, err
	}
	text, err := cleanText(in.Text, limits.MaxStoryChars, "story text")
	if err != nil {
		return out, err
	}
	err = s.mutate(func(p *Profile, now string) error {
		if in.ID == "" {
			if len(p.Stories) >= limits.MaxStories {
				return exceeded("too many stories")
			}
			out = Story{ID: nextID(p, "s_"), Title: title, Text: text, CreatedAt: now, UpdatedAt: now}
			p.Stories = append(p.Stories, out)
			return nil
		}
		for i := range p.Stories {
			if p.Stories[i].ID == in.ID {
				st := &p.Stories[i]
				st.Title, st.Text, st.UpdatedAt = title, text, now
				out = *st
				return nil
			}
		}
		return ErrNotFound
	})
	if err != nil {
		return Story{}, err
	}
	return out, nil
}

// UpsertSample creates or updates a writing sample.
func (s *Store) UpsertSample(in SampleInput) (WritingSample, error) {
	var out WritingSample
	label, err := cleanText(in.Label, limits.MaxLabelChars, "sample label")
	if err != nil {
		return out, err
	}
	text, err := cleanText(in.Text, limits.MaxSampleChars, "sample text")
	if err != nil {
		return out, err
	}
	err = s.mutate(func(p *Profile, now string) error {
		if in.ID == "" {
			if len(p.Samples) >= limits.MaxSamples {
				return exceeded("too many samples")
			}
			out = WritingSample{ID: nextID(p, "w_"), Label: label, Text: text, CreatedAt: now}
			p.Samples = append(p.Samples, out)
			return nil
		}
		for i := range p.Samples {
			if p.Samples[i].ID == in.ID {
				p.Samples[i].Label, p.Samples[i].Text = label, text
				out = p.Samples[i]
				return nil
			}
		}
		return ErrNotFound
	})
	if err != nil {
		return WritingSample{}, err
	}
	return out, nil
}

// UpsertRule creates or updates a writing rule.
func (s *Store) UpsertRule(in RuleInput) (WritingRule, error) {
	var out WritingRule
	if !validRuleKind(in.Kind) {
		return out, invalid("rule kind")
	}
	text, err := cleanText(in.Text, limits.MaxRuleChars, "rule text")
	if err != nil {
		return out, err
	}
	err = s.mutate(func(p *Profile, now string) error {
		if in.ID == "" {
			if len(p.Rules) >= limits.MaxRules {
				return exceeded("too many rules")
			}
			enabled := in.Enabled == nil || *in.Enabled
			out = WritingRule{ID: nextID(p, "r_"), Kind: in.Kind, Text: text, Enabled: enabled}
			p.Rules = append(p.Rules, out)
			return nil
		}
		for i := range p.Rules {
			if p.Rules[i].ID == in.ID {
				r := &p.Rules[i]
				r.Kind, r.Text = in.Kind, text
				if in.Enabled != nil {
					r.Enabled = *in.Enabled
				}
				out = *r
				return nil
			}
		}
		return ErrNotFound
	})
	if err != nil {
		return WritingRule{}, err
	}
	return out, nil
}

// Delete removes one story, sample, or rule. IDs are never reused.
func (s *Store) Delete(kind ItemKind, id string) error {
	switch kind {
	case ItemStory, ItemSample, ItemRule:
	default:
		return invalid("item kind")
	}
	return s.mutate(func(p *Profile, _ string) error {
		switch kind {
		case ItemStory:
			for i := range p.Stories {
				if p.Stories[i].ID == id {
					p.Stories = append(p.Stories[:i], p.Stories[i+1:]...)
					return nil
				}
			}
		case ItemSample:
			for i := range p.Samples {
				if p.Samples[i].ID == id {
					p.Samples = append(p.Samples[:i], p.Samples[i+1:]...)
					return nil
				}
			}
		case ItemRule:
			for i := range p.Rules {
				if p.Rules[i].ID == id {
					p.Rules = append(p.Rules[:i], p.Rules[i+1:]...)
					return nil
				}
			}
		}
		return ErrNotFound
	})
}

// SetProvider records the chosen provider ("claude" or "codex").
func (s *Store) SetProvider(provider string) error {
	if !validProvider(provider) {
		return invalid("provider")
	}
	return s.mutate(func(p *Profile, _ string) error {
		p.Settings.Provider = provider
		return nil
	})
}

// AcceptDisclosure records the time the user accepted the data disclosure.
func (s *Store) AcceptDisclosure() error {
	return s.mutate(func(p *Profile, now string) error {
		p.Settings.DisclosureAcceptedAt = now
		return nil
	})
}

// Export returns a deep copy of the current profile for the user's export
// file. It is Load under another name so the intent is explicit at call sites;
// it never writes, and an absent profile exports as an empty valid profile.
func (s *Store) Export() (*Profile, error) { return s.Load() }

// DeleteAll removes the user's stored data: every leftover
// ".profile.json.tmp-*" file and profile.json, in the data directory, and
// nothing else. The directory itself, bin/, the host binary, and unrelated
// files stay.
//
// The empty ".profile.lock" file is kept on purpose. Another process may hold
// or be waiting on a flock of it right now; unlinking it would let the next
// locker create a new inode and take a second, independent lock, breaking
// mutual exclusion. It holds no user content.
//
// It runs under the same exclusive lock as every write and works whatever
// profile.json holds (corrupt, oversized, unparseable, unknown version): it
// never reads the file. It never follows symlinks. Everything is checked
// before anything is removed, so a symlink, directory, or other non-regular
// entry under a managed name yields ErrUnsafePath with nothing touched, and
// the target of a symlink is never opened (removal unlinks the name only).
//
// Order: temp files first, profile.json last, then fsync of the directory. A
// failure while removing temp files leaves profile.json, so the profile is
// still loadable and the caller can retry; once profile.json is gone only the
// directory fsync can fail, and then ErrStorage means "removed but durability
// unconfirmed", which a retry completes (the directory is synced even when
// nothing is left to remove). An absent profile or
// data directory succeeds and creates nothing.
func (s *Store) DeleteAll() error {
	exists, err := s.checkDir()
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	unlock, err := s.fs.Lock(filepath.Join(s.dir, LockFileName))
	if err != nil {
		if errors.Is(err, ErrUnsafePath) {
			return err
		}
		return fail("lock")
	}
	defer func() { _ = unlock() }()

	names, err := s.fs.ReadDir(s.dir)
	if err != nil {
		return fail("list directory")
	}
	var temps []string
	for _, n := range names {
		if strings.HasPrefix(n, tempPrefix) {
			temps = append(temps, filepath.Join(s.dir, n))
		}
	}
	regular := func(path string) (present bool, err error) {
		info, err := s.fs.Lstat(path)
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		if err != nil {
			return false, fail("stat file")
		}
		if !info.Mode().IsRegular() {
			return false, ErrUnsafePath
		}
		return true, nil
	}
	var doomed []string
	for _, p := range append(temps, s.path()) {
		present, err := regular(p)
		if err != nil {
			return err
		}
		if present {
			doomed = append(doomed, p)
		}
	}
	// doomed ends with profile.json when present, so it is removed last.
	for _, p := range doomed {
		if err := s.fs.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fail("remove file")
		}
	}
	if err := s.fs.SyncDir(s.dir); err != nil {
		return fail("sync directory")
	}
	return nil
}
