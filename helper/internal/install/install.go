package install

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// maxBinaryBytes bounds the copied helper binary.
const maxBinaryBytes = 256 << 20

// maxManifestBytes bounds a manifest read during uninstall.
const maxManifestBytes = 64 << 10

// Options for DevInstall.
type Options struct {
	Home        string // injected home directory
	HostBinary  string // path of the built host binary to copy
	Template    []byte // contents of installer/templates/native-host.json.tmpl
	ExtensionID string
	AllowOther  bool // allow an extension ID other than the pinned one
}

// Result lists what DevInstall wrote.
type Result struct{ Binary, Manifest string }

// DevInstall copies the host binary and writes the native-host manifest. All
// validation happens before anything is written. Running it again yields the
// same files.
func DevInstall(o Options) (Result, error) {
	if err := ValidateExtensionID(o.ExtensionID, o.AllowOther); err != nil {
		return Result{}, err
	}
	p, err := PathsFor(o.Home)
	if err != nil {
		return Result{}, err
	}
	manifest, err := RenderManifest(o.Template, p.Binary, o.ExtensionID)
	if err != nil {
		return Result{}, err
	}
	src, err := openRegular(o.HostBinary)
	if err != nil {
		return Result{}, err
	}
	defer src.Close()

	if err := ensureDir(p.Home, p.BinDir, true); err != nil {
		return Result{}, err
	}
	if err := ensureDir(p.Home, p.ManifestDir, false); err != nil {
		return Result{}, err
	}
	// Check both destinations before writing either.
	if err := checkRemovable(p.Binary); err != nil {
		return Result{}, err
	}
	if err := checkRemovable(p.Manifest); err != nil {
		return Result{}, err
	}
	if err := writeAtomic(p.BinDir, p.Binary, io.LimitReader(src, maxBinaryBytes+1), 0o700, maxBinaryBytes); err != nil {
		return Result{}, err
	}
	if err := writeAtomic(p.ManifestDir, p.Manifest, bytesReader(manifest), 0o600, maxManifestBytes); err != nil {
		return Result{}, err
	}
	return Result{Binary: p.Binary, Manifest: p.Manifest}, nil
}

// DevUninstall removes the installed binary and manifest, and then the
// installer-owned directories if they are empty. It removes nothing else: a
// manifest that is not ours, and any symlink or non-regular file at either
// path, is refused untouched. Running it with nothing installed succeeds.
func DevUninstall(home string) error {
	p, err := PathsFor(home)
	if err != nil {
		return err
	}
	if err := checkDir(p.Home, p.BinDir, true); err != nil {
		return err
	}
	if err := checkDir(p.Home, p.ManifestDir, false); err != nil {
		return err
	}
	if err := checkRemovable(p.Binary); err != nil {
		return err
	}
	if err := checkOurManifest(p); err != nil {
		return err
	}
	for _, f := range []string{p.Manifest, p.Binary} {
		if err := os.Remove(f); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove file: %w", err)
		}
	}
	// Only directories the installer made, and only when empty (os.Remove
	// refuses a non-empty directory, so unrelated files are never lost).
	_ = os.Remove(p.BinDir)
	_ = os.Remove(p.AppDir)
	return nil
}

// checkRemovable accepts a missing path or a regular file; anything else is unsafe.
func checkRemovable(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ErrUnsafePath
	}
	return nil
}

func checkOurManifest(p Paths) error {
	if err := checkRemovable(p.Manifest); err != nil {
		return err
	}
	f, err := os.Open(p.Manifest)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open manifest: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxManifestBytes+1))
	if err != nil || len(data) > maxManifestBytes {
		return ErrUnsafePath
	}
	var m Manifest
	if err := decodeStrict(data, &m); err != nil || m.Name != manifestNameValue() || m.Path != p.Binary {
		return ErrUnsafePath
	}
	return nil
}

// openRegular opens a regular, non-symlink file.
func openRegular(path string) (*os.File, error) {
	if path == "" {
		return nil, ErrUnsafePath
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, ErrUnsafePath
	}
	info, err := os.Lstat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrUnsafePath
	}
	return os.Open(abs)
}

// writeAtomic writes r to a private temporary file in dir and renames it over
// dest. dest must not be a symlink or a non-regular file. More than limit
// bytes is an error. The temporary file never survives a failure.
func writeAtomic(dir, dest string, r io.Reader, mode os.FileMode, limit int64) (err error) {
	if filepath.Dir(dest) != dir {
		return ErrUnsafePath
	}
	if info, lerr := os.Lstat(dest); lerr == nil {
		if !info.Mode().IsRegular() {
			return ErrUnsafePath
		}
	} else if !errors.Is(lerr, fs.ErrNotExist) {
		return fmt.Errorf("inspect destination: %w", lerr)
	}
	tmp, err := os.CreateTemp(dir, ".tmp-install-*")
	if err != nil {
		return fmt.Errorf("create temporary file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()
	if err = tmp.Chmod(mode); err != nil {
		return fmt.Errorf("set file mode: %w", err)
	}
	n, err := io.Copy(tmp, r)
	if err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	if n > limit {
		return ErrUnsafePath
	}
	if err = tmp.Sync(); err != nil {
		return fmt.Errorf("sync file: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("close file: %w", err)
	}
	if err = os.Rename(tmpName, dest); err != nil {
		return fmt.Errorf("replace file: %w", err)
	}
	return nil
}
