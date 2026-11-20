package validate

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"jobanswer/helper/internal/protocol"
)

// Failures carry no answer or fact text.
var (
	ErrOutputInvalid = errors.New("provider output invalid")
	ErrUnknownFact   = errors.New("evidence id not in used facts")
)

// CodeFor maps a validation error to its AppError code.
func CodeFor(err error) protocol.ErrorCode {
	switch {
	case errors.Is(err, ErrUnknownFact):
		return protocol.CodeFactValidationFailed
	case errors.Is(err, ErrOutputInvalid):
		return protocol.CodeProviderOutputInvalid
	default:
		return protocol.CodeInternalError
	}
}

// DraftResponse checks resp against req: a well-formed response, a non-empty
// answer within maxWords and maxChars, and every evidence ID present in
// usedFacts. Structure problems return ErrOutputInvalid; an unknown evidence
// ID returns ErrUnknownFact.
func DraftResponse(req protocol.DraftRequest, resp protocol.DraftResponse) error {
	// Round-trip through the strict parser so warnings and shapes are held to
	// the same rules as anything crossing the wire.
	raw, err := json.Marshal(resp)
	if err != nil {
		return ErrOutputInvalid
	}
	if _, err := protocol.ParseDraftResponse(raw); err != nil {
		return ErrOutputInvalid
	}
	if strings.TrimSpace(resp.Answer) == "" {
		return ErrOutputInvalid
	}
	if len(strings.Fields(resp.Answer)) > req.Constraints.MaxWords {
		return ErrOutputInvalid
	}
	if c := req.Constraints.MaxChars; c != nil && utf8.RuneCountInString(resp.Answer) > *c {
		return ErrOutputInvalid
	}
	known := make(map[string]struct{}, len(resp.UsedFacts))
	for _, f := range resp.UsedFacts {
		known[f.ID] = struct{}{}
	}
	for _, id := range resp.EvidenceIDs {
		if _, ok := known[id]; !ok {
			return ErrUnknownFact
		}
	}
	return nil
}
