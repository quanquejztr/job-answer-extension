package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider/fake"
)

const profSentinel = "ZQXPROFILESENTINELZQX"

type profRun struct {
	frames []protocol.ResponseEnvelope
	stdout []byte
	stderr string
	err    error
}

// runProfile sends every body through one Run over in-memory pipes, with the
// given home directory, and returns the parsed frames plus raw stdout/stderr.
func runProfile(t *testing.T, home string, timeout time.Duration, bodies ...string) profRun {
	t.Helper()
	var in bytes.Buffer
	for _, b := range bodies {
		in.Write(frameOf(t, b))
	}
	var out, errBuf bytes.Buffer
	err := Run(context.Background(), &in, &out, Config{
		Provider: fake.FakeProvider{}, Log: NewLogger(&errBuf), Home: home, ProfileTimeout: timeout,
	})
	raw := append([]byte(nil), out.Bytes()...)
	var frames []protocol.ResponseEnvelope
	for {
		body, rerr := protocol.ReadMessage(&out, limits.MaxNativeResponseBytes)
		if errors.Is(rerr, protocol.ErrEndOfStream) {
			break
		}
		if rerr != nil {
			t.Fatalf("read response frame: %v", rerr)
		}
		env, perr := protocol.ParseResponse(body)
		if perr != nil {
			t.Fatalf("response is not a valid envelope: %v", perr)
		}
		frames = append(frames, env)
	}
	return profRun{frames: frames, stdout: raw, stderr: errBuf.String(), err: err}
}

func body(id, typ string, payload any) string {
	p, err := json.Marshal(payload)
	if err != nil {
		panic(err) // payloads here are fixed maps; marshalling cannot fail
	}
	return fmt.Sprintf(`{"protocolVersion":1,"requestId":%q,"type":%q,"payload":%s}`, id, typ, p)
}

func getBody(id string) string { return body(id, protocol.TypeProfileGet, map[string]any{}) }

func upsertBody(id, kind string, item map[string]any) string {
	return body(id, protocol.TypeProfileItemUpsert, map[string]any{"kind": kind, "item": item})
}

func deleteBody(id, kind, itemID string) string {
	return body(id, protocol.TypeProfileItemDelete, map[string]any{"kind": kind, "id": itemID})
}

func okResult(t *testing.T, f protocol.ResponseEnvelope) json.RawMessage {
	t.Helper()
	if !f.OK {
		t.Fatalf("want success, got error %+v", f.Error)
	}
	return f.Result
}

func decodeProfileResult(t *testing.T, f protocol.ResponseEnvelope) *profile.Profile {
	t.Helper()
	p, err := profile.Decode(okResult(t, f))
	if err != nil {
		t.Fatalf("result is not a valid profile: %v", err)
	}
	return p
}

func itemOf(t *testing.T, f protocol.ResponseEnvelope, into any) {
	t.Helper()
	var wrap struct {
		Item json.RawMessage `json:"item"`
	}
	dec := json.NewDecoder(bytes.NewReader(okResult(t, f)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wrap); err != nil {
		t.Fatal(err)
	}
	dec = json.NewDecoder(bytes.NewReader(wrap.Item))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("item has an unexpected shape: %v", err)
	}
}

func wantCode(t *testing.T, f protocol.ResponseEnvelope, code protocol.ErrorCode) {
	t.Helper()
	if f.OK || f.Error == nil || f.Error.Code != code {
		t.Fatalf("want %s, got ok=%v error=%+v", code, f.OK, f.Error)
	}
	if *f.Error != protocol.NewAppError(code) {
		t.Fatalf("error is not the fixed catalog entry: %+v", f.Error)
	}
}

func TestProfileGetOnEmptyStoreCreatesNothing(t *testing.T) {
	home := t.TempDir()
	r := runProfile(t, home, 0, getBody("g1"))
	if r.err != nil || len(r.frames) != 1 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	p := decodeProfileResult(t, r.frames[0])
	if p.NextID != 1 || p.Resume != nil || len(p.Stories)+len(p.Samples)+len(p.Rules) != 0 {
		t.Fatalf("not empty: %+v", p)
	}
	if _, err := os.Lstat(DataDir(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("profile.get created the data directory")
	}
}

func TestProfileDataDirIsUnderInjectedHome(t *testing.T) {
	home := t.TempDir()
	want := filepath.Join(home, "Library", "Application Support", "JobAnswerDrafter")
	if DataDir(home) != want {
		t.Fatalf("DataDir = %q", DataDir(home))
	}
	r := runProfile(t, home, 0, upsertBody("u1", "story", map[string]any{"title": "Made-up", "text": "Made-up story."}))
	okResult(t, r.frames[0])
	info, err := os.Stat(filepath.Join(want, profile.FileName))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("profile file: %v %v", info, err)
	}
	dirInfo, err := os.Stat(want)
	if err != nil || dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("data dir: %v %v", dirInfo, err)
	}
}

func resumeBody(id, text, source string) string {
	return body(id, protocol.TypeProfileResumeSet, map[string]any{"text": text, "source": source})
}

func TestProfileUpsertUpdateDeleteRoundTrip(t *testing.T) {
	home := t.TempDir()
	r := runProfile(t, home, 0,
		resumeBody("a0", "  Made-up resume text.  ", "pasted"),
		upsertBody("a1", "story", map[string]any{"title": "Story", "text": "Made-up story."}),                       // s_1
		upsertBody("a2", "story", map[string]any{"title": "Second", "text": "Another made-up story."}),              // s_2
		upsertBody("a3", "story", map[string]any{"id": "s_1", "title": "Story", "text": "Made-up story, revised."}), // update
		upsertBody("a5", "sample", map[string]any{"label": "L", "text": "Made-up sample."}),                         // w_3
		upsertBody("a6", "rule", map[string]any{"kind": "tone", "text": "Plain."}),                                  // r_4
		upsertBody("a7", "rule", map[string]any{"id": "r_4", "kind": "avoid", "text": "No jargon.", "enabled": false}),
		resumeBody("a7b", "Second resume text.", "docx"),
		getBody("a8"),
		deleteBody("a9", "story", "s_1"),
		deleteBody("b1", "sample", "w_3"),
		deleteBody("b2", "rule", "r_4"),
		getBody("b4"),
	)
	if r.err != nil || len(r.frames) != 13 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	var res struct {
		Resume profile.Resume `json:"resume"`
	}
	dec := json.NewDecoder(bytes.NewReader(okResult(t, r.frames[0])))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&res); err != nil || res.Resume.Text != "Made-up resume text." || res.Resume.Source != "pasted" || res.Resume.UpdatedAt == "" {
		t.Fatalf("resume result: %+v %v", res, err)
	}
	var st1 profile.Story
	itemOf(t, r.frames[1], &st1)
	if st1.ID != "s_1" || st1.Title != "Story" || st1.CreatedAt == "" {
		t.Fatalf("created story: %+v", st1)
	}
	var st1b profile.Story
	itemOf(t, r.frames[3], &st1b)
	if st1b.ID != "s_1" || st1b.Text != "Made-up story, revised." || st1b.CreatedAt != st1.CreatedAt {
		t.Fatalf("updated story: %+v", st1b)
	}
	var sm profile.WritingSample
	itemOf(t, r.frames[4], &sm)
	var rule profile.WritingRule
	itemOf(t, r.frames[5], &rule)
	if sm.ID != "w_3" || rule.ID != "r_4" || !rule.Enabled {
		t.Fatalf("sample/rule: %+v %+v", sm, rule)
	}
	itemOf(t, r.frames[6], &rule)
	if rule.ID != "r_4" || rule.Kind != "avoid" || rule.Enabled {
		t.Fatalf("updated rule: %+v", rule)
	}
	mid := decodeProfileResult(t, r.frames[8])
	if mid.Resume == nil || mid.Resume.Text != "Second resume text." || mid.Resume.Source != "docx" ||
		len(mid.Stories) != 2 || len(mid.Samples) != 1 || len(mid.Rules) != 1 || mid.Stories[0].Text != "Made-up story, revised." {
		t.Fatalf("mid profile: %+v", mid)
	}
	if string(okResult(t, r.frames[9])) != `{"deleted":true}` {
		t.Fatalf("delete result: %s", r.frames[9].Result)
	}
	for i := 10; i <= 11; i++ {
		okResult(t, r.frames[i])
	}
	end := decodeProfileResult(t, r.frames[12])
	if end.Resume == nil || len(end.Stories) != 1 || end.Stories[0].ID != "s_2" || len(end.Samples)+len(end.Rules) != 0 || end.NextID != 5 {
		t.Fatalf("end profile: %+v", end)
	}
}

func TestProfileResumeSetRejectionsWriteNothing(t *testing.T) {
	home := t.TempDir()
	okR := runProfile(t, home, 0, resumeBody("r0", "Made-up resume.", "pasted"))
	okResult(t, okR.frames[0])
	path := filepath.Join(DataDir(home), profile.FileName)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r := runProfile(t, home, 0,
		resumeBody("r1", strings.Repeat("a", limits.MaxResumeChars+1), "pasted"),
		resumeBody("r2", "   ", "pasted"),
		resumeBody("r3", "bad\u0001control", "pdf"),
		body("r4", protocol.TypeProfileResumeSet, map[string]any{"text": "x", "source": "web"}),
	)
	wantCode(t, r.frames[0], protocol.CodeInvalidRequest)
	wantCode(t, r.frames[1], protocol.CodeInvalidRequest)
	wantCode(t, r.frames[2], protocol.CodeInvalidRequest)
	wantCode(t, r.frames[3], protocol.CodeInvalidRequest)
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("a rejected résumé save changed the file")
	}
}

// An over-cap save is INVALID_REQUEST and leaves the file byte-identical
// (AC-012), through the whole host path.
func TestProfileTotalCapRejectedThroughHost(t *testing.T) {
	home := t.TempDir()
	s := newTestStore(t, home)
	if _, err := s.SetResume(profile.ResumeInput{Text: strings.Repeat("r", limits.MaxResumeChars), Source: profile.SourcePasted}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.UpsertStory(profile.StoryInput{Title: "t", Text: strings.Repeat("s", limits.MaxStoryChars)}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		if _, err := s.UpsertSample(profile.SampleInput{Label: "l", Text: strings.Repeat("w", limits.MaxSampleChars)}); err != nil {
			t.Fatal(err)
		}
	}
	// 15,000 + 15,005 + 9,000 = 39,005; a 995-code-point sample lands exactly on the cap.
	r := runProfile(t, home, 0, upsertBody("c1", "sample", map[string]any{"label": "l", "text": strings.Repeat("z", 995)}))
	okResult(t, r.frames[0])
	path := filepath.Join(DataDir(home), profile.FileName)
	before, _ := os.ReadFile(path)
	r = runProfile(t, home, 0,
		upsertBody("c2", "rule", map[string]any{"kind": "tone", "text": "x"}),
		upsertBody("c3", "story", map[string]any{"title": "t", "text": "x"}),
	)
	wantCode(t, r.frames[0], protocol.CodeInvalidRequest)
	wantCode(t, r.frames[1], protocol.CodeInvalidRequest)
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("a rejected over-cap save changed the file")
	}
}

// A schemaVersion 1 file is STORAGE_ERROR for reads and writes, stays
// byte-identical, and delete-all still clears it.
func TestProfileVersion1FileIsUnsupportedButDeletable(t *testing.T) {
	const v1 = `{"schemaVersion":1,"nextId":2,"settings":{},"facts":[{"id":"f_1","text":"` + profSentinel + `","source":"user","verified":true,"tags":[],"createdAt":"2026-11-20T10:00:00Z","updatedAt":"2026-11-20T10:00:00Z"}],"stories":[],"samples":[],"rules":[]}`
	home := t.TempDir()
	writeProfileFile(t, home, v1)
	r := runProfile(t, home, 0,
		getBody("v1"),
		body("v2", protocol.TypeProfileExport, map[string]any{}),
		resumeBody("v3", "Made-up resume.", "pasted"),
		upsertBody("v4", "story", map[string]any{"title": "t", "text": "x"}),
	)
	for i := range r.frames {
		wantCode(t, r.frames[i], protocol.CodeStorageError)
	}
	path := filepath.Join(DataDir(home), profile.FileName)
	if got, _ := os.ReadFile(path); string(got) != v1 {
		t.Fatal("the version 1 file was modified")
	}
	if strings.Contains(string(r.stdout), profSentinel) || strings.Contains(r.stderr, profSentinel) {
		t.Fatal("version 1 content leaked")
	}
	d := runProfile(t, home, 0, body("v5", protocol.TypeProfileDeleteAll, map[string]any{"confirm": "DELETE"}), getBody("v6"))
	okResult(t, d.frames[0])
	if p := decodeProfileResult(t, d.frames[1]); p.SchemaVersion != 2 || p.Resume != nil {
		t.Fatalf("after delete-all: %+v", p)
	}
}

func TestProfileStoreErrorsMapToCatalogCodes(t *testing.T) {
	bigText := strings.Repeat("a", limits.MaxStoryChars+1)
	okStory := map[string]any{"title": "Made-up", "text": "Made-up story."}
	tests := []struct {
		name  string
		setup func(t *testing.T, home string)
		body  string
		want  protocol.ErrorCode
	}{
		{"blank story text is invalid", nil, upsertBody("x", "story", map[string]any{"title": "t", "text": "   "}), protocol.CodeInvalidRequest},
		{"too-long story text is a limit error", nil, upsertBody("x", "story", map[string]any{"title": "t", "text": bigText}), protocol.CodeInvalidRequest},
		{"control character", nil, upsertBody("x", "story", map[string]any{"title": "t", "text": "a\u0001b"}), protocol.CodeInvalidRequest},
		{"too-long resume", nil, resumeBody("x", strings.Repeat("a", limits.MaxResumeChars+1), "pasted"), protocol.CodeInvalidRequest},
		{"update of a missing item", nil, upsertBody("x", "story", map[string]any{"id": "s_9", "title": "t", "text": "ok"}), protocol.CodeInvalidRequest},
		{"delete of a missing item", nil, deleteBody("x", "story", "s_9"), protocol.CodeInvalidRequest},
		{"sixth sample", func(t *testing.T, home string) {
			s := newTestStore(t, home)
			for i := 0; i < limits.MaxSamples; i++ {
				if _, err := s.UpsertSample(profile.SampleInput{Label: "l", Text: "t"}); err != nil {
					t.Fatal(err)
				}
			}
		}, upsertBody("x", "sample", map[string]any{"label": "l", "text": "t"}), protocol.CodeInvalidRequest},
		{"corrupt file", func(t *testing.T, home string) { writeProfileFile(t, home, `{"schemaVersion":`+profSentinel) }, getBody("x"), protocol.CodeStorageError},
		{"unknown version", func(t *testing.T, home string) { writeProfileFile(t, home, `{"schemaVersion":3}`) }, getBody("x"), protocol.CodeStorageError},
		{"file over the cap", func(t *testing.T, home string) {
			writeProfileFile(t, home, strings.Repeat(" ", limits.MaxProfileBytes+1))
		}, getBody("x"), protocol.CodeStorageError},
		{"corrupt file blocks a write", func(t *testing.T, home string) { writeProfileFile(t, home, `garbage`) }, upsertBody("x", "story", okStory), protocol.CodeStorageError},
		{"symlinked profile file", func(t *testing.T, home string) {
			dir := DataDir(home)
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(home, "elsewhere.json")
			if err := os.WriteFile(target, []byte(`{}`), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, filepath.Join(dir, profile.FileName)); err != nil {
				t.Fatal(err)
			}
		}, getBody("x"), protocol.CodeStorageError},
		{"group-writable data directory", func(t *testing.T, home string) {
			if err := os.MkdirAll(DataDir(home), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(DataDir(home), 0o770); err != nil {
				t.Fatal(err)
			}
		}, getBody("x"), protocol.CodeStorageError},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			if tc.setup != nil {
				tc.setup(t, home)
			}
			r := runProfile(t, home, 0, tc.body)
			if len(r.frames) != 1 {
				t.Fatalf("frames = %d", len(r.frames))
			}
			wantCode(t, r.frames[0], tc.want)
			if strings.Contains(string(r.stdout), profSentinel) || strings.Contains(r.stderr, profSentinel) {
				t.Fatal("sentinel leaked")
			}
		})
	}
}

func TestProfileUnusableHomeIsStorageError(t *testing.T) {
	for _, home := range []string{"", "relative/home"} {
		r := runProfile(t, home, 0, getBody("x"))
		wantCode(t, r.frames[0], protocol.CodeStorageError)
	}
}

func TestProfileErrorCodeTable(t *testing.T) {
	tests := []struct {
		err  error
		want protocol.ErrorCode
	}{
		{profile.ErrInvalidItem, protocol.CodeInvalidRequest},
		{profile.ErrLimitExceeded, protocol.CodeInvalidRequest},
		{profile.ErrNotFound, protocol.CodeInvalidRequest},
		{profile.ErrStorage, protocol.CodeStorageError},
		{profile.ErrCorrupt, protocol.CodeStorageError},
		{profile.ErrUnsupportedVersion, protocol.CodeStorageError},
		{profile.ErrTooLarge, protocol.CodeStorageError},
		{profile.ErrUnsafePath, protocol.CodeStorageError},
		{fmt.Errorf("wrapped: %w", profile.ErrNotFound), protocol.CodeInvalidRequest},
		{errors.New("something else"), protocol.CodeInternalError},
	}
	for _, tc := range tests {
		if got := profileErrorCode(tc.err); got != tc.want {
			t.Errorf("%v -> %s, want %s", tc.err, got, tc.want)
		}
	}
}

func TestProfileDeadlineWhenLockIsHeld(t *testing.T) {
	home := t.TempDir()
	dir := DataDir(home)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(dir, profile.LockFileName), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	r := runProfile(t, home, 150*time.Millisecond,
		upsertBody("l1", "story", map[string]any{"title": "t", "text": profSentinel}),
		getBody("l2")) // a read does not take the lock and still answers
	elapsed := time.Since(start)
	if len(r.frames) != 2 {
		t.Fatalf("frames = %d", len(r.frames))
	}
	wantCode(t, r.frames[0], protocol.CodeStorageError)
	okResult(t, r.frames[1])
	if elapsed > 3*time.Second {
		t.Fatalf("deadline not enforced: %v", elapsed)
	}
	if !strings.Contains(r.stderr, "event=profile_timeout") || strings.Contains(r.stderr, profSentinel) || strings.Contains(string(r.stdout), profSentinel) {
		t.Fatalf("stderr = %q", r.stderr)
	}
	// Release the lock: the abandoned goroutine finishes its write (atomic),
	// and the store stays valid.
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		s := newTestStore(t, home)
		p, err := s.Load()
		if err != nil {
			t.Fatalf("store invalid after timeout: %v", err)
		}
		if len(p.Stories) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("abandoned write never finished")
		}
		time.Sleep(10 * time.Millisecond) //nolint:forbidigo // bounded poll for a background goroutine in a test
	}
}

func TestProfileSentinelNeverInErrorsOrStderr(t *testing.T) {
	home := t.TempDir()
	long := strings.Repeat(profSentinel, 100)
	r := runProfile(t, home, 0,
		resumeBody("s1", strings.Repeat(profSentinel, 1000), "pasted"),
		upsertBody("s2", "story", map[string]any{"title": "t", "text": profSentinel + "\u0001"}),
		upsertBody("s3", "story", map[string]any{"id": "s_5", "title": profSentinel, "text": profSentinel}),
		upsertBody("s4", "story", map[string]any{"title": long, "text": profSentinel}),
		upsertBody("s5", "rule", map[string]any{"kind": "tone", "text": long}),
		body("s6", protocol.TypeProfileResumeSet, map[string]any{"text": profSentinel, "source": profSentinel}),
	)
	if len(r.frames) != 6 {
		t.Fatalf("frames = %d", len(r.frames))
	}
	for i, f := range r.frames {
		if f.OK {
			t.Fatalf("frame %d unexpectedly succeeded", i)
		}
	}
	if bytes.Contains(r.stdout, []byte(profSentinel)) || strings.Contains(r.stderr, profSentinel) {
		t.Fatal("sentinel reached stdout or stderr")
	}
	// A successful upsert returns the item it was given, but stderr stays clean.
	ok := runProfile(t, home, 0, upsertBody("s7", "story", map[string]any{"title": "t", "text": profSentinel}))
	if strings.Contains(ok.stderr, profSentinel) {
		t.Fatalf("stderr leaked: %q", ok.stderr)
	}
	for _, line := range strings.Split(strings.TrimSpace(r.stderr), "\n") {
		if !strings.HasPrefix(line, "event=") {
			t.Fatalf("stderr line is not an event: %q", line)
		}
	}
}

// A maximum-size valid profile file (the byte cap) must encode into one native
// response, with room for the envelope. HTML-significant characters are used
// because a marshaller that escapes them would grow the response sixfold.
// maxProfileData returns a valid profile file within 1 KiB of the byte cap,
// full of HTML-significant characters.
func maxProfileData(t *testing.T) []byte {
	t.Helper()
	now := "2026-11-20T10:00:00Z"
	// A hand-edited file may exceed the 40,000 code-point content cap (the
	// store never writes one) and still must load and fit one response, so
	// fill every field to its own cap with HTML-significant and 4-byte
	// characters, then size the stories to land within 1 KiB of the byte cap.
	build := func(storyChars int) []byte {
		p := &profile.Profile{SchemaVersion: profile.SchemaVersion, NextID: 1, Settings: profile.Settings{Provider: "claude", DisclosureAcceptedAt: now},
			Resume:  &profile.Resume{Text: strings.Repeat("<", limits.MaxResumeChars), Source: profile.SourcePasted, UpdatedAt: now},
			Stories: []profile.Story{}, Samples: []profile.WritingSample{}, Rules: []profile.WritingRule{}}
		id := func(prefix string) string { n := p.NextID; p.NextID++; return fmt.Sprintf("%s%d", prefix, n) }
		for i := 0; i < limits.MaxSamples; i++ {
			p.Samples = append(p.Samples, profile.WritingSample{ID: id("w_"), Label: "l", Text: strings.Repeat("😀", limits.MaxSampleChars), CreatedAt: now})
		}
		for i := 0; i < limits.MaxRules; i++ {
			p.Rules = append(p.Rules, profile.WritingRule{ID: id("r_"), Kind: "tone", Text: strings.Repeat("&", limits.MaxRuleChars), Enabled: true})
		}
		for i := 0; i < limits.MaxStories; i++ {
			p.Stories = append(p.Stories, profile.Story{ID: id("s_"), Title: "t", Text: strings.Repeat("😀", storyChars), CreatedAt: now, UpdatedAt: now})
		}
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false) // the store's own encoding
		enc.SetIndent("", "  ")
		if err := enc.Encode(p); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	var data []byte
	for n := limits.MaxStoryChars; n >= 1; n-- {
		data = build(n)
		if len(data) <= limits.MaxProfileBytes {
			break
		}
	}
	if len(data) > limits.MaxProfileBytes || len(data) < limits.MaxProfileBytes-1024*4 {
		t.Fatalf("test profile is %d bytes, want near the cap %d", len(data), limits.MaxProfileBytes)
	}
	return data
}

func TestProfileGetOfMaximumSizeProfileFitsOneResponse(t *testing.T) {
	home := t.TempDir()
	writeProfileFile(t, home, string(maxProfileData(t)))

	var in bytes.Buffer
	in.Write(frameOf(t, getBody("big")))
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
	if _, err := profile.Decode(env.Result); err != nil {
		t.Fatalf("result invalid: %v", err)
	}
	// Room for the envelope: the result alone leaves at least 100 KiB spare.
	if limits.MaxNativeResponseBytes-len(frameBytes) < 100*1024 {
		t.Fatalf("response is %d bytes; too close to the %d limit", len(frameBytes), limits.MaxNativeResponseBytes)
	}
	if strings.Contains(string(frameBytes), `\u003c`) || strings.Contains(string(frameBytes), `\u0026`) {
		t.Fatal("response HTML-escaped the profile text")
	}
	if strings.Contains(errBuf.String(), "request_failed") {
		t.Fatalf("stderr: %q", errBuf.String())
	}
}

func newTestStore(t *testing.T, home string) *profile.Store {
	t.Helper()
	s, err := profile.NewStore(DataDir(home), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func writeProfileFile(t *testing.T, home, content string) {
	t.Helper()
	dir := DataDir(home)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, profile.FileName), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
