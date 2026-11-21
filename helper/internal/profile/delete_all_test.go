package profile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

const delSentinel = "ZQXDELETESENTINELZQX"

func populate(t *testing.T, s *Store) {
	t.Helper()
	if _, err := s.SetResume(ResumeInput{Text: delSentinel + " resume", Source: SourcePasted}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertStory(StoryInput{Title: delSentinel, Text: delSentinel}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertSample(SampleInput{Label: "l", Text: delSentinel}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: delSentinel}); err != nil {
		t.Fatal(err)
	}
}

func names(t *testing.T, dir string) []string {
	n := listDir(t, dir)
	sort.Strings(n)
	return n
}

func writeAt(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertEmptyProfile(t *testing.T, s *Store) {
	t.Helper()
	p, err := s.Load()
	if err != nil {
		t.Fatalf("Load after delete: %v", err)
	}
	if p.NextID != 1 || p.Resume != nil || len(p.Stories)+len(p.Samples)+len(p.Rules) != 0 || p.Settings != (Settings{}) {
		t.Fatalf("not empty: %+v", p)
	}
}

func TestDeleteAllRemovesProfileAndTempsOnly(t *testing.T) {
	s, dir := newStore(t)
	populate(t, s)
	if err := s.AcceptDisclosure(); err != nil {
		t.Fatal(err)
	}
	writeAt(t, filepath.Join(dir, tempPrefix+"abc"), delSentinel)
	writeAt(t, filepath.Join(dir, tempPrefix+"def"), "")
	writeAt(t, filepath.Join(dir, "unrelated.txt"), "keep")
	if err := os.Mkdir(filepath.Join(dir, "bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeAt(t, filepath.Join(dir, "bin", "jobanswer-host"), "binary")

	if err := s.DeleteAll(); err != nil {
		t.Fatal(err)
	}
	if got, want := names(t, dir), []string{LockFileName, "bin", "unrelated.txt"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("directory now %v, want %v", got, want)
	}
	if string(readFile(t, filepath.Join(dir, "unrelated.txt"))) != "keep" || string(readFile(t, filepath.Join(dir, "bin", "jobanswer-host"))) != "binary" {
		t.Fatal("unrelated content changed")
	}
	info, err := os.Stat(filepath.Join(dir, LockFileName))
	if err != nil || info.Size() != 0 {
		t.Fatalf("lock file: %v size=%d", err, info.Size())
	}
	assertEmptyProfile(t, s)
	// The store keeps working afterwards, with ids restarting (AC-013: no trace).
	if f := mustStory(t, s, "new"); f.ID != "s_1" {
		t.Fatalf("first id after reset = %s", f.ID)
	}
}

func TestDeleteAllIsIdempotentAndCreatesNothing(t *testing.T) {
	s, dir := newStore(t)
	if err := s.DeleteAll(); err != nil {
		t.Fatalf("absent directory: %v", err)
	}
	if _, err := os.Lstat(dir); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("DeleteAll created the data directory")
	}
	populate(t, s)
	for i := 0; i < 3; i++ {
		if err := s.DeleteAll(); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
	}
	if got := names(t, dir); !reflect.DeepEqual(got, []string{LockFileName}) {
		t.Fatalf("directory now %v", got)
	}
}

func TestDeleteAllWorksOnUnreadableProfiles(t *testing.T) {
	cases := map[string]string{
		"corrupt":       `{"schemaVersion":` + delSentinel,
		"oversized":     strings.Repeat(" ", 400*1024) + delSentinel,
		"version 1":     `{"schemaVersion":1,"nextId":2,"settings":{},"facts":[{"id":"f_1","text":"` + delSentinel + `","source":"user","verified":true,"tags":[],"createdAt":"2026-11-20T12:00:00Z","updatedAt":"2026-11-20T12:00:00Z"}],"stories":[],"samples":[],"rules":[]}`,
		"unknown":       `{"schemaVersion":99,"facts":"` + delSentinel + `"}`,
		"unparseable":   "\x00\x01\x02" + delSentinel,
		"empty":         "",
		"wrong shape":   `[1,2,3]`,
		"unknown field": `{"schemaVersion":2,"nextId":1,"settings":{},"resume":null,"stories":[],"samples":[],"rules":[],"x":1}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			s, dir := newStore(t)
			mustStory(t, s, "seed")
			writeAt(t, filepath.Join(dir, FileName), content)
			if _, err := s.Load(); err == nil && name != "empty" {
				t.Fatal("test setup: Load should fail")
			}
			if err := s.DeleteAll(); err != nil {
				t.Fatalf("DeleteAll: %v", err)
			}
			assertEmptyProfile(t, s)
			if _, err := os.Lstat(filepath.Join(dir, FileName)); !errors.Is(err, fs.ErrNotExist) {
				t.Fatal("profile.json remains")
			}
		})
	}
}

func TestDeleteAllRefusesSymlinksAndLeavesTargets(t *testing.T) {
	setups := map[string]func(t *testing.T, dir, target string){
		"profile.json symlink": func(t *testing.T, dir, target string) {
			if err := os.Symlink(target, filepath.Join(dir, FileName)); err != nil {
				t.Fatal(err)
			}
		},
		"temp symlink": func(t *testing.T, dir, target string) {
			writeAt(t, filepath.Join(dir, FileName), `{}`)
			if err := os.Symlink(target, filepath.Join(dir, tempPrefix+"zz")); err != nil {
				t.Fatal(err)
			}
			writeAt(t, filepath.Join(dir, tempPrefix+"aa"), "x")
		},
		"temp directory": func(t *testing.T, dir, _ string) {
			if err := os.Mkdir(filepath.Join(dir, tempPrefix+"dir"), 0o700); err != nil {
				t.Fatal(err)
			}
			writeAt(t, filepath.Join(dir, FileName), `{}`)
		},
	}
	for name, setup := range setups {
		t.Run(name, func(t *testing.T) {
			s, dir := newStore(t)
			mustStory(t, s, "seed")
			if err := os.Remove(filepath.Join(dir, FileName)); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(t.TempDir(), "elsewhere.json")
			writeAt(t, target, delSentinel)
			setup(t, dir, target)
			before := names(t, dir)
			err := s.DeleteAll()
			if !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("err = %v, want ErrUnsafePath", err)
			}
			if strings.Contains(err.Error(), delSentinel) {
				t.Fatal("error carries content")
			}
			if after := names(t, dir); !reflect.DeepEqual(before, after) {
				t.Fatalf("directory changed: %v -> %v (nothing may be removed on refusal)", before, after)
			}
			if string(readFile(t, target)) != delSentinel {
				t.Fatal("symlink target was touched")
			}
		})
	}
}

func TestDeleteAllRefusesUnsafeDirectory(t *testing.T) {
	s, dir := newStore(t)
	mustStory(t, s, "seed")
	if err := os.Chmod(dir, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAll(); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(dir, FileName)); err != nil {
		t.Fatal("profile removed from an unsafe directory")
	}
	// A symlinked data directory is refused and its target left alone.
	real := t.TempDir()
	writeAt(t, filepath.Join(real, FileName), "keep")
	link := filepath.Join(t.TempDir(), "data")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	s2, err := NewStore(link, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s2.DeleteAll(); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("symlinked dir: %v", err)
	}
	if string(readFile(t, filepath.Join(real, FileName))) != "keep" {
		t.Fatal("target of symlinked directory touched")
	}
}

func TestDeleteAllFailureOrderKeepsProfileLoadable(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	s, err := NewStore(dir, fixedClock(), &removeFaultFS{failName: tempPrefix})
	if err != nil {
		t.Fatal(err)
	}
	populate(t, s)
	writeAt(t, filepath.Join(dir, tempPrefix+"leftover"), delSentinel)
	err = s.DeleteAll()
	if !errors.Is(err, ErrStorage) {
		t.Fatalf("err = %v, want ErrStorage", err)
	}
	if strings.Contains(err.Error(), delSentinel) || strings.Contains(err.Error(), "injected") {
		t.Fatalf("error carries detail: %v", err)
	}
	// Temp files go first and the removal failed, so profile.json is intact.
	p, lerr := s.Load()
	if lerr != nil || len(p.Stories) != 1 {
		t.Fatalf("profile no longer loadable after a failed delete: %v", lerr)
	}
	// A retry with a healthy filesystem finishes the job.
	healthy, err := NewStore(dir, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := healthy.DeleteAll(); err != nil {
		t.Fatal(err)
	}
	if got := names(t, dir); !reflect.DeepEqual(got, []string{LockFileName}) {
		t.Fatalf("directory now %v", got)
	}
}

func TestDeleteAllProfileRemoveFailureReportsStorage(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	s, err := NewStore(dir, fixedClock(), &removeFaultFS{failName: FileName})
	if err != nil {
		t.Fatal(err)
	}
	populate(t, s)
	if err := s.DeleteAll(); !errors.Is(err, ErrStorage) {
		t.Fatalf("err = %v", err)
	}
	if _, err := s.Load(); err != nil {
		t.Fatalf("profile must stay loadable: %v", err)
	}
}

func TestDeleteAllDirectorySyncFailure(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	s, err := NewStore(dir, fixedClock(), syncFaultFS{})
	if err != nil {
		t.Fatal(err)
	}
	// Writes also sync the directory, so seed through a healthy store.
	seed, err := NewStore(dir, fixedClock(), nil)
	if err != nil {
		t.Fatal(err)
	}
	populate(t, seed)
	err = s.DeleteAll()
	if !errors.Is(err, ErrStorage) {
		t.Fatalf("err = %v, want ErrStorage", err)
	}
	if strings.Contains(err.Error(), delSentinel) {
		t.Fatal("error carries content")
	}
	// Removal already happened; a healthy retry succeeds and is clean.
	if err := seed.DeleteAll(); err != nil {
		t.Fatal(err)
	}
	assertEmptyProfile(t, seed)
}

func TestExportIsACopyAndWritesNothing(t *testing.T) {
	s, dir := newStore(t)
	if p, err := s.Export(); err != nil || p.NextID != 1 || p.Stories == nil {
		t.Fatalf("empty export: %+v %v", p, err)
	}
	if _, err := os.Lstat(dir); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("Export created the data directory")
	}
	populate(t, s)
	before := names(t, dir)
	raw := readFile(t, filepath.Join(dir, FileName))
	p, err := s.Export()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(raw)
	if err != nil || !reflect.DeepEqual(p, decoded) {
		t.Fatalf("export differs from the stored file: %v", err)
	}
	p.Stories[0].Text = "mutated"
	p.Stories = nil
	again, _ := s.Export()
	if len(again.Stories) != 1 || again.Stories[0].Text == "mutated" {
		t.Fatal("Export is not a deep copy")
	}
	if !reflect.DeepEqual(before, names(t, dir)) || string(readFile(t, filepath.Join(dir, FileName))) != string(raw) {
		t.Fatal("Export wrote to disk")
	}
}

func TestDeleteAllWaitsForTheLock(t *testing.T) {
	s, dir := newStore(t)
	populate(t, s)
	unlock, err := OSFS{}.Lock(filepath.Join(dir, LockFileName))
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.DeleteAll() }()
	select {
	case <-done:
		t.Fatal("DeleteAll did not wait for the exclusive lock")
	case <-time.After(150 * time.Millisecond): // negative check: it must still be blocked
	}
	if _, err := os.Lstat(filepath.Join(dir, FileName)); err != nil {
		t.Fatal("profile removed while another process held the lock")
	}
	_ = unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
