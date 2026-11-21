package claude

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
)

var fakeBin string // directory holding the built fake `claude`

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "fakeclaude-")
	if err != nil {
		panic(err)
	}
	build := exec.Command("go", "build", "-o", filepath.Join(dir, Executable), "./testdata/fakeclaude")
	if out, err := build.CombinedOutput(); err != nil {
		panic(string(out))
	}
	fakeBin = dir
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func runnerFor(mode string) ExecRunner {
	return ExecRunner{Env: []string{"FAKE_CLAUDE_MODE=" + mode, "HOME=/h", "USER=u"}}
}

func runFake(t *testing.T, ctx context.Context, mode string, args ...string) (Result, error) {
	t.Helper()
	return runnerFor(mode).Run(ctx, Command{Path: filepath.Join(fakeBin, Executable), Args: args})
}

func diagnoser(mode string) Diagnoser {
	return Diagnoser{
		Locate:  func() (string, error) { return Locate([]string{fakeBin}) },
		Runner:  runnerFor(mode),
		Timeout: 3 * time.Second,
	}
}

func TestDiagnoseOutcomes(t *testing.T) {
	tests := []struct {
		mode     string
		wantExec bool
		wantCode protocol.ErrorCode // of the sign-in check; empty means OK
	}{
		{"signedin", true, ""},
		{"signedout", true, protocol.CodeProviderNotAuthenticated},
		{"garbage", true, protocol.CodeProviderOutputInvalid},
		{"noflag", true, protocol.CodeProviderOutputInvalid},
		{"signedin-exit1", true, protocol.CodeProviderOutputInvalid},
		{"exit2", true, protocol.CodeProviderOutputInvalid},
		{"big", true, protocol.CodeProviderOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			checks := diagnoser(tt.mode).Diagnose(context.Background())
			if len(checks) != 2 || checks[0].Name != provider.CheckProviderExecutable || !checks[0].OK {
				t.Fatalf("checks = %+v", checks)
			}
			got := checks[1]
			if got.Name != provider.CheckProviderSignIn || got.OK != (tt.wantCode == "") || got.Code != tt.wantCode {
				t.Fatalf("sign-in = %+v, want code %q", got, tt.wantCode)
			}
		})
	}
}

func TestDiagnoseNotFound(t *testing.T) {
	d := Diagnoser{
		Locate: func() (string, error) { return Locate([]string{t.TempDir()}) },
		Runner: runnerFor("signedin"),
	}
	checks := d.Diagnose(context.Background())
	if len(checks) != 1 || checks[0].OK || checks[0].Code != protocol.CodeProviderNotFound ||
		checks[0].Name != provider.CheckProviderExecutable {
		t.Fatalf("checks = %+v", checks)
	}
}

func TestDiagnoseTimeout(t *testing.T) {
	d := diagnoser("hang")
	d.Timeout = 200 * time.Millisecond
	checks := d.Diagnose(context.Background())
	if len(checks) != 2 || checks[1].Code != protocol.CodeProviderTimeout {
		t.Fatalf("checks = %+v", checks)
	}
}

func TestDiagnoseCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	checks := diagnoser("signedin").Diagnose(ctx)
	if len(checks) != 2 || checks[1].Code != protocol.CodeProviderCancelled {
		t.Fatalf("checks = %+v", checks)
	}
}

func TestDiagnoseCancelledWhileRunning(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan []provider.Check, 1)
	go func() { done <- diagnoser("hang").Diagnose(ctx) }()
	cancel()
	select {
	case checks := <-done:
		if len(checks) != 2 || checks[1].Code != protocol.CodeProviderCancelled {
			t.Fatalf("checks = %+v", checks)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("diagnose did not stop after cancel")
	}
}

func TestClassifyPrintWithFake(t *testing.T) {
	tests := []struct {
		mode string
		want error
	}{
		{"print-ok", nil},
		{"print-notloggedin", provider.ErrNotAuthenticated},
		{"print-usagelimit", provider.ErrUsageLimit},
		{"print-other-error", provider.ErrOutputInvalid},
		{"print-nostructured", provider.ErrOutputInvalid},
		{"garbage", provider.ErrOutputInvalid},
		{"exit2", provider.ErrOutputInvalid},
		{"big", provider.ErrOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			res, err := runFake(t, context.Background(), tt.mode, "-p")
			structured, cerr := ClassifyPrint(res, err)
			if !errors.Is(cerr, tt.want) && cerr != tt.want {
				t.Fatalf("err = %v, want %v", cerr, tt.want)
			}
			if tt.want == nil && string(structured) != `{"answer":"x"}` {
				t.Fatalf("structured = %s", structured)
			}
			if cerr != nil && (strings.Contains(cerr.Error(), "SECRET") || len(structured) != 0) {
				t.Fatalf("leaked provider text: %v %s", cerr, structured)
			}
		})
	}
}

func TestClassifyPrintTimeoutAndCancel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	res, err := runFake(t, ctx, "hang", "-p")
	if _, cerr := ClassifyPrint(res, err); !errors.Is(cerr, provider.ErrTimeout) {
		t.Fatalf("timeout: %v", cerr)
	}
	cctx, ccancel := context.WithCancel(context.Background())
	ccancel()
	res, err = runFake(t, cctx, "hang", "-p")
	if _, cerr := ClassifyPrint(res, err); !errors.Is(cerr, provider.ErrCancelled) {
		t.Fatalf("cancel: %v", cerr)
	}
	if _, cerr := ClassifyPrint(Result{}, provider.ErrNotFound); !errors.Is(cerr, provider.ErrNotFound) {
		t.Fatalf("not found: %v", cerr)
	}
}

func TestErrorsMapToCatalogCodes(t *testing.T) {
	want := map[error]protocol.ErrorCode{
		provider.ErrNotFound:         protocol.CodeProviderNotFound,
		provider.ErrNotAuthenticated: protocol.CodeProviderNotAuthenticated,
		provider.ErrUsageLimit:       protocol.CodeProviderUsageLimit,
		provider.ErrTimeout:          protocol.CodeProviderTimeout,
		provider.ErrCancelled:        protocol.CodeProviderCancelled,
		provider.ErrOutputInvalid:    protocol.CodeProviderOutputInvalid,
	}
	for err, code := range want {
		if got := provider.CodeFor(err); got != code {
			t.Errorf("%v -> %s, want %s", err, got, code)
		}
		if protocol.NewAppError(code).Code != code {
			t.Errorf("code %s missing from catalog", code)
		}
	}
}

func TestExecRunnerContract(t *testing.T) {
	r := ExecRunner{Env: []string{"FAKE_CLAUDE_MODE=probe", "HOME=/h", "PATH=/p", "USER=u"}}
	res, err := r.Run(context.Background(), Command{
		Path: filepath.Join(fakeBin, Executable), Args: []string{"-p", "x y;$(z)"}, Stdin: []byte("hello"),
	})
	if err != nil || res.ExitCode != 0 {
		t.Fatalf("run: %v %+v", err, res)
	}
	var probe struct {
		Args       []string
		Env        []string
		StdinLen   int
		DirEntries int
		Wd         string
	}
	if err := json.Unmarshal(res.Stdout, &probe); err != nil {
		t.Fatal(err)
	}
	if strings.Join(probe.Env, ",") != "FAKE_CLAUDE_MODE,HOME,PATH,USER" {
		t.Errorf("env = %v", probe.Env)
	}
	if strings.Join(probe.Args, "|") != "-p|x y;$(z)" { // no shell interpretation
		t.Errorf("args = %v", probe.Args)
	}
	if probe.StdinLen != 5 || probe.DirEntries != 0 {
		t.Errorf("stdin %d, entries %d", probe.StdinLen, probe.DirEntries)
	}
	if _, statErr := os.Stat(probe.Wd); !os.IsNotExist(statErr) {
		t.Errorf("working dir %s not removed", probe.Wd)
	}
}

func TestExecRunnerBoundsOutputAndReportsStartFailure(t *testing.T) {
	res, err := runFake(t, context.Background(), "big")
	if err != nil || !res.Truncated || len(res.Stdout) != DefaultMaxStdout {
		t.Fatalf("big: %v truncated=%v len=%d", err, res.Truncated, len(res.Stdout))
	}
	_, err = runnerFor("x").Run(context.Background(), Command{Path: filepath.Join(t.TempDir(), "nope")})
	if !errors.Is(err, ErrStart) {
		t.Fatalf("start failure: %v", err)
	}
	if got := ClassifyAuthStatus(Result{}, err); !errors.Is(got, provider.ErrOutputInvalid) {
		t.Fatalf("start failure classified as %v", got)
	}
}

func TestSearchPathAndChildEnv(t *testing.T) {
	dirs := SearchPath("/Users/x", "/usr/bin:relative:/usr/bin:/bin")
	want := []string{"/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin", "/Users/x/.local/bin", "/Users/x/.npm-global/bin"}
	if strings.Join(dirs, ",") != strings.Join(want, ",") {
		t.Fatalf("dirs = %v", dirs)
	}
	if got := strings.Join(ChildEnv("/h", "/p", "u"), ","); got != "HOME=/h,PATH=/p,USER=u" {
		t.Fatalf("env = %s", got)
	}
	if _, err := Locate([]string{"/nonexistent-dir"}); !errors.Is(err, provider.ErrNotFound) {
		t.Fatalf("locate: %v", err)
	}
}
