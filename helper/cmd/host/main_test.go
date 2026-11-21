package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/host"
	"jobanswer/helper/internal/identity"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

// failReader fails the test if anything reads from it.
type failReader struct{ t *testing.T }

func (r failReader) Read([]byte) (int, error) {
	r.t.Helper()
	r.t.Error("stdin was read before the caller origin was accepted")
	return 0, errors.New("read")
}

func TestRejectedCallerExitsBeforeReading(t *testing.T) {
	for name, args := range map[string][]string{
		"missing":  nil,
		"mismatch": {"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"},
	} {
		t.Run(name, func(t *testing.T) {
			var out, errw bytes.Buffer
			if code := run(args, failReader{t}, &out, &errw); code == 0 {
				t.Fatal("exit code 0 for a rejected caller")
			}
			if out.Len() != 0 {
				t.Fatal("stdout must stay empty")
			}
			if strings.TrimSpace(errw.String()) != "event=caller_rejected" {
				t.Fatalf("stderr = %q", errw.String())
			}
		})
	}
}

func TestAcceptedCallerServesAndExitsCleanlyOnEOF(t *testing.T) {
	var in bytes.Buffer
	body := []byte(`{"protocolVersion":1,"requestId":"h1","type":"helper.hello","payload":{"extensionVersion":"1"}}`)
	if err := protocol.WriteMessage(&in, body, 1<<20); err != nil {
		t.Fatal(err)
	}
	var out, errw bytes.Buffer
	if code := run([]string{identity.Origin()}, &in, &out, &errw); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	resp, err := protocol.ReadMessage(&out, 1<<20)
	if err != nil || !strings.Contains(string(resp), `"ok":true`) {
		t.Fatalf("resp=%s err=%v", resp, err)
	}
}

// The production wiring never reaches a provider (and so never the real
// `claude`) unless the profile in the owner's home says so: with a résumé but
// no provider, or with Codex (no adapter), a draft request is INVALID_REQUEST
// and starts nothing. The profile lives in a throwaway HOME.
func TestProductionDraftIsBlockedWithoutAUsableProviderChoice(t *testing.T) {
	for name, choose := range map[string]string{"none": "", "codex": profile.ProviderCodex} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("HOME", home)
			s, err := profile.NewStore(host.DataDir(home), nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.SetResume(profile.ResumeInput{Text: "Built routing software for logistics teams.", Source: profile.SourcePasted}); err != nil {
				t.Fatal(err)
			}
			if choose != "" {
				if err := s.SetProvider(choose); err != nil {
					t.Fatal(err)
				}
				if err := s.AcceptDisclosure(); err != nil {
					t.Fatal(err)
				}
			}
			var in bytes.Buffer
			body := []byte(`{"protocolVersion":1,"requestId":"d1","type":"draft.generate","payload":{"question":"Why do you want to work here?","constraints":{"maxWords":100},"requestedAt":"2026-11-20T10:00:00Z"}}`)
			if err := protocol.WriteMessage(&in, body, 1<<20); err != nil {
				t.Fatal(err)
			}
			var out, errw bytes.Buffer
			if code := run([]string{identity.Origin()}, &in, &out, &errw); code != 0 {
				t.Fatalf("exit code %d", code)
			}
			resp, err := protocol.ReadMessage(&out, 1<<20)
			if err != nil || !strings.Contains(string(resp), `"code":"INVALID_REQUEST"`) {
				t.Fatalf("resp=%s err=%v", resp, err)
			}
		})
	}
}
