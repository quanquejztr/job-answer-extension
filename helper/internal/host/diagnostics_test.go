package host

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/provider/fake"
)

type stubDiagnoser struct {
	checks []provider.Check
	panics bool
}

func (s stubDiagnoser) Diagnose(context.Context) []provider.Check {
	if s.panics {
		panic("boom SENTINEL")
	}
	return s.checks
}

func diagnosticsRun(t *testing.T, d provider.Diagnoser) (protocol.ResponseEnvelope, string) {
	t.Helper()
	return diagnosticsRunFor(t, d, profile.ProviderClaude)
}

// diagnosticsRunFor runs diagnostics.run with the given provider choice stored
// in the profile ("" stores none).
func diagnosticsRunFor(t *testing.T, d provider.Diagnoser, chosen string) (protocol.ResponseEnvelope, string) {
	t.Helper()
	home := t.TempDir()
	if chosen != "" {
		s, err := profile.NewStore(DataDir(home), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetProvider(chosen); err != nil {
			t.Fatal(err)
		}
	}
	body := `{"protocolVersion":1,"requestId":"d1","type":"diagnostics.run","payload":{}}`
	var errBuf strings.Builder
	var out strings.Builder
	cfg := Config{Provider: fake.FakeProvider{}, Diagnoser: d, Log: NewLogger(&errBuf), Home: home}
	if err := Run(context.Background(), strings.NewReader(string(frameOf(t, body))), &out, cfg); err != nil {
		t.Fatal(err)
	}
	var env protocol.ResponseEnvelope
	frame := out.String()[4:]
	if err := json.Unmarshal([]byte(frame), &env); err != nil {
		t.Fatalf("decode %q: %v", frame, err)
	}
	return env, errBuf.String()
}

func TestDiagnosticsAllOK(t *testing.T) {
	env, _ := diagnosticsRun(t, fake.FakeProvider{})
	if !env.OK {
		t.Fatalf("not ok: %+v", env)
	}
	got := string(env.Result)
	want := `{"checks":[{"name":"helper","ok":true},{"name":"providerExecutable","ok":true},{"name":"providerSignIn","ok":true}]}`
	if got != want {
		t.Fatalf("result = %s", got)
	}
}

func TestDiagnosticsFailuresCarryCatalogCodeAndAction(t *testing.T) {
	for _, code := range []protocol.ErrorCode{
		protocol.CodeProviderNotFound, protocol.CodeProviderNotAuthenticated, protocol.CodeProviderTimeout,
		protocol.CodeProviderCancelled, protocol.CodeProviderOutputInvalid,
	} {
		env, stderr := diagnosticsRun(t, stubDiagnoser{checks: []provider.Check{{Name: provider.CheckProviderSignIn, Code: code}}})
		var res diagnosticsResult
		if err := json.Unmarshal(env.Result, &res); err != nil || len(res.Checks) != 2 {
			t.Fatalf("%s: %v %s", code, err, env.Result)
		}
		row := res.Checks[1]
		if row.OK || row.Code != string(code) || row.UserAction != protocol.NewAppError(code).UserAction {
			t.Errorf("%s: row %+v", code, row)
		}
		if !strings.Contains(stderr, "event=diagnostic_failed code="+string(code)) {
			t.Errorf("%s: stderr %q", code, stderr)
		}
	}
}

func TestDiagnosticsNilAndPanic(t *testing.T) {
	env, _ := diagnosticsRun(t, nil)
	if env.OK || env.Error == nil || env.Error.Code != protocol.CodeInternalError {
		t.Fatalf("nil diagnoser: %+v", env)
	}
	env, _ = diagnosticsRun(t, stubDiagnoser{panics: true})
	if !env.OK || strings.Contains(string(env.Result), "SENTINEL") || !strings.Contains(string(env.Result), "INTERNAL_ERROR") {
		t.Fatalf("panic: %s", env.Result)
	}
}

func TestDiagnosticsFollowTheChosenProvider(t *testing.T) {
	// No provider chosen: only the helper row, and the diagnoser is not asked.
	env, _ := diagnosticsRunFor(t, stubDiagnoser{panics: true}, "")
	if !env.OK || string(env.Result) != `{"checks":[{"name":"helper","ok":true}]}` {
		t.Fatalf("no provider: %+v %s", env, env.Result)
	}
	// Codex has no adapter: its executable is reported as not found, and the
	// Claude diagnoser is not consulted.
	env, _ = diagnosticsRunFor(t, stubDiagnoser{panics: true}, profile.ProviderCodex)
	var res diagnosticsResult
	if err := json.Unmarshal(env.Result, &res); err != nil || len(res.Checks) != 2 ||
		res.Checks[1].Name != provider.CheckProviderExecutable || res.Checks[1].Code != string(protocol.CodeProviderNotFound) {
		t.Fatalf("codex: %v %s", err, env.Result)
	}
	// Claude chosen: the Claude diagnoser's rows are returned.
	env, _ = diagnosticsRunFor(t, stubDiagnoser{checks: []provider.Check{{Name: provider.CheckProviderExecutable, OK: true}}}, profile.ProviderClaude)
	if !env.OK || !strings.Contains(string(env.Result), `"providerExecutable"`) {
		t.Fatalf("claude: %s", env.Result)
	}
}

func TestDiagnosticsStorageErrorIsTyped(t *testing.T) {
	var out strings.Builder
	cfg := Config{Provider: fake.FakeProvider{}, Diagnoser: fake.FakeProvider{}, Log: NewLogger(nil), Home: "relative/home"}
	body := `{"protocolVersion":1,"requestId":"d1","type":"diagnostics.run","payload":{}}`
	if err := Run(context.Background(), strings.NewReader(string(frameOf(t, body))), &out, cfg); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"STORAGE_ERROR"`) {
		t.Fatalf("got %q", out.String())
	}
}
