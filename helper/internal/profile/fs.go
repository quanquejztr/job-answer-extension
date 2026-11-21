package profile

import (
	"io"
	"io/fs"
	"os"
	"syscall"
)

// File is the subset of *os.File the store needs.
type File interface {
	io.ReadWriteCloser
	Sync() error
	Stat() (fs.FileInfo, error)
	Chmod(mode fs.FileMode) error
}

// FS abstracts the filesystem so tests can inject failures at each step.
type FS interface {
	Lstat(path string) (fs.FileInfo, error)
	MkdirAll(path string, perm fs.FileMode) error
	Chmod(path string, mode fs.FileMode) error
	OpenFile(path string, flag int, perm fs.FileMode) (File, error)
	Rename(oldPath, newPath string) error
	Remove(path string) error
	// ReadDir returns entry names in a directory.
	ReadDir(path string) ([]string, error)
	SyncDir(path string) error
	// Lock takes an exclusive advisory lock on the lock file at path
	// (created 0600 if missing) and returns the release function.
	Lock(path string) (unlock func() error, err error)
	// UID is the effective user id that must own the data directory.
	UID() int
}

// OSFS is the real filesystem.
type OSFS struct{}

func (OSFS) Lstat(p string) (fs.FileInfo, error)    { return os.Lstat(p) }
func (OSFS) MkdirAll(p string, m fs.FileMode) error { return os.MkdirAll(p, m) }
func (OSFS) Chmod(p string, m fs.FileMode) error    { return os.Chmod(p, m) }
func (OSFS) Rename(a, b string) error               { return os.Rename(a, b) }
func (OSFS) Remove(p string) error                  { return os.Remove(p) }
func (OSFS) UID() int                               { return os.Geteuid() }
func (OSFS) OpenFile(p string, flag int, m fs.FileMode) (File, error) {
	f, err := os.OpenFile(p, flag|syscall.O_NOFOLLOW, m)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (OSFS) ReadDir(p string) ([]string, error) {
	entries, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names, nil
}

func (OSFS) SyncDir(p string) error {
	d, err := os.Open(p)
	if err != nil {
		return err
	}
	if err := d.Sync(); err != nil {
		_ = d.Close()
		return err
	}
	return d.Close()
}

func (OSFS) Lock(p string) (func() error, error) {
	f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = f.Close()
		return nil, ErrUnsafePath
	}
	if err := f.Chmod(0o600); err != nil { // independent of umask
		_ = f.Close()
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() error {
		// Closing the descriptor releases the flock.
		return f.Close()
	}, nil
}
