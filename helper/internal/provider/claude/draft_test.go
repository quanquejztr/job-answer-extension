package claude

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/prompt"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
)

type record struct {
	Args       []string
	Env        []string
	Stdin      string
	Wd         string
	DirEntries int
	Pid        int
	Home       string
}

func draftInput() provider.Input {
	jc := "We build budgeting software."
	return provider.Input{
		Request: protocol.DraftRequest{
			Question:    "Why do you want to work here?",
			JobContext:  &jc,
			Constraints: protocol.DraftConstraints{MaxWords: 120},
			RequestedAt: "2026-11-20T10:00:00Z",
		},
		Profile: profile.Profile{
			SchemaVersion: profile.SchemaVersion,
			NextID:        5,
			Resume:        &profile.Resume{Text: "Built a budgeting tool in Go.\nLed a team of 3 in 2022."},
			Stories:       []profile.Story{{ID: "s_1", Title: "Club", Text: "I wrote a tool for the club."}},
			Rules:         []profile.WritingRule{{ID: "r_2", Kind: "tone", Text: "Keep it plain.", Enabled: true}},
		},
	}
}

func fakeProvider(t *testing.T, mode string, extraEnv ...string) (Provider, string) {
	t.Helper()
	rec := filepath.Join(t.TempDir(), "record.json")
	env := append([]string{"FAKE_CLAUDE_MODE=" + mode, "FAKE_CLAUDE_RECORD=" + rec}, ChildEnv("/fake-home", "/fake-path", "fakeuser")...)
	env = append(env, extraEnv...)
	return Provider{
		Locate:  func() (string, error) { return Locate([]string{fakeBin}) },
		Runner:  ExecRunner{Env: env, MaxStdout: limits.MaxNativeResponseBytes},
		Timeout: 5 * time.Second,
	}, rec
}

func readRecord(t *testing.T, path string) record {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var r record
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDraftSuccessExactInvocation(t *testing.T) {
	t.Setenv("JOBANSWER_PARENT_SECRET", "PARENT-ENV-SECRET")
	p, recPath := fakeProvider(t, "draft-ok")
	in := draftInput()
	got, err := p.Draft(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if got.Answer != "I built a budgeting tool." || len(got.Evidence) != 1 ||
		got.Evidence[0] != (protocol.EvidenceQuote{Source: "resume", Quote: "Built a budgeting tool in Go."}) ||
		len(got.Warnings) != 1 || got.Warnings[0].Code != "MODEL_NOTE" {
		t.Fatalf("response = %+v", got)
	}

	rec := readRecord(t, recPath)
	wantArgs := []string{
		"-p", "--safe-mode", "--tools", "", "--no-session-persistence", "--disable-slash-commands",
		"--output-format", "json", "--json-schema", prompt.Schema,
	}
	if strings.Join(rec.Args, "\x00") != strings.Join(wantArgs, "\x00") {
		t.Errorf("args = %q", rec.Args)
	}
	for _, a := range rec.Args {
		if a == "--bare" || strings.Contains(a, "dangerously") || strings.Contains(a, "bypass") || strings.Contains(a, "Built a budgeting") {
			t.Errorf("forbidden or data-bearing arg %q", a)
		}
	}
	// Stdin is exactly the prompt the builder produces for this input (the
	// nonce is random, so compare structure and content, not bytes).
	for _, want := range []string{"Built a budgeting tool in Go.", "Why do you want to work here?", "We build budgeting software.", "Maximum words: 120", "Keep it plain."} {
		if !strings.Contains(rec.Stdin, want) {
			t.Errorf("stdin lacks %q", want)
		}
	}
	if !strings.HasSuffix(rec.Stdin, "Respond now with the JSON object only.\n") || strings.Contains(rec.Stdin, "PARENT-ENV-SECRET") {
		t.Error("stdin is not just the prompt")
	}
	if strings.Join(rec.Env, ",") != "FAKE_CLAUDE_MODE,FAKE_CLAUDE_RECORD,HOME,PATH,USER" {
		t.Errorf("env = %v", rec.Env)
	}
	if rec.Home != "/fake-home" || rec.DirEntries != 0 {
		t.Errorf("home %q, dir entries %d", rec.Home, rec.DirEntries)
	}
	if _, err := os.Stat(rec.Wd); !os.IsNotExist(err) {
		t.Errorf("private working dir %s not removed", rec.Wd)
	}
}

func TestDraftNoShellInterpretation(t *testing.T) {
	p, recPath := fakeProvider(t, "draft-ok")
	marker := filepath.Join(t.TempDir(), "PWNED")
	in := draftInput()
	in.Request.Question = "Why $(touch " + marker + ") `touch " + marker + "`; touch " + marker + " | x"
	if _, err := p.Draft(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	rec := readRecord(t, recPath)
	if !strings.Contains(rec.Stdin, "$(touch "+marker+")") {
		t.Error("question was altered on stdin")
	}
	for _, a := range rec.Args {
		if strings.Contains(a, marker) {
			t.Error("question reached argv")
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("a shell ran the question")
	}
}

func TestDraftErrorMapping(t *testing.T) {
	tests := []struct {
		mode string
		want error
	}{
		{"print-notloggedin", provider.ErrNotAuthenticated},
		{"print-usagelimit", provider.ErrUsageLimit},
		{"print-other-error", provider.ErrOutputInvalid}, // is_error
		{"print-nostructured", provider.ErrOutputInvalid},
		{"garbage", provider.ErrOutputInvalid}, // malformed JSON
		{"exit2", provider.ErrOutputInvalid},
		{"print-ok", provider.ErrOutputInvalid}, // structure lacks evidence/warnings
		{"draft-structured-string", provider.ErrOutputInvalid},
		{"draft-extra-key", provider.ErrOutputInvalid},
		{"draft-bad-warning", provider.ErrOutputInvalid},
		{"draft-empty-answer", provider.ErrOutputInvalid},
		{"huge", provider.ErrOutputInvalid}, // over the 512 KiB response cap
		{"unknown-mode", provider.ErrOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			p, _ := fakeProvider(t, tt.mode)
			got, err := p.Draft(context.Background(), draftInput())
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if got.Answer != "" || len(got.Evidence) != 0 {
				t.Fatalf("partial response: %+v", got)
			}
			for _, secret := range []string{"SECRET", "budgeting", "Why do you", "Built a"} {
				if strings.Contains(err.Error(), secret) {
					t.Fatalf("error leaks %q: %v", secret, err)
				}
			}
		})
	}
}

func TestDraftOversizedOutputBounded(t *testing.T) {
	p, _ := fakeProvider(t, "huge")
	p.Runner = ExecRunner{Env: p.Runner.(ExecRunner).Env, MaxStdout: limits.MaxNativeResponseBytes}
	res, err := p.Runner.Run(context.Background(), Command{Path: filepath.Join(fakeBin, Executable)})
	if err != nil || !res.Truncated || len(res.Stdout) != limits.MaxNativeResponseBytes {
		t.Fatalf("runner kept %d bytes (err %v, truncated %v)", len(res.Stdout), err, res.Truncated)
	}
}

func TestDraftRunnerErrorsPassThroughClassifier(t *testing.T) {
	in := draftInput()
	base := Provider{Locate: func() (string, error) { return "/x/claude", nil }}
	cases := []struct {
		name   string
		runErr error
		want   error
	}{
		{"start", ErrStart, provider.ErrOutputInvalid},
		{"deadline", context.DeadlineExceeded, provider.ErrTimeout},
		{"cancelled", context.Canceled, provider.ErrCancelled},
	}
	for _, c := range cases {
		p := base
		p.Runner = stubRunner{err: c.runErr}
		if _, err := p.Draft(context.Background(), in); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v", c.name, err)
		}
	}
	// A runner that ignores its cap is still held to 512 KiB.
	p := base
	p.Runner = stubRunner{res: Result{Stdout: []byte(strings.Repeat(" ", limits.MaxNativeResponseBytes+1))}}
	if _, err := p.Draft(context.Background(), in); !errors.Is(err, provider.ErrOutputInvalid) {
		t.Errorf("oversized: %v", err)
	}
}

type stubRunner struct {
	res Result
	err error
}

func (s stubRunner) Run(context.Context, Command) (Result, error) { return s.res, s.err }

func TestDraftNotFound(t *testing.T) {
	p, _ := fakeProvider(t, "draft-ok")
	p.Locate = func() (string, error) { return Locate([]string{t.TempDir()}) }
	if _, err := p.Draft(context.Background(), draftInput()); !errors.Is(err, provider.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	p.Locate = func() (string, error) { return "", errors.New("weird /secret/path") }
	if _, err := p.Draft(context.Background(), draftInput()); !errors.Is(err, provider.ErrOutputInvalid) {
		t.Fatalf("err = %v", err)
	}
}

func TestDraftInputBounds(t *testing.T) {
	p, recPath := fakeProvider(t, "draft-ok")
	over := draftInput()
	over.Profile.Resume.Text = strings.Repeat("x", limits.MaxProfileTotalChars+1)
	noResume := draftInput()
	noResume.Profile.Resume = nil
	for name, in := range map[string]provider.Input{"over cap": over, "no resume": noResume} {
		if _, err := p.Draft(context.Background(), in); !errors.Is(err, provider.ErrInvalidInput) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := os.Stat(recPath); !os.IsNotExist(err) {
		t.Fatal("the process ran for invalid input")
	}
	// The byte cap is separate from the code-point cap: 40,000 four-byte
	// characters plus context stays under 256 KiB, so it is only a backstop.
	if provider.CodeFor(provider.ErrInvalidInput) != protocol.CodeInvalidRequest {
		t.Fatal("ErrInvalidInput must map to INVALID_REQUEST")
	}
}

func TestDraftTimeoutKillsProcess(t *testing.T) {
	p, recPath := fakeProvider(t, "hang-record")
	p.Timeout = 500 * time.Millisecond
	start := time.Now()
	_, err := p.Draft(context.Background(), draftInput())
	if !errors.Is(err, provider.ErrTimeout) {
		t.Fatalf("err = %v", err)
	}
	if time.Since(start) > 10*time.Second {
		t.Fatal("timeout was not enforced promptly")
	}
	assertGone(t, readRecord(t, recPath).Pid)
}

func TestDraftCancellationKillsProcess(t *testing.T) {
	p, recPath := fakeProvider(t, "hang-record")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := p.Draft(ctx, draftInput()); done <- err }()

	// Wait for the observable event: the fake has started and recorded itself.
	deadline := time.After(10 * time.Second)
	for {
		if b, err := os.ReadFile(recPath); err == nil && json.Valid(b) {
			break
		}
		select {
		case <-deadline:
			t.Fatal("fake claude never started")
		case err := <-done:
			t.Fatalf("draft ended early: %v", err)
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, provider.ErrCancelled) {
			t.Fatalf("err = %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("draft did not stop after cancel")
	}
	assertGone(t, readRecord(t, recPath).Pid)
}

func TestDraftAlreadyCancelledDoesNotRun(t *testing.T) {
	p, recPath := fakeProvider(t, "draft-ok")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.Draft(ctx, draftInput()); !errors.Is(err, provider.ErrCancelled) {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Stat(recPath); !os.IsNotExist(err) {
		t.Fatal("process ran after cancellation")
	}
}

func assertGone(t *testing.T, pid int) {
	t.Helper()
	if pid <= 0 {
		t.Fatal("no pid recorded")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("process %d is still running", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestNewProviderWiring(t *testing.T) {
	p := NewProvider("/Users/x", "/usr/bin:/bin", "x")
	r, ok := p.Runner.(ExecRunner)
	if !ok {
		t.Fatalf("runner %T", p.Runner)
	}
	if got := strings.Join(r.Env, "\n"); !strings.HasPrefix(got, "HOME=/Users/x\nPATH=/usr/bin:/bin:") || !strings.HasSuffix(got, "\nUSER=x") || len(r.Env) != 3 {
		t.Errorf("env = %q", r.Env)
	}
	if r.MaxStdout != limits.MaxNativeResponseBytes || p.Timeout != 0 || DraftTimeout != 90*time.Second {
		t.Errorf("bounds: %d %v", r.MaxStdout, p.Timeout)
	}
}
