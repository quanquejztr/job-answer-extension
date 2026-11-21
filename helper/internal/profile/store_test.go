package profile

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestLoadAbsentWritesNothing(t *testing.T) {
	s, dir := newStore(t)
	p, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if p.SchemaVersion != 2 || p.NextID != 1 || p.Resume != nil || len(p.Stories) != 0 || p.Stories == nil || p.Samples == nil || p.Rules == nil {
		t.Fatalf("unexpected empty profile: %+v", p)
	}
	if _, err := os.Lstat(dir); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("Load created the directory")
	}
	// Existing empty directory: still nothing written.
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
	if n := listDir(t, dir); len(n) != 0 {
		t.Fatalf("Load wrote %v", n)
	}
}

func TestCRUD(t *testing.T) {
	s, _ := newStore(t)
	rs, err := s.SetResume(ResumeInput{Text: "  my resume  ", Source: SourcePasted})
	if err != nil || rs.Text != "my resume" || rs.Source != SourcePasted || rs.UpdatedAt == "" {
		t.Fatalf("resume: %+v %v", rs, err)
	}
	st, err := s.UpsertStory(StoryInput{Title: "T", Text: "story"})
	if err != nil || st.ID != "s_1" || st.CreatedAt != st.UpdatedAt {
		t.Fatalf("story: %+v %v", st, err)
	}
	sm, err := s.UpsertSample(SampleInput{Label: "L", Text: "sample"})
	if err != nil || sm.ID != "w_2" {
		t.Fatalf("sample: %+v %v", sm, err)
	}
	r, err := s.UpsertRule(RuleInput{Kind: KindLength, Text: "short"})
	if err != nil || r.ID != "r_3" || !r.Enabled {
		t.Fatalf("rule: %+v %v", r, err)
	}

	// The résumé has no ID and does not consume the ID counter; saving again
	// replaces it and bumps updatedAt.
	rs2, err := s.SetResume(ResumeInput{Text: "second", Source: SourceDOCX})
	if err != nil || rs2.Text != "second" || rs2.Source != SourceDOCX || rs2.UpdatedAt == rs.UpdatedAt {
		t.Fatalf("resume update: %+v %v", rs2, err)
	}

	// Updates keep id/createdAt and bump updatedAt.
	stb, err := s.UpsertStory(StoryInput{ID: st.ID, Title: "T2", Text: "s2"})
	if err != nil || stb.ID != st.ID || stb.CreatedAt != st.CreatedAt || stb.UpdatedAt == st.UpdatedAt || stb.Text != "s2" {
		t.Fatalf("story update: %+v %v", stb, err)
	}
	smb, err := s.UpsertSample(SampleInput{ID: sm.ID, Label: "L2", Text: "t2"})
	if err != nil || smb.CreatedAt != sm.CreatedAt || smb.Text != "t2" {
		t.Fatalf("sample update: %+v %v", smb, err)
	}
	off := false
	rb, err := s.UpsertRule(RuleInput{ID: r.ID, Kind: KindAvoid, Text: "no", Enabled: &off})
	if err != nil || rb.Enabled || rb.Kind != KindAvoid {
		t.Fatalf("rule update: %+v %v", rb, err)
	}
	rc, _ := s.UpsertRule(RuleInput{ID: r.ID, Kind: KindAvoid, Text: "no2"})
	if rc.Enabled {
		t.Fatal("nil Enabled must leave value unchanged on update")
	}

	// Updating unknown IDs, and a fact kind no longer exists.
	for name, err := range map[string]error{
		"story":  second(s.UpsertStory(StoryInput{ID: "s_50", Title: "t", Text: "x"})),
		"sample": second(s.UpsertSample(SampleInput{ID: "w_50", Label: "l", Text: "x"})),
		"rule":   second(s.UpsertRule(RuleInput{ID: "r_50", Kind: KindTone, Text: "x"})),
		"kind":   s.Delete(ItemKind("fact"), "f_1"),
	} {
		if name == "kind" {
			if !errors.Is(err, ErrInvalidItem) {
				t.Errorf("kind: %v", err)
			}
			continue
		}
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: %v", name, err)
		}
	}

	if err := s.SetProvider("codex"); err != nil {
		t.Fatal(err)
	}
	if err := s.AcceptDisclosure(); err != nil {
		t.Fatal(err)
	}
	p, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if p.Settings.Provider != "codex" || p.Settings.DisclosureAcceptedAt == "" {
		t.Fatalf("settings: %+v", p.Settings)
	}
	if _, err := time.Parse(time.RFC3339, p.Settings.DisclosureAcceptedAt); err != nil {
		t.Fatal(err)
	}
	if p.Resume == nil || p.Resume.Text != "second" || p.Stories[0].CreatedAt[len(p.Stories[0].CreatedAt)-1] != 'Z' {
		t.Fatal("round trip lost the resume or timestamps must be UTC")
	}

	for _, d := range []struct {
		k  ItemKind
		id string
	}{{ItemStory, st.ID}, {ItemSample, sm.ID}, {ItemRule, r.ID}} {
		if err := s.Delete(d.k, d.id); err != nil {
			t.Fatalf("delete %s: %v", d.id, err)
		}
		if err := s.Delete(d.k, d.id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("second delete %s: %v", d.id, err)
		}
	}
	p, _ = s.Load()
	if len(p.Stories)+len(p.Samples)+len(p.Rules) != 0 || p.NextID != 4 || p.Resume == nil {
		t.Fatalf("after deletes: %+v", p)
	}
}

// The saved file is the v2 shape: resume null before a save, no fact fields.
func TestFileShapeIsV2(t *testing.T) {
	s, dir := newStore(t)
	if err := s.SetProvider("claude"); err != nil {
		t.Fatal(err)
	}
	got := string(readFile(t, filepath.Join(dir, FileName)))
	for _, want := range []string{`"schemaVersion": 2`, `"resume": null`, `"stories": []`} {
		if !strings.Contains(got, want) {
			t.Errorf("file lacks %s: %s", want, got)
		}
	}
	for _, bad := range []string{"facts", "tags", "factIds"} {
		if strings.Contains(got, bad) {
			t.Errorf("file contains %s", bad)
		}
	}
}

func second[T any](_ T, err error) error { return err }

func TestLoadReturnsCopy(t *testing.T) {
	s, _ := newStore(t)
	mustStory(t, s, "a")
	if _, err := s.SetResume(ResumeInput{Text: "r", Source: SourcePasted}); err != nil {
		t.Fatal(err)
	}
	p, _ := s.Load()
	p.Stories[0].Text = "mutated"
	p.Resume.Text = "mutated"
	p2, _ := s.Load()
	if p2.Stories[0].Text != "a" || p2.Resume.Text != "r" {
		t.Fatal("Load must return an independent copy")
	}
}

func TestIDsMonotonicNoReuseAcrossReloads(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	open := func() *Store {
		s, err := NewStore(dir, fixedClock(), nil)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := open()
	a := mustStory(t, s, "a")
	b := mustStory(t, s, "b")
	if err := s.Delete(ItemStory, b.ID); err != nil { // delete the highest ID
		t.Fatal(err)
	}
	s = open() // reload
	c := mustStory(t, s, "c")
	if c.ID == b.ID || c.ID == a.ID || c.ID != "s_3" {
		t.Fatalf("ID reused or wrong: %s", c.ID)
	}
	w, _ := s.UpsertSample(SampleInput{Label: "l", Text: "x"})
	if w.ID != "w_4" { // one counter across kinds
		t.Fatalf("sample id %s", w.ID)
	}
	r, _ := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"})
	if r.ID != "r_5" {
		t.Fatalf("rule id %s", r.ID)
	}
	_ = s.Delete(ItemSample, w.ID)
	_ = s.Delete(ItemRule, r.ID)
	_ = s.Delete(ItemStory, a.ID)
	_ = s.Delete(ItemStory, c.ID)
	s = open()
	// Saving the résumé never frees or consumes IDs.
	if _, err := s.SetResume(ResumeInput{Text: "r", Source: SourcePasted}); err != nil {
		t.Fatal(err)
	}
	s = open()
	d := mustStory(t, s, "d")
	if d.ID != "s_6" {
		t.Fatalf("after deleting everything, got %s", d.ID)
	}
	p, _ := s.Load()
	if p.NextID != 7 {
		t.Fatalf("nextId %d", p.NextID)
	}
}

func TestModes(t *testing.T) {
	for _, umask := range []int{0, 0o077, 0o277} {
		t.Run(fmt.Sprintf("umask_%03o", umask), func(t *testing.T) {
			s, dir := newStore(t) // temp root is created before the umask changes
			old := syscall.Umask(umask)
			defer syscall.Umask(old)
			mustStory(t, s, "x")
			mustStory(t, s, "y") // second write replaces the file
			di, _ := os.Stat(dir)
			fi, _ := os.Stat(filepath.Join(dir, FileName))
			if di.Mode().Perm() != 0o700 {
				t.Errorf("dir mode %o", di.Mode().Perm())
			}
			if fi.Mode().Perm() != 0o600 {
				t.Errorf("file mode %o", fi.Mode().Perm())
			}
			li, err := os.Stat(filepath.Join(dir, LockFileName))
			if err != nil || li.Mode().Perm() != 0o600 {
				t.Errorf("lock file: %v", err)
			}
			noTemps(t, dir)
		})
	}
}

func TestCreatesMissingParents(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "a", "b", "data")
	s, _ := NewStore(dir, fixedClock(), nil)
	mustStory(t, s, "x")
	di, _ := os.Stat(dir)
	if di.Mode().Perm() != 0o700 {
		t.Fatalf("mode %o", di.Mode().Perm())
	}
}

func TestAtomicWriteFailures(t *testing.T) {
	for _, op := range []string{"create", "write", "sync", "close", "rename"} {
		t.Run(op, func(t *testing.T) {
			s, dir := newStore(t)
			f := mustStory(t, s, "original")
			path := filepath.Join(dir, FileName)
			before := readFile(t, path)

			bad, _ := NewStore(dir, fixedClock(), &faultFS{failOp: op})
			_, err := bad.UpsertStory(StoryInput{ID: f.ID, Title: "t", Text: "replacement"})
			if !errors.Is(err, ErrStorage) {
				t.Fatalf("got %v, want ErrStorage", err)
			}
			if !bytes.Equal(before, readFile(t, path)) {
				t.Fatal("previous file not byte-identical")
			}
			noTemps(t, dir)
			// The store is usable again afterwards.
			if _, err := s.UpsertStory(StoryInput{ID: f.ID, Title: "t", Text: "after"}); err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("syncdir after rename", func(t *testing.T) {
		s, dir := newStore(t)
		f := mustStory(t, s, "original")
		bad, _ := NewStore(dir, fixedClock(), &faultFS{failOp: "syncdir"})
		if _, err := bad.UpsertStory(StoryInput{ID: f.ID, Title: "t", Text: "replacement"}); !errors.Is(err, ErrStorage) {
			t.Fatalf("got %v", err)
		}
		// The rename already happened: the file is complete and valid, never torn.
		p, err := s.Load()
		if err != nil || (p.Stories[0].Text != "original" && p.Stories[0].Text != "replacement") {
			t.Fatalf("profile unreadable after syncdir failure: %v", err)
		}
		noTemps(t, dir)
	})
	t.Run("first write failure leaves no profile", func(t *testing.T) {
		_, dir := newStore(t)
		bad, _ := NewStore(dir, fixedClock(), &faultFS{failOp: "write"})
		if _, err := bad.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrStorage) {
			t.Fatal(err)
		}
		if _, err := os.Lstat(filepath.Join(dir, FileName)); !errors.Is(err, fs.ErrNotExist) {
			t.Fatal("profile.json must not exist")
		}
		noTemps(t, dir)
	})
	t.Run("stale temp from a crashed writer is removed", func(t *testing.T) {
		s, dir := newStore(t)
		mustStory(t, s, "x")
		stale := filepath.Join(dir, tempPrefix+"deadbeef")
		if err := os.WriteFile(stale, []byte("partial"), 0o600); err != nil {
			t.Fatal(err)
		}
		mustStory(t, s, "y")
		noTemps(t, dir)
	})
}

func TestUnsafePaths(t *testing.T) {
	mk := func(t *testing.T) (string, string) {
		root := t.TempDir()
		return root, filepath.Join(root, "data")
	}
	t.Run("symlinked directory", func(t *testing.T) {
		root, dir := mk(t)
		target := filepath.Join(root, "elsewhere")
		_ = os.Mkdir(target, 0o700)
		if err := os.Symlink(target, dir); err != nil {
			t.Fatal(err)
		}
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("load: %v", err)
		}
		if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("mutate: %v", err)
		}
		if n := listDir(t, target); len(n) != 0 {
			t.Fatalf("wrote through symlink: %v", n)
		}
	})
	t.Run("symlinked file", func(t *testing.T) {
		root, dir := mk(t)
		_ = os.Mkdir(dir, 0o700)
		target := filepath.Join(root, "real.json")
		if err := os.WriteFile(target, []byte(goodEmpty), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, filepath.Join(dir, FileName)); err != nil {
			t.Fatal(err)
		}
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("load: %v", err)
		}
		if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("mutate: %v", err)
		}
		if string(readFile(t, target)) != goodEmpty {
			t.Fatal("target modified")
		}
	})
	t.Run("symlinked lock file", func(t *testing.T) {
		root, dir := mk(t)
		_ = os.Mkdir(dir, 0o700)
		target := filepath.Join(root, "lock-target")
		_ = os.WriteFile(target, nil, 0o600)
		_ = os.Symlink(target, filepath.Join(dir, LockFileName))
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); err == nil {
			t.Fatal("expected refusal")
		}
	})
	t.Run("directory is a regular file", func(t *testing.T) {
		_, dir := mk(t)
		_ = os.WriteFile(dir, []byte("x"), 0o600)
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("profile.json is a directory", func(t *testing.T) {
		_, dir := mk(t)
		_ = os.MkdirAll(filepath.Join(dir, FileName), 0o700)
		_ = os.Chmod(dir, 0o700)
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("profile.json is a fifo", func(t *testing.T) {
		_, dir := mk(t)
		_ = os.Mkdir(dir, 0o700)
		if err := syscall.Mkfifo(filepath.Join(dir, FileName), 0o600); err != nil {
			t.Skip("mkfifo unavailable")
		}
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("got %v", err)
		}
	})
	for _, mode := range []fs.FileMode{0o770, 0o707, 0o777, 0o720} {
		t.Run(fmt.Sprintf("dir mode %o", mode), func(t *testing.T) {
			_, dir := mk(t)
			_ = os.Mkdir(dir, 0o700)
			_ = os.Chmod(dir, mode)
			s, _ := NewStore(dir, fixedClock(), nil)
			if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("load: %v", err)
			}
			if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("mutate: %v", err)
			}
			if n := listDir(t, dir); len(n) != 0 {
				t.Fatalf("wrote into unsafe dir: %v", n)
			}
		})
	}
	t.Run("group-writable file", func(t *testing.T) {
		_, dir := mk(t)
		_ = writeRaw(dir, goodEmpty)
		_ = os.Chmod(filepath.Join(dir, FileName), 0o660)
		s, _ := NewStore(dir, fixedClock(), nil)
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("not owned by current user", func(t *testing.T) {
		_, dir := mk(t)
		_ = os.Mkdir(dir, 0o700)
		s, _ := NewStore(dir, fixedClock(), &faultFS{uid: os.Geteuid() + 1})
		if _, err := s.Load(); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("relative or empty base", func(t *testing.T) {
		for _, d := range []string{"", "rel/dir"} {
			if _, err := NewStore(d, nil, nil); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("%q: %v", d, err)
			}
		}
	})
}

func TestConcurrentWritersAcrossStoreInstances(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	const workers, each = 6, 4
	var wg sync.WaitGroup
	ids := make(chan string, workers*each*2)
	errc := make(chan error, workers*each*2)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			s, err := NewStore(dir, time.Now, nil) // separate instance per goroutine
			if err != nil {
				errc <- err
				return
			}
			for i := 0; i < each; i++ {
				st, err := s.UpsertStory(StoryInput{Title: "t", Text: fmt.Sprintf("w%d-%d", w, i)})
				if err != nil {
					errc <- err
					continue
				}
				ids <- st.ID
				if i%2 == 0 {
					r, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"})
					if err != nil {
						errc <- err
						continue
					}
					ids <- r.ID
				}
			}
		}(w)
	}
	wg.Wait()
	close(ids)
	close(errc)
	for err := range errc {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for id := range ids {
		if seen[id] {
			t.Fatalf("duplicate id %s", id)
		}
		seen[id] = true
	}
	s, _ := NewStore(dir, nil, nil)
	p, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Stories) != workers*each {
		t.Fatalf("lost updates: %d stories, want %d", len(p.Stories), workers*each)
	}
	if len(p.Stories)+len(p.Rules) != len(seen) || p.NextID != len(seen)+1 {
		t.Fatalf("stories %d rules %d ids %d nextId %d", len(p.Stories), len(p.Rules), len(seen), p.NextID)
	}
	noTemps(t, dir)
}

func TestConcurrentDeleteAndCreate(t *testing.T) {
	s, dir := newStore(t)
	var ids []string
	for i := 0; i < 10; i++ {
		ids = append(ids, mustStory(t, s, fmt.Sprintf("s%d", i)).ID)
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(2)
		go func(id string) {
			defer wg.Done()
			o, _ := NewStore(dir, nil, nil)
			if err := o.Delete(ItemStory, id); err != nil {
				t.Error(err)
			}
		}(id)
		go func() {
			defer wg.Done()
			o, _ := NewStore(dir, nil, nil)
			if _, err := o.UpsertSample(SampleInput{Label: "l", Text: "x"}); err != nil && !errors.Is(err, ErrLimitExceeded) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	p, err := s.Load()
	if err != nil || len(p.Stories) != 0 || len(p.Samples) != 5 {
		t.Fatalf("stories %d samples %d err %v", len(p.Stories), len(p.Samples), err)
	}
}
