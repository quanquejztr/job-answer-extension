package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"jobanswer/helper/internal/provider"
)

// classifyRun maps a Runner error to a typed provider error. Only the
// context's own state is trusted: the error text is never inspected or kept.
func classifyRun(runErr error) error {
	switch {
	case runErr == nil:
		return nil
	case errors.Is(runErr, context.DeadlineExceeded):
		return provider.ErrTimeout
	case errors.Is(runErr, context.Canceled):
		return provider.ErrCancelled
	case errors.Is(runErr, provider.ErrNotFound):
		return provider.ErrNotFound
	default:
		// Any other failure to run: the fallback rule in ADR 0002.
		return provider.ErrOutputInvalid
	}
}

// ClassifyAuthStatus classifies one `claude auth status` run. The JSON field
// `loggedIn` is the only thing read (ADR 0002); nothing else from the output
// is kept.
func ClassifyAuthStatus(res Result, runErr error) error {
	if err := classifyRun(runErr); err != nil {
		return err
	}
	if res.Truncated {
		return provider.ErrOutputInvalid
	}
	var status struct {
		LoggedIn *bool `json:"loggedIn"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(res.Stdout), &status); err != nil || status.LoggedIn == nil {
		return provider.ErrOutputInvalid
	}
	if !*status.LoggedIn {
		return provider.ErrNotAuthenticated
	}
	if res.ExitCode != 0 {
		return provider.ErrOutputInvalid
	}
	return nil
}

// printOutput is the subset of `claude -p --output-format json` read here.
type printOutput struct {
	IsError          bool            `json:"is_error"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
}

// Signatures matched in the `result` text of an is_error run. "Not logged in"
// was observed (ADR 0002). The usage-limit wording has NOT been observed and is
// an assumption; anything that does not match falls through to
// PROVIDER_OUTPUT_INVALID, so a wrong guess can only be a missed classification.
var (
	notLoggedInSignatures = []string{"not logged in"}
	usageLimitSignatures  = []string{"usage limit", "limit reached", "rate limit"}
)

func containsAny(s string, needles []string) bool {
	s = strings.ToLower(s)
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

// ClassifyPrint classifies one `claude -p --output-format json` run and, on
// success, returns the structured_output JSON for the shared validator. The
// provider's text is only matched against fixed signatures; it is never
// returned or placed in an error.
func ClassifyPrint(res Result, runErr error) (json.RawMessage, error) {
	if err := classifyRun(runErr); err != nil {
		return nil, err
	}
	if res.Truncated {
		return nil, provider.ErrOutputInvalid
	}
	var out printOutput
	if err := json.Unmarshal(bytes.TrimSpace(res.Stdout), &out); err != nil {
		return nil, provider.ErrOutputInvalid
	}
	if out.IsError {
		switch {
		case containsAny(out.Result, notLoggedInSignatures):
			return nil, provider.ErrNotAuthenticated
		case containsAny(out.Result, usageLimitSignatures):
			return nil, provider.ErrUsageLimit
		default:
			return nil, provider.ErrOutputInvalid
		}
	}
	if res.ExitCode != 0 || len(out.StructuredOutput) == 0 || string(out.StructuredOutput) == "null" {
		return nil, provider.ErrOutputInvalid
	}
	return out.StructuredOutput, nil
}
