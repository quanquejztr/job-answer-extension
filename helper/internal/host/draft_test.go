package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/provider/fake"
)

const (
	unselSentinel = "UNSELECTEDSENTINELQQ"
	selSentinel   = "selectedmarkerzz"
)

// recorder wraps a provider and keeps every Input it was given.
type recorder struct {
	inner provider.Provider
	mu    sync.Mutex
	calls []provider.Input
}

func (r *recorder) Draft(ctx context.Context, in provider.Input) (protocol.DraftResponse, error) {
	r.mu.Lock()
	r.calls = append(r.calls, in)
	r.mu.Unlock()
	return r.inner.Draft(ctx, in)
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

type funcProvider func(provider.Input) protocol.DraftResponse

func (f funcProvider) Draft(_ context.Context, in provider.Input) (protocol.DraftResponse, error) {
	return f(in), nil
}

type genRun struct {
	frames []protocol.ResponseEnvelope
	stdout string
	stderr string
}

func runGenerate(t *testing.T, cfg Config, question, jobContext string, maxWords int) genRun {
	t.Helper()
	payload := map[string]any{
		"question":    question,
		"constraints": map[string]any{"maxWords": maxWords},
		"requestedAt": "2026-11-19T15:04:05Z",
	}
	if jobContext != "" {
		payload["jobContext"] = jobContext
	}
	var in bytes.Buffer
	in.Write(frameOf(t, body("g1", protocol.TypeDraftGenerate, payload)))
	var out, errBuf bytes.Buffer
	cfg.Log = NewLogger(&errBuf)
	if err := Run(context.Background(), &in, &out, cfg); err != nil {
		t.Fatal(err)
	}
	raw := out.String()
	var frames []protocol.ResponseEnvelope
	for out.Len() > 0 {
		b, err := protocol.ReadMessage(&out, limits.MaxNativeResponseBytes)
		if err != nil {
			t.Fatal(err)
		}
		env, err := protocol.ParseResponse(b)
		if err != nil {
			t.Fatal(err)
		}
		frames = append(frames, env)
	}
	if len(frames) != 1 {
		t.Fatalf("frames = %d", len(frames))
	}
	return genRun{frames: frames, stdout: raw, stderr: errBuf.String()}
}

func requireStderrEventsOnly(t *testing.T, stderr string, forbidden ...string) {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(stderr), "\n") {
		if !strings.HasPrefix(line, "event=") {
			t.Fatalf("stderr line is not an event: %q", line)
		}
	}
	for _, f := range forbidden {
		if strings.Contains(stderr, f) {
			t.Fatalf("stderr contains %q", f)
		}
	}
}

func seedProfile(t *testing.T, mut func(s *profile.Store)) string {
	t.Helper()
	home := t.TempDir()
	s, err := profile.NewStore(DataDir(home), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	mut(s)
	chooseClaudeAndAccept(t, s)
	return home
}

// chooseClaudeAndAccept stores the two settings drafting requires: a provider
// choice and the accepted first-use disclosure.
func chooseClaudeAndAccept(t *testing.T, s *profile.Store) {
	t.Helper()
	if err := s.SetProvider(profile.ProviderClaude); err != nil {
		t.Fatal(err)
	}
	if err := s.AcceptDisclosure(); err != nil {
		t.Fatal(err)
	}
}

func wantFail(t *testing.T, f protocol.ResponseEnvelope, code protocol.ErrorCode) {
	t.Helper()
	if f.OK || f.Error == nil || f.Error.Code != code || *f.Error != protocol.NewAppError(code) || len(f.Result) != 0 {
		t.Fatalf("got %+v, want %s", f, code)
	}
}

func TestGenerateRequiresAResume(t *testing.T) {
	tests := []struct {
		name string
		home func(t *testing.T) string
	}{
		{"empty profile", func(t *testing.T) string { return t.TempDir() }},
		{"data directory exists but no profile file", func(t *testing.T) string {
			h := t.TempDir()
			if err := os.MkdirAll(DataDir(h), 0o700); err != nil {
				t.Fatal(err)
			}
			return h
		}},
		{"stories, samples, and rules but no résumé", func(t *testing.T) string {
			return seedProfile(t, func(s *profile.Store) {
				if _, err := s.UpsertStory(profile.StoryInput{Title: "Routing", Text: "Built routing " + unselSentinel}); err != nil {
					t.Fatal(err)
				}
				if _, err := s.UpsertSample(profile.SampleInput{Label: "l", Text: "Sample " + unselSentinel}); err != nil {
					t.Fatal(err)
				}
				if _, err := s.UpsertRule(profile.RuleInput{Kind: profile.KindTone, Text: "Rule " + unselSentinel}); err != nil {
					t.Fatal(err)
				}
			})
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := &recorder{inner: fake.FakeProvider{}}
			r := runGenerate(t, Config{Provider: rec, Home: tt.home(t)}, "Describe your routing experience", "", 150)
			wantFail(t, r.frames[0], protocol.CodeInvalidRequest)
			if rec.count() != 0 {
				t.Fatal("provider was called without a résumé")
			}
			if !strings.Contains(r.stderr, "event="+EventNoResume) {
				t.Fatalf("stderr = %q", r.stderr)
			}
			requireStderrEventsOnly(t, r.stderr, unselSentinel, "routing")
			if strings.Contains(r.stdout, unselSentinel) {
				t.Fatal("profile text in stdout")
			}
		})
	}
}

func TestGenerateStoreErrorsMapToStorageError(t *testing.T) {
	corrupt := func(t *testing.T) string {
		h := t.TempDir()
		if err := os.MkdirAll(DataDir(h), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(DataDir(h), profile.FileName), []byte(`{"schemaVersion":`+unselSentinel), 0o600); err != nil {
			t.Fatal(err)
		}
		return h
	}
	tests := []struct {
		name string
		home func(t *testing.T) string
	}{
		{"corrupt profile", corrupt},
		{"empty home", func(*testing.T) string { return "" }},
		{"relative home", func(*testing.T) string { return "relative/home" }},
		{"unsupported version", func(t *testing.T) string {
			h := corrupt(t)
			if err := os.WriteFile(filepath.Join(DataDir(h), profile.FileName), []byte(`{"schemaVersion":9}`), 0o600); err != nil {
				t.Fatal(err)
			}
			return h
		}},
		{"version 1 profile with facts", func(t *testing.T) string {
			h := corrupt(t)
			v1 := `{"schemaVersion":1,"nextId":2,"settings":{},"facts":[{"id":"f_1","text":"` + unselSentinel + `","source":"user","verified":true,"tags":[],"createdAt":"2026-11-20T10:00:00Z","updatedAt":"2026-11-20T10:00:00Z"}],"stories":[],"samples":[],"rules":[]}`
			if err := os.WriteFile(filepath.Join(DataDir(h), profile.FileName), []byte(v1), 0o600); err != nil {
				t.Fatal(err)
			}
			return h
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := &recorder{inner: fake.FakeProvider{}}
			r := runGenerate(t, Config{Provider: rec, Home: tt.home(t)}, "Describe your routing experience", "", 150)
			wantFail(t, r.frames[0], protocol.CodeStorageError)
			if rec.count() != 0 {
				t.Fatal("provider was called after a storage error")
			}
			requireStderrEventsOnly(t, r.stderr, unselSentinel)
			if strings.Contains(r.stdout, unselSentinel) {
				t.Fatal("profile text in stdout")
			}
		})
	}
}

func TestGenerateProfileLoadDeadline(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	rec := &recorder{inner: fake.FakeProvider{}}
	cfg := Config{
		Provider: rec, Home: t.TempDir(), ProfileTimeout: 100 * time.Millisecond,
		loadProfile: func(*profile.Store) (any, error) { <-release; return nil, nil },
	}
	start := time.Now()
	r := runGenerate(t, cfg, "Describe your routing experience", "", 150)
	if time.Since(start) > 3*time.Second {
		t.Fatal("deadline not enforced")
	}
	wantFail(t, r.frames[0], protocol.CodeStorageError)
	if rec.count() != 0 || !strings.Contains(r.stderr, "event="+EventProfileTimeout) {
		t.Fatalf("calls=%d stderr=%q", rec.count(), r.stderr)
	}
	requireStderrEventsOnly(t, r.stderr)
}

func TestGenerateProviderReceivesTheWholeProfile(t *testing.T) {
	home := seedProfile(t, func(s *profile.Store) {
		if _, err := s.SetResume(profile.ResumeInput{Text: "Built routing software " + selSentinel, Source: profile.SourceDOCX}); err != nil {
			t.Fatal(err)
		}
		// The fake cites the first story's start, so only later stories carry
		// the sentinel that must stay out of the response.
		for i, title := range []string{"Routing rewrite", "Orchestra"} {
			text := "Story text for the routing rewrite project"
			if i > 0 {
				text = "Story text " + unselSentinel + title
			}
			if _, err := s.UpsertStory(profile.StoryInput{Title: title, Text: text}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.UpsertSample(profile.SampleInput{Label: "sample", Text: "Sample text " + unselSentinel}); err != nil {
			t.Fatal(err)
		}
		off := false
		if _, err := s.UpsertRule(profile.RuleInput{Kind: profile.KindTone, Text: "Rule text " + unselSentinel}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UpsertRule(profile.RuleInput{Kind: profile.KindAvoid, Text: "Disabled rule " + unselSentinel, Enabled: &off}); err != nil {
			t.Fatal(err)
		}
	})
	rec := &recorder{inner: fake.FakeProvider{}}
	r := runGenerate(t, Config{Provider: rec, Home: home}, "Why do you want to work here?", "We operate kubernetes at scale", 150)
	f := r.frames[0]
	if !f.OK {
		t.Fatalf("got %+v", f)
	}
	if rec.count() != 1 {
		t.Fatalf("provider calls = %d", rec.count())
	}
	in := rec.calls[0]
	if in.Profile.Resume == nil || in.Profile.Resume.Source != profile.SourceDOCX || len(in.Profile.Stories) != 2 ||
		len(in.Profile.Samples) != 1 || len(in.Profile.Rules) != 2 {
		t.Fatalf("provider did not get the whole profile: %+v", in.Profile)
	}
	if in.Request.Question != "Why do you want to work here?" || in.Request.JobContext == nil || *in.Request.JobContext != "We operate kubernetes at scale" {
		t.Fatalf("request not passed through: %+v", in.Request)
	}
	// Only the draft's answer and its verified quotes return; profile text
	// beyond the snippets the fake quotes stays out of stdout and stderr.
	if strings.Contains(r.stdout, unselSentinel) {
		t.Fatal("profile content other than the quoted snippets reached stdout")
	}
	requireStderrEventsOnly(t, r.stderr, unselSentinel, selSentinel)
}

// TestAC030MaximumProfileIsSentWholeAndWithinTheCap covers AC-030 for the
// store-side half: a profile at exactly 40,000 code points reaches the
// provider whole, and the provider input never exceeds the cap.
func TestAC030MaximumProfileIsSentWholeAndWithinTheCap(t *testing.T) {
	home := seedProfile(t, func(s *profile.Store) {
		if _, err := s.SetResume(profile.ResumeInput{Text: strings.Repeat("r", limits.MaxResumeChars), Source: profile.SourcePasted}); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5; i++ {
			if _, err := s.UpsertStory(profile.StoryInput{Title: fmt.Sprintf("Story %d", i), Text: strings.Repeat("s", limits.MaxStoryChars)}); err != nil {
				t.Fatal(err)
			}
		}
		for i := 0; i < 3; i++ {
			if _, err := s.UpsertSample(profile.SampleInput{Label: "l", Text: strings.Repeat("w", limits.MaxSampleChars)}); err != nil {
				t.Fatal(err)
			}
		}
		p, err := s.Load()
		if err != nil {
			t.Fatal(err)
		}
		room := limits.MaxProfileTotalChars - p.ContentChars()
		if _, err := s.UpsertSample(profile.SampleInput{Label: "l", Text: strings.Repeat("z", room)}); err != nil {
			t.Fatal(err)
		}
	})
	rec := &recorder{inner: fake.FakeProvider{}}
	r := runGenerate(t, Config{Provider: rec, Home: home}, "Describe your routing projects", "", 150)
	if !r.frames[0].OK || rec.count() != 1 {
		t.Fatalf("got %+v", r.frames[0])
	}
	d, err := protocol.ParseDraftResponse(r.frames[0].Result)
	if err != nil || len(d.Evidence) != 2 {
		t.Fatalf("max-size profile draft: %+v %v", d, err)
	}
	in := rec.calls[0]
	if n := in.Profile.ContentChars(); n != limits.MaxProfileTotalChars || len(in.Profile.Stories) != 5 || len(in.Profile.Samples) != 4 {
		t.Fatalf("content = %d stories=%d samples=%d", n, len(in.Profile.Stories), len(in.Profile.Samples))
	}
}

// A hand-edited profile over the cap is never sent: INVALID_REQUEST, no
// provider call.
func TestGenerateRejectsAnOverCapProfile(t *testing.T) {
	now := "2026-11-20T10:00:00Z"
	p := profile.Profile{SchemaVersion: profile.SchemaVersion, NextID: 1, Settings: profile.Settings{Provider: profile.ProviderClaude, DisclosureAcceptedAt: now}, Resume: &profile.Resume{Text: strings.Repeat("r", limits.MaxResumeChars), Source: profile.SourcePasted, UpdatedAt: now},
		Stories: []profile.Story{}, Samples: []profile.WritingSample{}, Rules: []profile.WritingRule{}}
	for i := 0; i < 9; i++ { // 15,000 + 9 x 3,001 = 42,009
		p.Stories = append(p.Stories, profile.Story{ID: fmt.Sprintf("s_%d", p.NextID), Title: "t", Text: strings.Repeat("s", limits.MaxStoryChars), CreatedAt: now, UpdatedAt: now})
		p.NextID++
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	writeProfileFile(t, home, string(raw))
	rec := &recorder{inner: fake.FakeProvider{}}
	r := runGenerate(t, Config{Provider: rec, Home: home}, "Describe your routing projects", "", 150)
	wantFail(t, r.frames[0], protocol.CodeInvalidRequest)
	if rec.count() != 0 || !strings.Contains(r.stderr, "event="+EventProfileOverCap) {
		t.Fatalf("calls=%d stderr=%q", rec.count(), r.stderr)
	}
	requireStderrEventsOnly(t, r.stderr)
}

// A misbehaving provider fails closed: an invalid evidence quote, no quote, or
// an unsupported number is FACT_VALIDATION_FAILED; empty and over-length answers
// are PROVIDER_OUTPUT_INVALID. No answer text reaches the panel.
func TestMisbehavingProviderFailsClosed(t *testing.T) {
	home := seedProfile(t, func(s *profile.Store) {
		if _, err := s.SetResume(profile.ResumeInput{Text: "Built routing software for logistics", Source: profile.SourcePasted}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UpsertSample(profile.SampleInput{Label: "sample", Text: "A writing sample that is not evidence"}); err != nil {
			t.Fatal(err)
		}
	})
	const answer = "MISBEHAVEANSWERTEXT draft that should never reach the panel."
	good := []protocol.EvidenceQuote{{Source: "resume", Quote: "Built routing software"}}
	behave := func(mod func(r *protocol.DraftResponse)) provider.Provider {
		return funcProvider(func(provider.Input) protocol.DraftResponse {
			r := protocol.DraftResponse{Answer: answer, Evidence: good, Warnings: []protocol.DraftWarning{}}
			mod(&r)
			return r
		})
	}
	tests := []struct {
		name string
		p    provider.Provider
		code protocol.ErrorCode
	}{
		{"unknown story source", behave(func(r *protocol.DraftResponse) {
			r.Evidence = []protocol.EvidenceQuote{{Source: "story:s_99", Quote: "Built routing software"}}
		}), protocol.CodeFactValidationFailed},
		{"quote is not an excerpt", behave(func(r *protocol.DraftResponse) {
			r.Evidence = []protocol.EvidenceQuote{{Source: "resume", Quote: "Built routing hardware"}}
		}), protocol.CodeFactValidationFailed},
		{"no evidence", behave(func(r *protocol.DraftResponse) { r.Evidence = nil }), protocol.CodeFactValidationFailed},
		{"unsupported number", behave(func(r *protocol.DraftResponse) { r.Answer = answer + " It cut latency by 45%." }), protocol.CodeFactValidationFailed},
		{"empty answer", behave(func(r *protocol.DraftResponse) { r.Answer = "  " }), protocol.CodeProviderOutputInvalid},
		{"over-length answer", behave(func(r *protocol.DraftResponse) { r.Answer = answer + strings.Repeat(" word", 200) }), protocol.CodeProviderOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := runGenerate(t, Config{Provider: tt.p, Home: home}, "Describe your routing software", "", 150)
			wantFail(t, r.frames[0], tt.code)
			if strings.Contains(r.stdout, "MISBEHAVEANSWERTEXT") || strings.Contains(r.stderr, "MISBEHAVE") {
				t.Fatal("answer leaked")
			}
			requireStderrEventsOnly(t, r.stderr, "MISBEHAVE")
		})
	}
}
