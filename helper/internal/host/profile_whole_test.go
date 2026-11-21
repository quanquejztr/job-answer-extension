package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider/fake"
)

const wholeSentinel = "ZQXWHOLESENTINELZQX"

func exportBody(id string) string { return body(id, protocol.TypeProfileExport, map[string]any{}) }

func deleteAllBody(id, confirm string) string {
	return body(id, protocol.TypeProfileDeleteAll, map[string]any{"confirm": confirm})
}

func decodeExport(t *testing.T, f protocol.ResponseEnvelope) *profile.Profile {
	t.Helper()
	var wrap struct {
		File json.RawMessage `json:"file"`
	}
	if err := strictDecode(okResult(t, f), &wrap); err != nil {
		t.Fatalf("export result shape: %v", err)
	}
	p, err := profile.Decode(wrap.File)
	if err != nil {
		t.Fatalf("export file invalid: %v", err)
	}
	return p
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	es, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var n []string
	for _, e := range es {
		n = append(n, e.Name())
	}
	sort.Strings(n)
	return n
}

func seedSentinels(t *testing.T, home string) {
	t.Helper()
	s := newTestStore(t, home)
	if _, err := s.SetResume(profile.ResumeInput{Text: wholeSentinel + " resume", Source: profile.SourcePasted}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertStory(profile.StoryInput{Title: wholeSentinel, Text: wholeSentinel}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertSample(profile.SampleInput{Label: wholeSentinel, Text: wholeSentinel}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertRule(profile.RuleInput{Kind: "tone", Text: wholeSentinel}); err != nil {
		t.Fatal(err)
	}
}

func TestProfileExportEmptyCreatesNothing(t *testing.T) {
	home := t.TempDir()
	r := runProfile(t, home, 0, exportBody("e1"))
	if r.err != nil || len(r.frames) != 1 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	p := decodeExport(t, r.frames[0])
	if p.NextID != 1 || p.Resume != nil || len(p.Stories)+len(p.Samples)+len(p.Rules) != 0 {
		t.Fatalf("not empty: %+v", p)
	}
	if _, err := os.Lstat(DataDir(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("export created the data directory")
	}
	if !strings.Contains(r.stderr, "event=profile_export\n") {
		t.Fatalf("stderr: %q", r.stderr)
	}
}

func TestProfileExportRoundTripMatchesStore(t *testing.T) {
	home := t.TempDir()
	r := runProfile(t, home, 0,
		resumeBody("a", "Made-up resume.", "pdf"),
		upsertBody("b", "story", map[string]any{"title": "Story one", "text": "Body"}),
		upsertBody("c", "story", map[string]any{"title": "Story two", "text": "Body two"}),
		upsertBody("d", "sample", map[string]any{"label": "L", "text": "Sample"}),
		upsertBody("e", "rule", map[string]any{"kind": "tone", "text": "Plain.", "enabled": false}),
		deleteBody("f", "story", "s_1"),
		exportBody("g"),
	)
	if len(r.frames) != 7 {
		t.Fatalf("frames = %d", len(r.frames))
	}
	got := decodeExport(t, r.frames[6])
	stored, err := newTestStore(t, home).Load()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, stored) {
		t.Fatalf("export differs from the stored profile:\n%+v\n%+v", got, stored)
	}
	if got.Resume == nil || got.Resume.Source != "pdf" || len(got.Stories) != 1 || got.Stories[0].ID != "s_2" || got.NextID != 5 {
		t.Fatalf("export does not reflect the writes: %+v", got)
	}
	// The exported file is also exactly the on-disk file's content.
	disk, err := os.ReadFile(filepath.Join(DataDir(home), profile.FileName))
	if err != nil {
		t.Fatal(err)
	}
	fromDisk, err := profile.Decode(disk)
	if err != nil || !reflect.DeepEqual(fromDisk, got) {
		t.Fatalf("export differs from profile.json: %v", err)
	}
	// Export wrote nothing new.
	before := dirNames(t, DataDir(home))
	runProfile(t, home, 0, exportBody("h"))
	if !reflect.DeepEqual(before, dirNames(t, DataDir(home))) {
		t.Fatal("export changed the directory")
	}
}

func TestProfileExportOfMaximumSizeProfileFitsOneResponse(t *testing.T) {
	home := t.TempDir()
	data := maxProfileData(t)
	writeProfileFile(t, home, string(data))
	var in bytes.Buffer
	in.Write(frameOf(t, exportBody("big")))
	var out, errBuf bytes.Buffer
	if err := Run(context.Background(), &in, &out, Config{Provider: fake.FakeProvider{}, Log: NewLogger(&errBuf), Home: home}); err != nil {
		t.Fatal(err)
	}
	frameBytes, err := protocol.ReadMessage(bytes.NewReader(out.Bytes()), limits.MaxNativeResponseBytes)
	if err != nil {
		t.Fatalf("response frame: %v", err)
	}
	env, err := protocol.ParseResponse(frameBytes)
	if err != nil || !env.OK {
		t.Fatalf("not a success: %v %+v", err, env.Error)
	}
	if got := decodeExport(t, env); got.Resume == nil || len(got.Stories) == 0 {
		t.Fatal("no résumé or stories exported")
	}
	if limits.MaxNativeResponseBytes-len(frameBytes) < 100*1024 {
		t.Fatalf("response is %d bytes; too close to the %d limit", len(frameBytes), limits.MaxNativeResponseBytes)
	}
	if strings.Contains(string(frameBytes), `\u003c`) || strings.Contains(string(frameBytes), `\u0026`) {
		i := strings.Index(string(frameBytes), `\u00`)
		t.Fatalf("export HTML-escaped the profile text: %q", string(frameBytes[max(0, i-40):i+40]))
	}
	if strings.Contains(errBuf.String(), "request_failed") {
		t.Fatalf("stderr: %q", errBuf.String())
	}
}

func TestProfileDeleteAllConfirmationMustBeExact(t *testing.T) {
	home := t.TempDir()
	seedSentinels(t, home)
	for _, c := range []string{"delete", "Delete", "DELETE ", " DELETE", "", "YES", "DELETE\n"} {
		r := runProfile(t, home, 0, deleteAllBody("d1", c))
		if len(r.frames) != 1 {
			t.Fatalf("frames = %d", len(r.frames))
		}
		wantCode(t, r.frames[0], protocol.CodeInvalidRequest)
	}
	r := runProfile(t, home, 0,
		body("n1", protocol.TypeProfileDeleteAll, map[string]any{}),
		body("n2", protocol.TypeProfileDeleteAll, map[string]any{"confirm": true}),
		body("n3", protocol.TypeProfileDeleteAll, map[string]any{"confirm": "DELETE", "x": 1}),
	)
	for _, f := range r.frames {
		wantCode(t, f, protocol.CodeInvalidRequest)
	}
	if _, err := os.Stat(filepath.Join(DataDir(home), profile.FileName)); err != nil {
		t.Fatal("a rejected deleteAll removed the profile")
	}
}

func TestProfileDeleteAllRemovesDataAndKeepsTheRest(t *testing.T) {
	home := t.TempDir()
	seedSentinels(t, home)
	dir := DataDir(home)
	for _, n := range []string{".profile.json.tmp-1", ".profile.json.tmp-2"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(wholeSentinel), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bin", "host"), []byte("bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := runProfile(t, home, 0, deleteAllBody("d1", "DELETE"), getBody("g"), exportBody("x"), deleteAllBody("d2", "DELETE"))
	if len(r.frames) != 4 {
		t.Fatalf("frames = %d", len(r.frames))
	}
	var del struct {
		Deleted bool `json:"deleted"`
	}
	if err := strictDecode(okResult(t, r.frames[0]), &del); err != nil || !del.Deleted {
		t.Fatalf("result: %v %+v", err, del)
	}
	for _, i := range []int{1} {
		p := decodeProfileResult(t, r.frames[i])
		if p.NextID != 1 || p.Resume != nil || len(p.Stories)+len(p.Samples)+len(p.Rules) != 0 || p.Settings != (profile.Settings{}) {
			t.Fatalf("not empty after delete: %+v", p)
		}
	}
	if p := decodeExport(t, r.frames[2]); p.Resume != nil || len(p.Stories) != 0 {
		t.Fatal("export after delete not empty")
	}
	okResult(t, r.frames[3]) // idempotent
	want := []string{profile.LockFileName, "bin", "notes.txt"}
	sort.Strings(want)
	if got := dirNames(t, dir); !reflect.DeepEqual(got, want) {
		t.Fatalf("directory now %v, want %v", got, want)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "bin", "host")); err != nil || string(b) != "bin" {
		t.Fatal("bin changed")
	}
	if b, err := os.ReadFile(filepath.Join(dir, profile.LockFileName)); err != nil || len(b) != 0 {
		t.Fatal("lock file must remain and be empty")
	}
	// AC-013: no byte of the old content remains anywhere under the data dir.
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if b, _ := os.ReadFile(p); bytes.Contains(b, []byte(wholeSentinel)) {
				t.Errorf("content remains in %s", d.Name())
			}
		}
		return nil
	})
	for _, line := range []string{"event=profile_delete_all\n", "event=profile_export\n"} {
		if !strings.Contains(r.stderr, line) {
			t.Fatalf("stderr %q lacks %q", r.stderr, line)
		}
	}
}

func TestProfileDeleteAllOnUnreadableFilesAndMissingDir(t *testing.T) {
	for name, content := range map[string]string{
		"corrupt":   `{"schemaVersion":` + wholeSentinel,
		"oversized": strings.Repeat(" ", limits.MaxProfileBytes+1),
		"version":   `{"schemaVersion":2,"x":"` + wholeSentinel + `"}`,
		"garbage":   "\x00" + wholeSentinel,
	} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			writeProfileFile(t, home, content)
			if r := runProfile(t, home, 0, getBody("g")); r.frames[0].OK {
				t.Fatal("setup: get should fail")
			}
			r := runProfile(t, home, 0, deleteAllBody("d", "DELETE"), getBody("g2"))
			okResult(t, r.frames[0])
			decodeProfileResult(t, r.frames[1])
			if strings.Contains(string(r.stdout), wholeSentinel) || strings.Contains(r.stderr, wholeSentinel) {
				t.Fatal("sentinel leaked")
			}
		})
	}
	home := t.TempDir()
	r := runProfile(t, home, 0, deleteAllBody("d", "DELETE"))
	okResult(t, r.frames[0])
	if _, err := os.Lstat(DataDir(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleteAll created the data directory")
	}
}

func TestProfileDeleteAllSymlinkIsRefusedAndTargetUntouched(t *testing.T) {
	for name, link := range map[string]string{"profile.json": profile.FileName, "temp": ".profile.json.tmp-9"} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			dir := DataDir(home)
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(home, "elsewhere.json")
			if err := os.WriteFile(target, []byte(wholeSentinel), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, filepath.Join(dir, link)); err != nil {
				t.Fatal(err)
			}
			before := dirNames(t, dir)
			r := runProfile(t, home, 0, deleteAllBody("d", "DELETE"))
			wantCode(t, r.frames[0], protocol.CodeStorageError)
			if b, err := os.ReadFile(target); err != nil || string(b) != wholeSentinel {
				t.Fatal("symlink target touched")
			}
			after := dirNames(t, dir)
			// Only the lock file may have been created by the attempt.
			after = withoutName(after, profile.LockFileName)
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("directory changed: %v -> %v", before, after)
			}
			if strings.Contains(string(r.stdout), wholeSentinel) || strings.Contains(r.stderr, wholeSentinel) {
				t.Fatal("sentinel leaked")
			}
			if !strings.Contains(r.stderr, "event=profile_delete_all code=STORAGE_ERROR\n") {
				t.Fatalf("stderr: %q", r.stderr)
			}
		})
	}
}

func withoutName(in []string, name string) []string {
	var out []string
	for _, n := range in {
		if n != name {
			out = append(out, n)
		}
	}
	return out
}

func TestProfileDeleteAllBlockedByLockHitsDeadline(t *testing.T) {
	home := t.TempDir()
	seedSentinels(t, home)
	unlock, err := profile.OSFS{}.Lock(filepath.Join(DataDir(home), profile.LockFileName))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = unlock() }()
	r := runProfile(t, home, 200*1000*1000, deleteAllBody("d", "DELETE"))
	wantCode(t, r.frames[0], protocol.CodeStorageError)
	if !strings.Contains(r.stderr, "event=profile_timeout") {
		t.Fatalf("stderr: %q", r.stderr)
	}
}

// Sentinel text from every kind of item never reaches stdout errors, stderr, or
// an error string, on export, on delete, or after a failed delete.
func TestProfileExportAndDeleteAllNeverLeakContentOutsideTheExportResult(t *testing.T) {
	home := t.TempDir()
	seedSentinels(t, home)
	dir := DataDir(home)

	// A failing delete: a temp name that is a symlink.
	if err := os.Symlink(filepath.Join(home, "nowhere"), filepath.Join(dir, ".profile.json.tmp-x")); err != nil {
		t.Fatal(err)
	}
	failed := runProfile(t, home, 0, deleteAllBody("f1", "DELETE"), deleteAllBody("f2", "nope"))
	for _, f := range failed.frames {
		if f.OK {
			t.Fatal("expected failures")
		}
	}
	if bytes.Contains(failed.stdout, []byte(wholeSentinel)) || strings.Contains(failed.stderr, wholeSentinel) {
		t.Fatal("failed delete leaked content")
	}
	// The profile survived the failed delete (still loadable, still full).
	if p, err := newTestStore(t, home).Load(); err != nil || p.Resume == nil || len(p.Stories) != 1 {
		t.Fatalf("profile damaged by a failed delete: %v", err)
	}
	// Export legitimately carries the content in its result (that is its job)
	// but nothing on stderr and no error string.
	ex := runProfile(t, home, 0, exportBody("x1"))
	if !ex.frames[0].OK || !bytes.Contains(ex.stdout, []byte(wholeSentinel)) {
		t.Fatal("export should return the stored content")
	}
	if strings.Contains(ex.stderr, wholeSentinel) {
		t.Fatalf("export leaked to stderr: %q", ex.stderr)
	}
	for _, line := range strings.Split(strings.TrimSpace(ex.stderr+failed.stderr), "\n") {
		if !strings.HasPrefix(line, "event=") {
			t.Fatalf("stderr line is not an event: %q", line)
		}
	}
	// Success path of delete: nothing but an acknowledgement.
	if err := os.Remove(filepath.Join(dir, ".profile.json.tmp-x")); err != nil {
		t.Fatal(err)
	}
	done := runProfile(t, home, 0, deleteAllBody("ok", "DELETE"))
	okResult(t, done.frames[0])
	if bytes.Contains(done.stdout, []byte(wholeSentinel)) || strings.Contains(done.stderr, wholeSentinel) {
		t.Fatal("delete leaked content")
	}
	if strings.Contains(string(done.frames[0].Result), wholeSentinel) {
		t.Fatal("delete result carries content")
	}
}
