package install

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jobanswer/helper/internal/identity"
)

const templatePath = "../../../installer/templates/native-host.json.tmpl"

func loadTemplate(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(templatePath)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type env struct {
	home, bin string
	tmpl      []byte
	p         Paths
}

func newEnv(t *testing.T) env {
	t.Helper()
	home := t.TempDir()
	bin := filepath.Join(t.TempDir(), "host")
	if err := os.WriteFile(bin, []byte("binary-v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	p, err := PathsFor(home)
	if err != nil {
		t.Fatal(err)
	}
	return env{home: home, bin: bin, tmpl: loadTemplate(t), p: p}
}

func (e env) opts() Options {
	return Options{Home: e.home, HostBinary: e.bin, Template: e.tmpl, ExtensionID: identity.ExtensionID}
}

func mode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

func TestTemplateMatchesIdentity(t *testing.T) {
	var m Manifest
	if err := decodeStrict(loadTemplate(t), &m); err != nil {
		t.Fatal(err)
	}
	if m.Name != identity.NativeHostName {
		t.Fatalf("template name %q != identity %q", m.Name, identity.NativeHostName)
	}
}

func TestRenderManifestExactBytes(t *testing.T) {
	got, err := RenderManifest(loadTemplate(t), "/home/u/Library/Application Support/JobAnswerDrafter/bin/job-answer-host", identity.ExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	want := `{
  "name": "com.jobanswerdrafter.host",
  "description": "Job Answer Drafter native helper (private prototype)",
  "path": "/home/u/Library/Application Support/JobAnswerDrafter/bin/job-answer-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://fofmklpoecdileojcljpmemhcefmhbfc/"
  ]
}
`
	if string(got) != want {
		t.Fatalf("manifest bytes differ:\n%s", got)
	}
}

func TestRenderManifestEscapesInsteadOfSplicing(t *testing.T) {
	got, err := RenderManifest(loadTemplate(t), `/a/"quote"/b`, identity.ExtensionID)
	if err != nil || !strings.Contains(string(got), `"/a/\"quote\"/b"`) {
		t.Fatalf("err=%v manifest=%s", err, got)
	}
}

func TestRenderManifestRejectsBadTemplates(t *testing.T) {
	good := string(loadTemplate(t))
	tests := map[string]string{
		"not json":       "nope",
		"unknown field":  strings.Replace(good, `"type": "stdio"`, `"type": "stdio", "extra": 1`, 1),
		"wrong name":     strings.Replace(good, identity.NativeHostName, "com.other.host", 1),
		"wrong type":     strings.Replace(good, `"stdio"`, `"http"`, 1),
		"prefilled path": strings.Replace(good, `"path": ""`, `"path": "/evil"`, 1),
		"prefilled origin": strings.Replace(good, `"allowed_origins": []`,
			`"allowed_origins": ["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"]`, 1),
		"trailing data": good + "{}",
	}
	for name, tmpl := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := RenderManifest([]byte(tmpl), "/p", identity.ExtensionID); !errors.Is(err, ErrInvalidTemplate) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestValidateExtensionID(t *testing.T) {
	other := strings.Repeat("a", 32)
	tests := []struct {
		name  string
		id    string
		allow bool
		err   error
	}{
		{"pinned", identity.ExtensionID, false, nil},
		{"other without override", other, false, ErrExtensionIDDiffers},
		{"other with override", other, true, nil},
		{"empty", "", true, ErrInvalidExtensionID},
		{"short", other[:31], true, ErrInvalidExtensionID},
		{"long", other + "a", true, ErrInvalidExtensionID},
		{"uppercase", strings.ToUpper(other), true, ErrInvalidExtensionID},
		{"letter past p", strings.Repeat("q", 32), true, ErrInvalidExtensionID},
		{"digit", strings.Repeat("1", 32), true, ErrInvalidExtensionID},
		{"origin form", "chrome-extension://" + identity.ExtensionID + "/", true, ErrInvalidExtensionID},
		{"newline suffix", identity.ExtensionID + "\n", true, ErrInvalidExtensionID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateExtensionID(tt.id, tt.allow); !errors.Is(err, tt.err) {
				t.Fatalf("err = %v, want %v", err, tt.err)
			}
		})
	}
}

func TestInstallWritesExpectedFilesAndModes(t *testing.T) {
	e := newEnv(t)
	res, err := DevInstall(e.opts())
	if err != nil {
		t.Fatal(err)
	}
	if res.Binary != e.p.Binary || res.Manifest != e.p.Manifest {
		t.Fatalf("result paths %+v", res)
	}
	if !strings.HasSuffix(e.p.Binary, "/Library/Application Support/JobAnswerDrafter/bin/job-answer-host") ||
		!strings.HasSuffix(e.p.Manifest, "/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jobanswerdrafter.host.json") {
		t.Fatalf("unexpected layout: %s %s", e.p.Binary, e.p.Manifest)
	}
	if b, _ := os.ReadFile(e.p.Binary); string(b) != "binary-v1" {
		t.Fatalf("binary content = %q", b)
	}
	want, _ := RenderManifest(e.tmpl, e.p.Binary, identity.ExtensionID)
	if b, _ := os.ReadFile(e.p.Manifest); !bytes.Equal(b, want) {
		t.Fatalf("manifest differs from rendered bytes:\n%s", b)
	}
	if m := mode(t, e.p.Binary); m != 0o700 {
		t.Errorf("binary mode %o", m)
	}
	if m := mode(t, e.p.Manifest); m != 0o600 {
		t.Errorf("manifest mode %o", m)
	}
	for _, d := range []string{e.p.AppDir, e.p.BinDir, e.p.ManifestDir} {
		if m := mode(t, d); m != 0o700 {
			t.Errorf("%s mode %o", d, m)
		}
	}
	if got := names(t, e.p.BinDir); len(got) != 1 {
		t.Errorf("bin dir has %v", got)
	}
	if got := names(t, e.p.ManifestDir); len(got) != 1 {
		t.Errorf("manifest dir has %v", got)
	}
}

func TestInstallIsIdempotentAndUpdates(t *testing.T) {
	e := newEnv(t)
	if _, err := DevInstall(e.opts()); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(e.p.Manifest)
	if _, err := DevInstall(e.opts()); err != nil {
		t.Fatal(err)
	}
	if second, _ := os.ReadFile(e.p.Manifest); !bytes.Equal(first, second) {
		t.Fatal("second install changed the manifest")
	}
	if b, _ := os.ReadFile(e.p.Binary); string(b) != "binary-v1" {
		t.Fatal("binary changed")
	}
	if got := names(t, e.p.BinDir); len(got) != 1 {
		t.Fatalf("temp file left behind: %v", got)
	}
	// Repair/update: a new binary replaces the old and modes are restored.
	if err := os.WriteFile(e.bin, []byte("binary-v2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(e.p.Binary, 0o777); err != nil {
		t.Fatal(err)
	}
	if _, err := DevInstall(e.opts()); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(e.p.Binary); string(b) != "binary-v2" || mode(t, e.p.Binary) != 0o700 {
		t.Fatalf("update failed: %q %o", b, mode(t, e.p.Binary))
	}
}

func TestInstallOtherExtensionIDNeedsOverride(t *testing.T) {
	e := newEnv(t)
	o := e.opts()
	o.ExtensionID = strings.Repeat("b", 32)
	if _, err := DevInstall(o); !errors.Is(err, ErrExtensionIDDiffers) {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Lstat(e.p.AppDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a refused install must not create anything")
	}
	o.AllowOther = true
	if _, err := DevInstall(o); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(e.p.Manifest); !strings.Contains(string(b), "chrome-extension://"+o.ExtensionID+"/") ||
		strings.Contains(string(b), identity.ExtensionID) {
		t.Fatalf("manifest origin wrong:\n%s", b)
	}
}

func TestInstallRefusesUnsafeDestinations(t *testing.T) {
	mk := func(t *testing.T, e env, rel string, perm os.FileMode) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(e.home, rel), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(filepath.Join(e.home, rel), perm); err != nil {
			t.Fatal(err)
		}
	}
	link := func(t *testing.T, target, at string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(at), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, at); err != nil {
			t.Fatal(err)
		}
	}
	appSupport := "Library/Application Support"
	tests := map[string]func(t *testing.T, e env){
		"world-writable Application Support": func(t *testing.T, e env) { mk(t, e, appSupport, 0o777) },
		"world-writable app dir":             func(t *testing.T, e env) { mk(t, e, appSupport+"/JobAnswerDrafter", 0o703) },
		"group-writable app dir":             func(t *testing.T, e env) { mk(t, e, appSupport+"/JobAnswerDrafter", 0o770) },
		"world-writable bin dir":             func(t *testing.T, e env) { mk(t, e, appSupport+"/JobAnswerDrafter/bin", 0o702) },
		"world-writable manifest dir":        func(t *testing.T, e env) { mk(t, e, appSupport+"/Google/Chrome/NativeMessagingHosts", 0o777) },
		"symlinked Library": func(t *testing.T, e env) {
			link(t, t.TempDir(), filepath.Join(e.home, "Library"))
		},
		"symlinked app dir": func(t *testing.T, e env) {
			link(t, t.TempDir(), filepath.Join(e.home, appSupport, "JobAnswerDrafter"))
		},
		"symlinked bin dir": func(t *testing.T, e env) {
			mk(t, e, appSupport+"/JobAnswerDrafter", 0o700)
			link(t, t.TempDir(), filepath.Join(e.home, appSupport, "JobAnswerDrafter", "bin"))
		},
		"symlinked manifest dir": func(t *testing.T, e env) {
			link(t, t.TempDir(), filepath.Join(e.home, appSupport, "Google", "Chrome", "NativeMessagingHosts"))
		},
		"symlink at binary path": func(t *testing.T, e env) {
			mk(t, e, appSupport+"/JobAnswerDrafter/bin", 0o700)
			link(t, filepath.Join(t.TempDir(), "x"), e.p.Binary)
		},
		"symlink at manifest path": func(t *testing.T, e env) {
			mk(t, e, appSupport+"/Google/Chrome/NativeMessagingHosts", 0o700)
			link(t, filepath.Join(t.TempDir(), "x"), e.p.Manifest)
		},
		"directory at binary path": func(t *testing.T, e env) {
			mk(t, e, appSupport+"/JobAnswerDrafter/bin/job-answer-host", 0o700)
		},
		"source is a symlink": func(t *testing.T, e env) {
			real := e.bin + ".real"
			if err := os.Rename(e.bin, real); err != nil {
				t.Fatal(err)
			}
			link(t, real, e.bin)
		},
		"source is a directory": func(t *testing.T, e env) { e.bin = filepath.Dir(e.bin) },
	}
	for name, setup := range tests {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			// Keep any symlink target untouched: record what exists elsewhere.
			setup(t, e)
			o := e.opts()
			if name == "source is a directory" {
				o.HostBinary = filepath.Dir(e.bin)
			}
			_, err := DevInstall(o)
			if !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("err = %v, want ErrUnsafePath", err)
			}
			// Nothing was written through a symlink or into an unsafe place.
			if info, serr := os.Lstat(e.p.Binary); serr == nil && info.Mode().IsRegular() {
				t.Fatalf("binary written despite refusal")
			}
			if info, serr := os.Lstat(e.p.Manifest); serr == nil && info.Mode().IsRegular() {
				t.Fatalf("manifest written despite refusal")
			}
		})
	}
}

func TestPathsForRejectsBadHomes(t *testing.T) {
	file := filepath.Join(t.TempDir(), "f")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	open := t.TempDir()
	if err := os.Chmod(open, 0o777); err != nil {
		t.Fatal(err)
	}
	for name, home := range map[string]string{
		"empty":          "",
		"relative":       "some/dir",
		"root":           "/",
		"missing":        filepath.Join(t.TempDir(), "nope"),
		"file":           file,
		"world-writable": open,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := PathsFor(home); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestInside(t *testing.T) {
	tests := []struct {
		root, p string
		want    bool
	}{
		{"/h", "/h/a", true},
		{"/h", "/h/a/b/c", true},
		{"/h", "/h", false},
		{"/h", "/h/../etc/passwd", false},
		{"/h", "/other/a", false},
		{"/h", "/hx/a", false},
		{"/h", "/h/a/../../x", false},
	}
	for _, tt := range tests {
		if got := inside(tt.root, tt.p); got != tt.want {
			t.Errorf("inside(%q,%q) = %v", tt.root, tt.p, got)
		}
	}
}

type failingReader struct{ n int }

func (f *failingReader) Read(p []byte) (int, error) {
	if f.n == 0 {
		return 0, errors.New("disk on fire")
	}
	f.n--
	p[0] = 'x'
	return 1, nil
}

func TestWriteAtomicFailureKeepsOldFileAndLeavesNoTemp(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "f")
	if err := os.WriteFile(dest, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := writeAtomic(dir, dest, &failingReader{n: 3}, 0o600, 100)
	if err == nil {
		t.Fatal("expected failure")
	}
	if b, _ := os.ReadFile(dest); string(b) != "old" {
		t.Fatalf("old file damaged: %q", b)
	}
	if got := names(t, dir); len(got) != 1 {
		t.Fatalf("temp file left: %v", got)
	}
	// Over the size limit also fails cleanly.
	if err := writeAtomic(dir, dest, io.LimitReader(strings.NewReader(strings.Repeat("x", 50)), 50), 0o600, 10); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("err = %v", err)
	}
	if b, _ := os.ReadFile(dest); string(b) != "old" || len(names(t, dir)) != 1 {
		t.Fatal("oversize write left damage")
	}
}

func TestUninstallRemovesOnlyOwnFiles(t *testing.T) {
	e := newEnv(t)
	if _, err := DevInstall(e.opts()); err != nil {
		t.Fatal(err)
	}
	otherManifest := filepath.Join(e.p.ManifestDir, "com.other.host.json")
	otherInBin := filepath.Join(e.p.BinDir, "keep.txt")
	for _, f := range []string{otherManifest, otherInBin} {
		if err := os.WriteFile(f, []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := DevUninstall(e.home); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{e.p.Binary, e.p.Manifest} {
		if _, err := os.Lstat(gone); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s still exists", gone)
		}
	}
	for _, kept := range []string{otherManifest, otherInBin, e.p.BinDir, e.p.AppDir, e.p.ManifestDir} {
		if _, err := os.Lstat(kept); err != nil {
			t.Errorf("%s was removed: %v", kept, err)
		}
	}
	// Idempotent.
	if err := DevUninstall(e.home); err != nil {
		t.Fatalf("second uninstall: %v", err)
	}
}

func TestUninstallRemovesEmptyOwnedDirsButNotChromeDirs(t *testing.T) {
	e := newEnv(t)
	if _, err := DevInstall(e.opts()); err != nil {
		t.Fatal(err)
	}
	if err := DevUninstall(e.home); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{e.p.BinDir, e.p.AppDir} {
		if _, err := os.Lstat(d); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s should be gone", d)
		}
	}
	if _, err := os.Lstat(e.p.ManifestDir); err != nil {
		t.Errorf("Chrome directory was removed: %v", err)
	}
}

func TestUninstallWithNothingInstalledIsANoop(t *testing.T) {
	e := newEnv(t)
	if err := DevUninstall(e.home); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(e.home, "Library")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("uninstall must not create directories")
	}
}

func TestUninstallRefusesForeignOrUnsafeFiles(t *testing.T) {
	foreignManifests := map[string]string{
		"other name": `{"name":"com.other.host","description":"d","path":"%s","type":"stdio","allowed_origins":[]}`,
		"other path": `{"name":"com.jobanswerdrafter.host","description":"d","path":"/elsewhere","type":"stdio","allowed_origins":[]}`,
		"not json":   `nope`,
	}
	for name, body := range foreignManifests {
		t.Run("manifest "+name, func(t *testing.T) {
			e := newEnv(t)
			if err := os.MkdirAll(e.p.ManifestDir, 0o700); err != nil {
				t.Fatal(err)
			}
			content := strings.Replace(body, "%s", e.p.Binary, 1)
			if err := os.WriteFile(e.p.Manifest, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := DevUninstall(e.home); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("err = %v", err)
			}
			if b, _ := os.ReadFile(e.p.Manifest); string(b) != content {
				t.Fatal("foreign manifest was touched")
			}
		})
	}
	t.Run("symlinked binary", func(t *testing.T) {
		e := newEnv(t)
		if _, err := DevInstall(e.opts()); err != nil {
			t.Fatal(err)
		}
		victim := filepath.Join(t.TempDir(), "victim")
		if err := os.WriteFile(victim, []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(e.p.Binary); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(victim, e.p.Binary); err != nil {
			t.Fatal(err)
		}
		if err := DevUninstall(e.home); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("err = %v", err)
		}
		if _, err := os.Stat(victim); err != nil {
			t.Fatal("symlink target was removed")
		}
		if _, err := os.Lstat(e.p.Manifest); err != nil {
			t.Fatal("nothing should be removed when a check fails")
		}
	})
}

func TestCLI(t *testing.T) {
	e := newEnv(t)
	var out, errw bytes.Buffer
	args := []string{"dev-install", "--home", e.home, "--host-binary", e.bin, "--template", templatePath}
	if code := RunCLI(args, &out, &errw); code != 0 {
		t.Fatalf("install exit %d: %s", code, errw.String())
	}
	if _, err := os.Stat(e.p.Manifest); err != nil {
		t.Fatal(err)
	}
	if code := RunCLI(args, &out, &errw); code != 0 {
		t.Fatalf("second install exit %d", code)
	}
	bad := append(append([]string{}, args...), "--extension-id", strings.Repeat("b", 32))
	errw.Reset()
	if code := RunCLI(bad, &out, &errw); code != 1 || !strings.Contains(errw.String(), "pinned") {
		t.Fatalf("override-less other id: exit %d: %s", code, errw.String())
	}
	if code := RunCLI(append(bad, "--allow-other-extension-id"), &out, &errw); code != 0 {
		t.Fatalf("override install failed: %s", errw.String())
	}
	if code := RunCLI([]string{"dev-uninstall", "--home", e.home}, &out, &errw); code != 0 {
		t.Fatalf("uninstall exit %d: %s", code, errw.String())
	}
	if _, err := os.Lstat(e.p.Manifest); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("manifest still present")
	}
	for name, a := range map[string][]string{
		"no args":       nil,
		"unknown":       {"install"},
		"extra args":    {"dev-uninstall", "--home", e.home, "stray"},
		"bad flag":      {"dev-install", "--nope"},
		"no binary":     {"dev-install", "--home", e.home, "--template", templatePath},
		"no template":   {"dev-install", "--home", e.home, "--host-binary", e.bin, "--template", filepath.Join(e.home, "missing")},
		"relative home": {"dev-uninstall", "--home", "relative/dir"},
	} {
		if code := RunCLI(a, io.Discard, io.Discard); code == 0 {
			t.Errorf("%s: exit 0", name)
		}
	}
}
