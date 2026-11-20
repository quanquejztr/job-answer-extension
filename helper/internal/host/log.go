package host

import (
	"io"

	"jobanswer/helper/internal/protocol"
)

// Event names written to stderr. Fixed strings only.
const (
	EventStart          = "host_start"
	EventStop           = "host_stop"
	EventCallerRejected = "caller_rejected"
	EventRequestFailed  = "request_failed"
	EventFrameFailed    = "frame_failed"
	EventWriteFailed    = "write_failed"
)

// Logger writes sanitized diagnostics: `event=<name>` plus an optional
// `code=<ERROR_CODE>`. It has no way to accept free text.
type Logger struct{ w io.Writer }

// NewLogger returns a Logger writing to w; a nil w discards output.
func NewLogger(w io.Writer) *Logger {
	if w == nil {
		w = io.Discard
	}
	return &Logger{w: w}
}

// Event logs an event with no code.
func (l *Logger) Event(name string) {
	_, _ = io.WriteString(l.w, "event="+name+"\n")
}

// EventCode logs an event with a catalog error code.
func (l *Logger) EventCode(name string, code protocol.ErrorCode) {
	_, _ = io.WriteString(l.w, "event="+name+" code="+string(code)+"\n")
}
