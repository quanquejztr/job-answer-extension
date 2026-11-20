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
