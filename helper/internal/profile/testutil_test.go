package profile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var errInjected = errors.New("injected")

// faultFS wraps the real filesystem and fails one named step.
type faultFS struct {
	OSFS
	failOp string // create, write, sync, close, rename, syncdir
	uid    int    // when nonzero, overrides UID()
}

func (f *faultFS) UID() int {
	if f.uid != 0 {
		return f.uid
	}
	return f.OSFS.UID()
}

type faultFile struct {
	File
	fs *faultFS
}

func (f *faultFS) OpenFile(p string, flag int, m fs.FileMode) (File, error) {
	if f.failOp == "create" && flag&os.O_EXCL != 0 {
		return nil, errInjected
	}
	file, err := f.OSFS.OpenFile(p, flag, m)
	if err != nil {
		return nil, err
	}
	if flag&os.O_EXCL != 0 {
		return &faultFile{File: file, fs: f}, nil
	}
	return file, nil
}

func (f *faultFile) Write(b []byte) (int, error) {
	if f.fs.failOp == "write" {
		n, _ := f.File.Write(b[:len(b)/2]) // partial write
		return n, errInjected
	}
	return f.File.Write(b)
}

func (f *faultFile) Sync() error {
	if f.fs.failOp == "sync" {
		return errInjected
	}
	return f.File.Sync()
}

func (f *faultFile) Close() error {
	err := f.File.Close()
	if f.fs.failOp == "close" {
		return errInjected
	}
	return err
}

func (f *faultFS) Rename(a, b string) error {
	if f.failOp == "rename" {
		return errInjected
	}
	return f.OSFS.Rename(a, b)
}

func (f *faultFS) SyncDir(p string) error {
	if f.failOp == "syncdir" {
		return errInjected
	}
	return f.OSFS.SyncDir(p)
}

func fixedClock() func() time.Time {
	t := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	return func() time.Time { t = t.Add(time.Second); return t }
}

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "data")
	s, err := NewStore(dir, fixedClock(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func mustStory(t *testing.T, s *Store, text string) Story {
	t.Helper()
	st, err := s.UpsertStory(StoryInput{Title: "title", Text: text})
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func readFile(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func listDir(t *testing.T, dir string) []string {
	t.Helper()
	es, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range es {
		names = append(names, e.Name())
	}
	return names
}

func noTemps(t *testing.T, dir string) {
	t.Helper()
	for _, n := range listDir(t, dir) {
		if strings.HasPrefix(n, tempPrefix) {
			t.Errorf("leftover temp file %s", n)
		}
	}
}

// removeFaultFS fails Remove for names containing failName, leaving the file.
type removeFaultFS struct {
	OSFS
	failName string
}

func (f *removeFaultFS) Remove(p string) error {
	if strings.Contains(filepath.Base(p), f.failName) {
		return errInjected
	}
	return f.OSFS.Remove(p)
}

// syncFaultFS fails every directory sync.
type syncFaultFS struct{ OSFS }

func (syncFaultFS) SyncDir(string) error { return errInjected }
