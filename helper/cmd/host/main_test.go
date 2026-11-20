package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/identity"
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
