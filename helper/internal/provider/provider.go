package provider

import (
	"context"
	"errors"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

// Input is everything a provider may see for one draft: the validated request
// and the user's whole profile content (ADR 0003). There is no selection; the
// host has already checked that a résumé exists and that the content is within
// the 40,000 code-point cap.
type Input struct {
	Request protocol.DraftRequest
	Profile profile.Profile
}

// Provider produces one draft for one request. It must stop promptly when ctx
// is cancelled (Chrome disconnecting the port cancels it).
type Provider interface {
	Draft(ctx context.Context, in Input) (protocol.DraftResponse, error)
}

// Typed provider failures. They carry no text from the provider process or the
// request; CodeFor maps them to fixed catalog codes.
var (
	ErrNotFound         = errors.New("provider command not found")
	ErrNotAuthenticated = errors.New("provider not authenticated")
	ErrUsageLimit       = errors.New("provider usage limit")
	ErrTimeout          = errors.New("provider timed out")
	ErrCancelled        = errors.New("provider cancelled")
	ErrOutputInvalid    = errors.New("provider output invalid")
	// ErrInvalidInput means the input could not be sent as a bounded prompt
	// (over a size cap, or otherwise unusable). Nothing was sent.
	ErrInvalidInput = errors.New("provider input invalid")
)

// CodeFor maps a provider error to its AppError code. Context cancellation and
// deadline are treated as cancellation and timeout. Anything unrecognized is
// INTERNAL_ERROR, so unexpected error text can never leak: only the code is used.
func CodeFor(err error) protocol.ErrorCode {
	switch {
	case errors.Is(err, ErrNotFound):
		return protocol.CodeProviderNotFound
	case errors.Is(err, ErrNotAuthenticated):
		return protocol.CodeProviderNotAuthenticated
	case errors.Is(err, ErrUsageLimit):
		return protocol.CodeProviderUsageLimit
	case errors.Is(err, ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		return protocol.CodeProviderTimeout
	case errors.Is(err, ErrCancelled), errors.Is(err, context.Canceled):
		return protocol.CodeProviderCancelled
	case errors.Is(err, ErrInvalidInput):
		return protocol.CodeInvalidRequest
	case errors.Is(err, ErrOutputInvalid):
		return protocol.CodeProviderOutputInvalid
	default:
		return protocol.CodeInternalError
	}
}

// Check names reported by diagnostics (PRD 17.2). The host adds its own
// "helper" check; providers report the other two.
const (
	CheckHelper             = "helper"
	CheckProviderExecutable = "providerExecutable"
	CheckProviderSignIn     = "providerSignIn"
)

// Check is one diagnostic row. A failing check carries only a catalog code;
// the user action comes from the catalog, never from provider output.
type Check struct {
	Name string
	OK   bool
	Code protocol.ErrorCode // empty when OK
}

// Diagnoser reports whether a provider can be used: executable present, then
// signed in. It never reads credentials and never starts a login.
type Diagnoser interface {
	Diagnose(ctx context.Context) []Check
}

// CheckFor turns a classified failure into a failing Check.
func CheckFor(name string, err error) Check {
	if err == nil {
		return Check{Name: name, OK: true}
	}
	return Check{Name: name, Code: CodeFor(err)}
}
