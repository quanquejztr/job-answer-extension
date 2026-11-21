package protocol

import "errors"

// Internal sentinel errors. They carry no input text. ToAppError maps them to
// fixed AppError values.
var (
	ErrMalformed          = errors.New("malformed message")
	ErrUnsupportedVersion = errors.New("unsupported protocol version")
	ErrUnknownField       = errors.New("unknown field")
	ErrUnknownType        = errors.New("unknown message type")
	ErrInvalidRequestID   = errors.New("invalid request id")
	ErrInvalidPayload     = errors.New("invalid payload")
	ErrInvalidEnvelope    = errors.New("invalid envelope")
	ErrMessageTooLarge    = errors.New("message too large")

	// Framing errors.
	ErrEndOfStream     = errors.New("end of stream at message boundary")
	ErrTruncatedPrefix = errors.New("truncated length prefix")
	ErrTruncatedBody   = errors.New("truncated message body")
	ErrEmptyMessage    = errors.New("empty message")
)

// ErrorCode is a stable AppError code from specs/05-contracts-and-invariants.md.
type ErrorCode string

const (
	CodeInvalidRequest             ErrorCode = "INVALID_REQUEST"
	CodeProtocolVersionUnsupported ErrorCode = "PROTOCOL_VERSION_UNSUPPORTED"
	CodeMessageTooLarge            ErrorCode = "MESSAGE_TOO_LARGE"
	CodeUnsupportedDomain          ErrorCode = "UNSUPPORTED_DOMAIN"
	CodeQuestionMissing            ErrorCode = "QUESTION_MISSING"
	CodeFieldNotFound              ErrorCode = "FIELD_NOT_FOUND"
	CodeFieldAmbiguous             ErrorCode = "FIELD_AMBIGUOUS"
	CodeFieldStale                 ErrorCode = "FIELD_STALE"
	CodeFieldNonempty              ErrorCode = "FIELD_NONEMPTY"
	CodeFieldUnsupported           ErrorCode = "FIELD_UNSUPPORTED"
	CodeHelperUnavailable          ErrorCode = "HELPER_UNAVAILABLE"
	CodeProviderNotFound           ErrorCode = "PROVIDER_NOT_FOUND"
	CodeProviderNotAuthenticated   ErrorCode = "PROVIDER_NOT_AUTHENTICATED"
	CodeProviderUsageLimit         ErrorCode = "PROVIDER_USAGE_LIMIT"
	CodeProviderTimeout            ErrorCode = "PROVIDER_TIMEOUT"
	CodeProviderCancelled          ErrorCode = "PROVIDER_CANCELLED"
	CodeProviderOutputInvalid      ErrorCode = "PROVIDER_OUTPUT_INVALID"
	CodeFactValidationFailed       ErrorCode = "FACT_VALIDATION_FAILED"
	CodeStorageError               ErrorCode = "STORAGE_ERROR"
	CodeInternalError              ErrorCode = "INTERNAL_ERROR"
)

// AppError is the wire error shape. Every field comes from the fixed catalog.
type AppError struct {
	Code       ErrorCode `json:"code"`
	Message    string    `json:"message"`
	Retryable  bool      `json:"retryable"`
	UserAction string    `json:"userAction,omitempty"`
}

type catalogEntry struct {
	message    string
	retryable  bool
	userAction string
}

// errorCatalog mirrors PRD section 17.3. Messages are fixed strings (the PRD
// does not list message text; these are the implementation's wording).
// An empty userAction means the PRD lists "None" and the field is omitted.
var errorCatalog = map[ErrorCode]catalogEntry{
	CodeInvalidRequest:             {"The request was not valid.", false, "Correct the input"},
	CodeProtocolVersionUnsupported: {"The protocol version is not supported.", false, "Reinstall or update the helper"},
	CodeMessageTooLarge:            {"The request is too large.", false, "Shorten the job context"},
	CodeUnsupportedDomain:          {"This site is not supported.", false, "Draft elsewhere; the tool is disabled here"},
	CodeQuestionMissing:            {"No question was selected.", false, "Select the full question and retry"},
	CodeFieldNotFound:              {"No answer field was found.", false, "Click Choose field"},
	CodeFieldAmbiguous:             {"More than one answer field is plausible.", false, "Click Choose field"},
	CodeFieldStale:                 {"The selected field is no longer valid.", false, "Select the question again"},
	CodeFieldNonempty:              {"The field already has text.", false, "Confirm replacement or cancel"},
	CodeFieldUnsupported:           {"This editor type is not supported.", false, "Use Copy answer"},
	CodeHelperUnavailable:          {"The native helper is unavailable.", true, "Run the installer, then retry"},
	CodeProviderNotFound:           {"The provider command was not found.", false, "Install the selected provider CLI"},
	CodeProviderNotAuthenticated:   {"The provider is not signed in.", false, "Sign in with the CLI yourself"},
	CodeProviderUsageLimit:         {"The provider usage limit was reached.", true, "Wait or switch provider in settings"},
	CodeProviderTimeout:            {"The provider took too long to respond.", true, "Retry"},
	CodeProviderCancelled:          {"The request was cancelled.", true, ""},
	CodeProviderOutputInvalid:      {"The provider output was not usable.", true, "Regenerate"},
	CodeFactValidationFailed:       {"The draft was not supported by your résumé and stories.", true, "Regenerate, or add the missing detail to your résumé or stories"},
	CodeStorageError:               {"The profile could not be read or saved.", false, "Export if possible, then repair or reset"},
	CodeInternalError:              {"An internal error occurred.", false, "Restart Chrome; check diagnostics"},
}

// AllErrorCodes lists every code in catalog order.
func AllErrorCodes() []ErrorCode {
	return []ErrorCode{
		CodeInvalidRequest, CodeProtocolVersionUnsupported, CodeMessageTooLarge, CodeUnsupportedDomain,
		CodeQuestionMissing, CodeFieldNotFound, CodeFieldAmbiguous, CodeFieldStale, CodeFieldNonempty,
		CodeFieldUnsupported, CodeHelperUnavailable, CodeProviderNotFound, CodeProviderNotAuthenticated,
		CodeProviderUsageLimit, CodeProviderTimeout, CodeProviderCancelled, CodeProviderOutputInvalid,
		CodeFactValidationFailed, CodeStorageError, CodeInternalError,
	}
}

// IsKnownErrorCode reports whether code is in the catalog.
func IsKnownErrorCode(code ErrorCode) bool {
	_, ok := errorCatalog[code]
	return ok
}

// NewAppError returns the fixed AppError for code. An unknown code yields
// INTERNAL_ERROR.
func NewAppError(code ErrorCode) AppError {
	e, ok := errorCatalog[code]
	if !ok {
		code = CodeInternalError
		e = errorCatalog[code]
	}
	return AppError{Code: code, Message: e.message, Retryable: e.retryable, UserAction: e.userAction}
}

// ToAppError maps an internal or protocol error to a fixed AppError. No part
// of err's text, and no payload, ever flows into the result. Framing errors
// other than oversize and empty-message are stream failures and map to
// INTERNAL_ERROR.
func ToAppError(err error) AppError {
	switch {
	case errors.Is(err, ErrUnsupportedVersion):
		return NewAppError(CodeProtocolVersionUnsupported)
	case errors.Is(err, ErrMessageTooLarge):
		return NewAppError(CodeMessageTooLarge)
	case errors.Is(err, ErrMalformed),
		errors.Is(err, ErrUnknownField),
		errors.Is(err, ErrUnknownType),
		errors.Is(err, ErrInvalidPayload),
		errors.Is(err, ErrInvalidRequestID),
		errors.Is(err, ErrInvalidEnvelope),
		errors.Is(err, ErrEmptyMessage):
		return NewAppError(CodeInvalidRequest)
	default:
		return NewAppError(CodeInternalError)
	}
}
