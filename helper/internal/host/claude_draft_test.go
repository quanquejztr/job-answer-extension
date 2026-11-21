package host

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/provider/claude"
	"jobanswer/helper/internal/provider/fake"
)

// These tests run the host's draft path with the real claude.Provider over a
// fake `claude` executable (testdata/fakeclaude) that reads the real prompt and
// answers according to a mode file in the throwaway home. No real provider is
// ever started: the executable is located only in the directory holding the
// fake.

var fakeClaudeDir string // directory holding the built fake `claude`

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "hostfakeclaude-")
	if err != nil {
		panic(err)
	}
	build := exec.Command("go", "build", "-o", filepath.Join(dir, claude.Executable), "./testdata/fakeclaude")
	if out, err := build.CombinedOutput(); err != nil {
		panic(string(out))
	}
	fakeClaudeDir = dir
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

const (
	claudeResume = "I built routing software for small logistics teams in 2022 at Acme Freight."
	claudeStory  = "Played cello in a community orchestra every weekend for years."
	// leakWords must never reach stdout or stderr beyond the verified quotes.
	providerSecret = "SECRET-PROVIDER-TEXT"
)

// fakeClaudeConfig is a Config whose provider and diagnoser are the real Claude
// adapter over the fake executable, with the exact production child
// environment (HOME, PATH, USER) and the fake's directory as the only PATH.
func fakeClaudeConfig(home string, timeout time.Duration) Config {
	env := claude.ChildEnv(home, fakeClaudeDir, "fakeuser")
	locate := func() (string, error) { return claude.Locate([]string{fakeClaudeDir}) }
	return Config{
		Provider: claude.Provider{
			Locate: locate, Timeout: timeout,
			Runner: claude.ExecRunner{Env: env, MaxStdout: limits.MaxNativeResponseBytes},
		},
		Diagnoser: claude.Diagnoser{Locate: locate, Runner: claude.ExecRunner{Env: env, MaxStdout: 4 * 1024}, Timeout: 5 * time.Second},
		Home:      home,
	}
}

func setFakeMode(t *testing.T, home, mode string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(home, "fake-claude-mode"), []byte(mode+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func fakeCalls(t *testing.T, home string) []string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(home, "fake-claude-calls.log"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Fields(string(b))
}

func claudeHome(t *testing.T, mode string) string {
	t.Helper()
	home := seedProfile(t, func(s *profile.Store) {
		if _, err := s.SetResume(profile.ResumeInput{Text: claudeResume, Source: profile.SourcePasted}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UpsertStory(profile.StoryInput{Title: "Orchestra", Text: claudeStory}); err != nil {
			t.Fatal(err)
		}
	})
	setFakeMode(t, home, mode)
	return home
}

const claudeQuestion = "Why do you want to work at Acme?"

// runLive serves the bodies through one Run whose stdin stays open until every
// response has been read, as Chrome's port does (stdin EOF cancels in-flight
// provider work, so a fixed in-memory input would cancel a real process).
func runLive(t *testing.T, cfg Config, bodies ...string) genRun {
	t.Helper()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	var errBuf bytes.Buffer
	cfg.Log = NewLogger(&errBuf)
	done := make(chan error, 1)
	go func() {
		err := Run(context.Background(), inR, outW, cfg)
		_ = outW.Close()
		done <- err
	}()
	var raw bytes.Buffer
	tee := io.TeeReader(outR, &raw)
	var frames []protocol.ResponseEnvelope
	for _, b := range bodies {
		if _, err := inW.Write(frameOf(t, b)); err != nil {
			t.Fatal(err)
		}
		msg, err := protocol.ReadMessage(tee, limits.MaxNativeResponseBytes)
		if err != nil {
			t.Fatal(err)
		}
		env, err := protocol.ParseResponse(msg)
		if err != nil {
			t.Fatal(err)
		}
		frames = append(frames, env)
	}
	_ = inW.Close()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	return genRun{frames: frames, stdout: raw.String(), stderr: errBuf.String()}
}

// generateLive is runGenerate over runLive.
func generateLive(t *testing.T, cfg Config, question string) genRun {
	t.Helper()
	return runLive(t, cfg, generateBody("g1", question, 150, ""))
}

func TestClaudeDraftSuccessIsValidatedAndReturned(t *testing.T) {
	home := claudeHome(t, "ok")
	r := generateLive(t, fakeClaudeConfig(home, 10*time.Second), claudeQuestion)
	if !r.frames[0].OK {
		t.Fatalf("got %+v", r.frames[0])
	}
	d, err := protocol.ParseDraftResponse(r.frames[0].Result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(d.Answer, "Deterministic sample draft based on your saved resume: "+claudeResume) {
		t.Fatalf("answer = %q", d.Answer)
	}
	want := []protocol.EvidenceQuote{
		{Source: "resume", Quote: claudeResume},
		{Source: "story:s_1", Quote: claudeStory},
	}
	if len(d.Evidence) != 2 || d.Evidence[0] != want[0] || d.Evidence[1] != want[1] || len(d.Warnings) != 0 {
		t.Fatalf("evidence = %+v warnings = %+v", d.Evidence, d.Warnings)
	}
	if calls := fakeCalls(t, home); len(calls) != 1 || calls[0] != "draft" {
		t.Fatalf("fake claude calls = %v", calls)
	}
	// stdout is the response only; stderr holds event names, never content.
	requireStderrEventsOnly(t, r.stderr, claudeResume, claudeStory, "Deterministic", claudeQuestion)
}

// Warnings are data, not proof: the validator adds an unsupported-name warning
// and the model's own note passes through, and the draft is still returned
// with its verified evidence.
func TestClaudeDraftWarningsAreReturnedAsData(t *testing.T) {
	home := claudeHome(t, "ok-warnings")
	r := generateLive(t, fakeClaudeConfig(home, 10*time.Second), claudeQuestion)
	if !r.frames[0].OK {
		t.Fatalf("got %+v", r.frames[0])
	}
	d, err := protocol.ParseDraftResponse(r.frames[0].Result)
	if err != nil {
		t.Fatal(err)
	}
	codes := map[string]bool{}
	for _, w := range d.Warnings {
		codes[w.Code] = true
	}
	if !codes["UNSUPPORTED_CLAIM"] || !codes["MODEL_NOTE"] || len(d.Evidence) == 0 {
		t.Fatalf("warnings = %+v evidence = %+v", d.Warnings, d.Evidence)
	}
	requireStderrEventsOnly(t, r.stderr, "Zorblax", claudeResume)
}

// Every bad provider output fails before any answer reaches the panel, with
// the catalog code for that failure and nothing from the provider in stdout or
// stderr.
func TestClaudeDraftFailuresNeverReachThePanel(t *testing.T) {
	tests := []struct {
		mode string
		code protocol.ErrorCode
	}{
		{"not-authenticated", protocol.CodeProviderNotAuthenticated},
		{"usage-limit", protocol.CodeProviderUsageLimit},
		{"other-error", protocol.CodeProviderOutputInvalid},
		{"malformed", protocol.CodeProviderOutputInvalid},
		{"no-structured", protocol.CodeProviderOutputInvalid},
		{"extra-key", protocol.CodeProviderOutputInvalid},
		{"bad-warning-code", protocol.CodeProviderOutputInvalid},
		{"big", protocol.CodeProviderOutputInvalid},
		{"refusal", protocol.CodeProviderOutputInvalid},
		{"empty-answer", protocol.CodeProviderOutputInvalid},
		{"over-limit", protocol.CodeProviderOutputInvalid},
		{"bad-quote", protocol.CodeFactValidationFailed},
		{"bad-source", protocol.CodeFactValidationFailed},
		{"no-evidence", protocol.CodeFactValidationFailed},
		{"bad-number", protocol.CodeFactValidationFailed},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			home := claudeHome(t, tt.mode)
			r := generateLive(t, fakeClaudeConfig(home, 10*time.Second), claudeQuestion)
			wantFail(t, r.frames[0], tt.code)
			for _, leak := range []string{providerSecret, "Deterministic", "cannot answer", "87%", claudeResume} {
				if strings.Contains(r.stdout, leak) {
					t.Fatalf("stdout leaks %q", leak)
				}
			}
			if calls := fakeCalls(t, home); len(calls) != 1 || calls[0] != "draft" {
				t.Fatalf("fake claude calls = %v", calls)
			}
			requireStderrEventsOnly(t, r.stderr, providerSecret, "Deterministic", claudeResume, claudeStory, claudeQuestion, "cannot answer")
			if !strings.Contains(r.stderr, "event="+EventRequestFailed+" code="+string(tt.code)) {
				t.Fatalf("stderr = %q", r.stderr)
			}
		})
	}
}

func TestClaudeExecutableMissingIsProviderNotFound(t *testing.T) {
	home := claudeHome(t, "ok")
	cfg := fakeClaudeConfig(home, 10*time.Second)
	empty := t.TempDir()
	cfg.Provider = claude.Provider{
		Locate: func() (string, error) { return claude.Locate([]string{empty}) },
		Runner: claude.ExecRunner{Env: claude.ChildEnv(home, empty, "fakeuser")},
	}
	r := generateLive(t, cfg, claudeQuestion)
	wantFail(t, r.frames[0], protocol.CodeProviderNotFound)
	if calls := fakeCalls(t, home); len(calls) != 0 {
		t.Fatalf("fake ran: %v", calls)
	}
}

func TestClaudeDraftTimeout(t *testing.T) {
	home := claudeHome(t, "hang")
	r := generateLive(t, fakeClaudeConfig(home, 300*time.Millisecond), claudeQuestion)
	wantFail(t, r.frames[0], protocol.CodeProviderTimeout)
	pid := readPid(t, home)
	if err := syscall.Kill(pid, 0); err == nil {
		t.Fatal("provider process still running after the timeout")
	}
}

func readPid(t *testing.T, home string) int {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(home, "fake-claude-pid"))
	if err != nil {
		t.Fatalf("pid file: %v", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	return pid
}

// Closing the port (stdin EOF) while claude runs cancels the provider: the
// process is killed and the response is PROVIDER_CANCELLED.
func TestClaudeDraftCancellationKillsTheProcess(t *testing.T) {
	home := claudeHome(t, "hang")
	cfg := fakeClaudeConfig(home, 60*time.Second)
	body := generateBody("c1", claudeQuestion, 150, "")
	var errBuf bytes.Buffer
	cfg.Log = NewLogger(&errBuf)
	rd, wr, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer rd.Close()
	var out bytes.Buffer
	finished := make(chan error, 1)
	go func() { finished <- Run(context.Background(), rd, &out, cfg) }()
	if _, err := wr.Write(frameOf(t, body)); err != nil {
		t.Fatal(err)
	}
	// Wait (bounded) for the fake to record its pid: it is then running.
	pidFile := filepath.Join(home, "fake-claude-pid")
	deadline := time.After(10 * time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		if _, err := os.Stat(pidFile); err == nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("fake claude did not start")
		case <-tick.C:
		}
	}
	pid := readPid(t, home)
	if err := syscall.Kill(pid, 0); err != nil {
		t.Fatalf("provider not running before cancel: %v", err)
	}
	_ = wr.Close() // Chrome disconnects the port
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("Run err = %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after stdin closed")
	}
	msg, err := protocol.ReadMessage(&out, limits.MaxNativeResponseBytes)
	if err != nil {
		t.Fatal(err)
	}
	env, err := protocol.ParseResponse(msg)
	if err != nil || env.OK || env.Error.Code != protocol.CodeProviderCancelled {
		t.Fatalf("env = %+v err = %v", env, err)
	}
	// Run returns only after the process was waited on, so it is already gone.
	if err := syscall.Kill(pid, 0); err == nil {
		t.Fatal("provider process still running after cancel")
	}
	requireStderrEventsOnly(t, errBuf.String(), claudeResume, claudeQuestion)
}

// FR-005: no draft and no provider call until a provider is chosen and the
// disclosure is accepted, whatever the panel showed.
func TestDraftIsBlockedWithoutProviderChoiceOrDisclosure(t *testing.T) {
	seed := func(t *testing.T, mut func(s *profile.Store)) string {
		home := t.TempDir()
		s, err := profile.NewStore(DataDir(home), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetResume(profile.ResumeInput{Text: claudeResume, Source: profile.SourcePasted}); err != nil {
			t.Fatal(err)
		}
		mut(s)
		setFakeMode(t, home, "ok")
		return home
	}
	accept := func(s *profile.Store) {
		if err := s.AcceptDisclosure(); err != nil {
			t.Fatal(err)
		}
	}
	choose := func(name string) func(s *profile.Store) {
		return func(s *profile.Store) {
			if err := s.SetProvider(name); err != nil {
				t.Fatal(err)
			}
		}
	}
	tests := []struct {
		name  string
		mut   func(s *profile.Store)
		event string
	}{
		{"nothing chosen", func(*profile.Store) {}, EventNoProvider},
		{"disclosure accepted but no provider", accept, EventNoProvider},
		{"provider chosen but disclosure not accepted", choose("claude"), EventNoDisclosure},
		{"codex chosen and accepted (no adapter yet)", func(s *profile.Store) { choose("codex")(s); accept(s) }, EventProviderUnsupported},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			home := seed(t, tt.mut)
			rec := &recorder{inner: fake.FakeProvider{}}
			cfg := fakeClaudeConfig(home, 5*time.Second)
			cfg.Provider = rec
			r := generateLive(t, cfg, claudeQuestion)
			wantFail(t, r.frames[0], protocol.CodeInvalidRequest)
			if rec.count() != 0 || len(fakeCalls(t, home)) != 0 {
				t.Fatal("a provider was called")
			}
			if !strings.Contains(r.stderr, "event="+tt.event) {
				t.Fatalf("stderr = %q", r.stderr)
			}
			requireStderrEventsOnly(t, r.stderr, claudeResume)
		})
	}
}

func settingsReply(t *testing.T, home string, bodies ...string) []protocol.ResponseEnvelope {
	t.Helper()
	return runProfile(t, home, 0, bodies...).frames
}

func TestSettingsSetProviderAndAcceptDisclosure(t *testing.T) {
	home := t.TempDir()
	set := func(id, p string) string {
		return `{"protocolVersion":1,"requestId":"` + id + `","type":"settings.setProvider","payload":{"provider":"` + p + `"}}`
	}
	accept := `{"protocolVersion":1,"requestId":"a1","type":"settings.acceptDisclosure","payload":{}}`
	get := `{"protocolVersion":1,"requestId":"g1","type":"profile.get","payload":{}}`
	frames := settingsReply(t, home, set("p1", "claude"), accept, get)
	if len(frames) != 3 || !frames[0].OK || string(frames[0].Result) != `{"provider":"claude"}` {
		t.Fatalf("setProvider: %+v", frames)
	}
	var acc struct {
		DisclosureAcceptedAt string `json:"disclosureAcceptedAt"`
	}
	if !frames[1].OK || json.Unmarshal(frames[1].Result, &acc) != nil {
		t.Fatalf("acceptDisclosure: %+v", frames[1])
	}
	if _, err := time.Parse(time.RFC3339, acc.DisclosureAcceptedAt); err != nil {
		t.Fatalf("timestamp %q: %v", acc.DisclosureAcceptedAt, err)
	}
	var p profile.Profile
	if err := json.Unmarshal(frames[2].Result, &p); err != nil || p.Settings.Provider != "claude" || p.Settings.DisclosureAcceptedAt != acc.DisclosureAcceptedAt {
		t.Fatalf("profile settings = %+v err = %v", p.Settings, err)
	}
	// Codex is storable (PRD) and the choice can be changed.
	frames = settingsReply(t, home, set("p2", "codex"), get)
	if !frames[0].OK || string(frames[0].Result) != `{"provider":"codex"}` {
		t.Fatalf("codex: %+v", frames[0])
	}
	// Unknown providers and extra fields are rejected before anything is stored.
	for _, bad := range []string{
		set("p3", "gpt"),
		set("p4", ""),
		`{"protocolVersion":1,"requestId":"p5","type":"settings.setProvider","payload":{"provider":"claude","extra":1}}`,
		`{"protocolVersion":1,"requestId":"p6","type":"settings.setProvider","payload":{}}`,
		`{"protocolVersion":1,"requestId":"p7","type":"settings.acceptDisclosure","payload":{"at":"2020-01-01T00:00:00Z"}}`,
	} {
		f := settingsReply(t, home, bad)
		if len(f) != 1 || f[0].OK || f[0].Error.Code != protocol.CodeInvalidRequest {
			t.Errorf("%s: %+v", bad, f)
		}
	}
	f := settingsReply(t, home, get)
	if err := json.Unmarshal(f[0].Result, &p); err != nil || p.Settings.Provider != "codex" {
		t.Fatalf("settings after rejects = %+v", p.Settings)
	}
}

func TestDiagnosticsRunTheChosenClaudeThroughTheFakeExecutable(t *testing.T) {
	run := func(t *testing.T, home string) diagnosticsResult {
		t.Helper()
		body := `{"protocolVersion":1,"requestId":"d1","type":"diagnostics.run","payload":{}}`
		env := runLive(t, fakeClaudeConfig(home, 5*time.Second), body).frames[0]
		if !env.OK {
			t.Fatalf("env = %+v", env)
		}
		var res diagnosticsResult
		if err := json.Unmarshal(env.Result, &res); err != nil {
			t.Fatal(err)
		}
		return res
	}
	home := claudeHome(t, "ok")
	res := run(t, home)
	if len(res.Checks) != 3 || !res.Checks[1].OK || !res.Checks[2].OK {
		t.Fatalf("ok: %+v", res)
	}
	setFakeMode(t, home, "not-authenticated")
	res = run(t, home)
	if len(res.Checks) != 3 || res.Checks[2].OK || res.Checks[2].Code != string(protocol.CodeProviderNotAuthenticated) {
		t.Fatalf("signed out: %+v", res)
	}
	if calls := fakeCalls(t, home); strings.Join(calls, ",") != "auth,auth" {
		t.Fatalf("calls = %v", calls)
	}
}

var _ provider.Provider = claude.Provider{}
