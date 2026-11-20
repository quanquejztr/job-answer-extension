package provider

import (
	"context"
	"errors"

	"jobanswer/helper/internal/protocol"
)

// Provider produces one draft for one request. It must stop promptly when ctx
// is cancelled (Chrome disconnecting the port cancels it).
type Provider interface {
	Draft(ctx context.Context, req protocol.DraftRequest) (protocol.DraftResponse, error)
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
	case errors.Is(err, ErrOutputInvalid):
		return protocol.CodeProviderOutputInvalid
	default:
		return protocol.CodeInternalError
	}
}
