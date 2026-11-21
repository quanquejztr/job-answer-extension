package provider

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"jobanswer/helper/internal/protocol"
)

func TestCodeFor(t *testing.T) {
	tests := []struct {
		err  error
		code protocol.ErrorCode
	}{
		{ErrNotFound, protocol.CodeProviderNotFound},
		{ErrNotAuthenticated, protocol.CodeProviderNotAuthenticated},
		{ErrUsageLimit, protocol.CodeProviderUsageLimit},
		{ErrTimeout, protocol.CodeProviderTimeout},
		{context.DeadlineExceeded, protocol.CodeProviderTimeout},
		{ErrCancelled, protocol.CodeProviderCancelled},
		{context.Canceled, protocol.CodeProviderCancelled},
		{ErrOutputInvalid, protocol.CodeProviderOutputInvalid},
		{fmt.Errorf("x: %w", ErrInvalidInput), protocol.CodeInvalidRequest},
		{fmt.Errorf("run: %w", ErrNotFound), protocol.CodeProviderNotFound},
		{errors.New("anything else"), protocol.CodeInternalError},
		{nil, protocol.CodeInternalError},
	}
	for _, tt := range tests {
		if got := CodeFor(tt.err); got != tt.code {
			t.Errorf("CodeFor(%v) = %s, want %s", tt.err, got, tt.code)
		}
	}
}

func TestCheckFor(t *testing.T) {
	if c := CheckFor(CheckProviderSignIn, nil); !c.OK || c.Code != "" {
		t.Fatalf("nil error: %+v", c)
	}
	c := CheckFor(CheckProviderExecutable, fmt.Errorf("x: %w", ErrNotFound))
	if c.OK || c.Code != protocol.CodeProviderNotFound || c.Name != CheckProviderExecutable {
		t.Fatalf("not found: %+v", c)
	}
}
