package host

import (
	"testing"

	"jobanswer/helper/internal/identity"
)

func TestCheckCaller(t *testing.T) {
	allowed := identity.Origin()
	tests := []struct {
		name string
		args []string
		ok   bool
	}{
		{"exact", []string{allowed}, true},
		{"exact with parent window arg", []string{allowed, "--parent-window=0"}, true},
		{"missing", nil, false},
		{"empty", []string{""}, false},
		{"other id", []string{"chrome-extension://" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + "/"}, false},
		{"no trailing slash", []string{"chrome-extension://" + identity.ExtensionID}, false},
		{"prefix only", []string{allowed + "x"}, false},
		{"origin in second position", []string{"--flag", allowed}, false},
		{"https lookalike", []string{"https://" + identity.ExtensionID + "/"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckCaller(tt.args, allowed)
			if (err == nil) != tt.ok {
				t.Fatalf("CheckCaller ok=%v, err=%v", tt.ok, err)
			}
		})
	}
	if CheckCaller([]string{""}, "") == nil {
		t.Fatal("empty allowed origin must never match")
	}
}
