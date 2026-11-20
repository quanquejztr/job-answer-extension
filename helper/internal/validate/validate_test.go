package validate

import (
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/protocol"
)

func req(maxWords int, maxChars *int) protocol.DraftRequest {
	return protocol.DraftRequest{Constraints: protocol.DraftConstraints{MaxWords: maxWords, MaxChars: maxChars}}
}

func resp(mod func(*protocol.DraftResponse)) protocol.DraftResponse {
	r := protocol.DraftResponse{
		Answer:      "one two three",
		EvidenceIDs: []string{"f_1"},
		Warnings:    []protocol.DraftWarning{},
		UsedFacts:   []protocol.UsedFact{{ID: "f_1", Text: "t"}},
	}
	if mod != nil {
		mod(&r)
	}
	return r
}

func TestDraftResponse(t *testing.T) {
	three := 13
	tests := []struct {
		name string
		req  protocol.DraftRequest
		resp protocol.DraftResponse
		want error
		code protocol.ErrorCode
	}{
		{"valid", req(20, nil), resp(nil), nil, ""},
		{"no evidence is fine", req(20, nil), resp(func(r *protocol.DraftResponse) { r.EvidenceIDs = nil; r.UsedFacts = nil }), nil, ""},
		{"empty answer", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Answer = "" }), ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
		{"blank answer", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Answer = " \n\t" }), ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
		{"too many words", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Answer = strings.Repeat("w ", 21) }), ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
		{"exactly maxWords", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Answer = strings.Repeat("w ", 20) }), nil, ""},
		{"exactly maxChars", req(20, &three), resp(nil), nil, ""},
		{"one over maxChars", req(20, &three), resp(func(r *protocol.DraftResponse) { r.Answer += "x" }), ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
		{"maxChars counts characters not bytes", req(20, &three), resp(func(r *protocol.DraftResponse) { r.Answer = "ééé ééé ééé" }), nil, ""},
		{"unknown evidence", req(20, nil), resp(func(r *protocol.DraftResponse) { r.EvidenceIDs = []string{"f_2"} }), ErrUnknownFact, protocol.CodeFactValidationFailed},
		{"one of two unknown", req(20, nil), resp(func(r *protocol.DraftResponse) { r.EvidenceIDs = []string{"f_1", "f_9"} }), ErrUnknownFact, protocol.CodeFactValidationFailed},
		{"bad warning code", req(20, nil), resp(func(r *protocol.DraftResponse) {
			r.Warnings = []protocol.DraftWarning{{Code: "X", Severity: "info", Message: "m"}}
		}), ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := DraftResponse(tt.req, tt.resp)
			if !errors.Is(err, tt.want) || (tt.want == nil) != (err == nil) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if err != nil {
				if got := CodeFor(err); got != tt.code {
					t.Fatalf("code = %s, want %s", got, tt.code)
				}
				if strings.Contains(err.Error(), "one two three") {
					t.Fatal("error contains answer text")
				}
			}
		})
	}
}
