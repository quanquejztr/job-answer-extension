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
	EventProfileTimeout = "profile_timeout"
	// EventNoResume: a draft request arrived with no saved résumé.
	EventNoResume = "no_resume"
	// EventNoProvider, EventNoDisclosure, and EventProviderUnsupported: a draft
	// request arrived before a provider was chosen, before the disclosure was
	// accepted, or for a provider that has no adapter yet.
	EventNoProvider          = "no_provider"
	EventNoDisclosure        = "no_disclosure"
	EventProviderUnsupported = "provider_unsupported"
	// EventProfileOverCap: the stored profile is over the content cap.
	EventProfileOverCap = "profile_over_cap"
	// EventProfileExport and EventProfileDeleteAll record the outcome of the
	// two whole-profile operations: with no code on success, with the catalog
	// code on failure. Never any content.
	// EventDiagnosticFailed records one failing diagnostics row with its code.
	EventDiagnosticFailed = "diagnostic_failed"
	EventProfileExport    = "profile_export"
	EventProfileDeleteAll = "profile_delete_all"
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
