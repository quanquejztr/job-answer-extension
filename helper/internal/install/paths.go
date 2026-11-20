package install

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"jobanswer/helper/internal/identity"
)

// ErrUnsafePath is returned for a symlink, a path outside the home directory,
// a non-regular or non-directory entry, or a directory others can write to.
var ErrUnsafePath = errors.New("unsafe path")

const (
	appDirName   = "JobAnswerDrafter"
	binaryName   = "job-answer-host"
	manifestName = identity.NativeHostName + ".json"
)

// Paths are every location the installer touches, derived from one home.
type Paths struct {
	Home        string // symlink-resolved home directory
	AppDir      string // <home>/Library/Application Support/JobAnswerDrafter
	BinDir      string // <AppDir>/bin
	Binary      string // <BinDir>/job-answer-host
	ManifestDir string // <home>/Library/Application Support/Google/Chrome/NativeMessagingHosts
	Manifest    string // <ManifestDir>/com.jobanswerdrafter.host.json
}

// PathsFor validates home and derives all paths from it. home must be an
// absolute path to an existing directory that is not world-writable; it is
// symlink-resolved once (macOS temp directories live behind a symlink) and
// that resolved path is the trust anchor for every later check.
func PathsFor(home string) (Paths, error) {
	var p Paths
	if home == "" || !filepath.IsAbs(home) {
		return p, ErrUnsafePath
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(home))
	if err != nil || resolved == string(filepath.Separator) {
		return p, ErrUnsafePath
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o002 != 0 {
		return p, ErrUnsafePath
	}
	appSupport := filepath.Join(resolved, "Library", "Application Support")
	p = Paths{
		Home:        resolved,
		AppDir:      filepath.Join(appSupport, appDirName),
		ManifestDir: filepath.Join(appSupport, "Google", "Chrome", "NativeMessagingHosts"),
	}
	p.BinDir = filepath.Join(p.AppDir, "bin")
	p.Binary = filepath.Join(p.BinDir, binaryName)
	p.Manifest = filepath.Join(p.ManifestDir, manifestName)
	for _, q := range []string{p.AppDir, p.BinDir, p.Binary, p.ManifestDir, p.Manifest} {
		if !inside(p.Home, q) {
			return Paths{}, ErrUnsafePath
		}
	}
	return p, nil
}

// inside reports whether p is strictly below root after cleaning.
func inside(root, p string) bool {
	rel, err := filepath.Rel(root, filepath.Clean(p))
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return !filepath.IsAbs(rel)
}

// ensureDir creates dir (and missing parents below home) with mode 0700 and
// checks every component: no symlinks, directories only, nothing
// world-writable. When owned is set the leaf and everything the installer
// creates must also not be group-writable.
func ensureDir(home, dir string, owned bool) error { return walkDir(home, dir, owned, true) }

// checkDir performs the same checks as ensureDir without creating anything; a
// missing component ends the walk successfully.
func checkDir(home, dir string, owned bool) error { return walkDir(home, dir, owned, false) }

func walkDir(home, dir string, owned, create bool) error {
	if !inside(home, dir) {
		return ErrUnsafePath
	}
	rel, _ := filepath.Rel(home, dir)
	cur := home
	parts := strings.Split(rel, string(filepath.Separator))
	for i, part := range parts {
		cur = filepath.Join(cur, part)
		info, err := os.Lstat(cur)
		switch {
		case errors.Is(err, fs.ErrNotExist):
			if !create {
				return nil
			}
			if err := os.Mkdir(cur, 0o700); err != nil {
				return fmt.Errorf("create directory: %w", err)
			}
			if err := os.Chmod(cur, 0o700); err != nil {
				return fmt.Errorf("set directory mode: %w", err)
			}
			continue
		case err != nil:
			return fmt.Errorf("inspect directory: %w", err)
		}
		if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
			return ErrUnsafePath
		}
		perm := info.Mode().Perm()
		if perm&0o002 != 0 {
			return ErrUnsafePath
		}
		if owned && i >= leafOwnedFrom(parts) && perm&0o020 != 0 {
			return ErrUnsafePath
		}
	}
	return nil
}

// leafOwnedFrom returns the index from which components count as installer
// owned: the JobAnswerDrafter directory and below.
func leafOwnedFrom(parts []string) int {
	for i, p := range parts {
		if p == appDirName {
			return i
		}
	}
	return len(parts)
}
