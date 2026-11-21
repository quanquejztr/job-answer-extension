package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"

	"jobanswer/helper/internal/limits"
)

// ResponseEnvelope is the helper-to-extension envelope. Success has Result and
// no Error; failure has Error and no Result.
type ResponseEnvelope struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	OK              bool            `json:"ok"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           *AppError       `json:"error,omitempty"`
}

// BuildErrorResponse builds a failure response with the fixed AppError for
// err. requestID is echoed only if it satisfies the requestId rule; otherwise
// it is "".
func BuildErrorResponse(requestID string, err error) ResponseEnvelope {
	if !ValidRequestID(requestID) {
		requestID = ""
	}
	appErr := ToAppError(err)
	return ResponseEnvelope{ProtocolVersion: ProtocolVersion, RequestID: requestID, Error: &appErr}
}

// BuildSuccessResponse marshals result into a success response. requestID must
// be valid.
func BuildSuccessResponse(requestID string, result any) (ResponseEnvelope, error) {
	if !ValidRequestID(requestID) {
		return ResponseEnvelope{}, ErrInvalidRequestID
	}
	raw, err := marshalPlain(result)
	if err != nil {
		return ResponseEnvelope{}, fmt.Errorf("marshal result: %w", err)
	}
	if isNull(raw) {
		return ResponseEnvelope{}, ErrInvalidEnvelope
	}
	return ResponseEnvelope{ProtocolVersion: ProtocolVersion, RequestID: requestID, OK: true, Result: raw}, nil
}

// ParseResponse strictly validates a response body against the envelope rules.
// The result is not interpreted; use ParseDraftResponse for draft results.
func ParseResponse(body []byte) (ResponseEnvelope, error) {
	var env ResponseEnvelope
	if len(body) > limits.MaxNativeResponseBytes {
		return env, ErrMessageTooLarge
	}
	obj, err := decodeObject(body)
	if err != nil {
		return env, err
	}
	if err := obj.only("protocolVersion", "requestId", "ok", "result", "error"); err != nil {
		return env, err
	}
	vRaw, ok := obj["protocolVersion"]
	if !ok {
		return env, ErrInvalidEnvelope
	}
	v, err := asNumber(vRaw)
	if err != nil {
		return env, ErrInvalidEnvelope
	}
	if v != ProtocolVersion {
		return env, ErrUnsupportedVersion
	}
	idRaw, ok := obj["requestId"]
	if !ok {
		return env, ErrInvalidEnvelope
	}
	id, err := asString(idRaw)
	if err != nil || (id != "" && !ValidRequestID(id)) {
		return env, ErrInvalidRequestID
	}
	okRaw, ok := obj["ok"]
	if !ok {
		return env, ErrInvalidEnvelope
	}
	isOK, err := asBool(okRaw)
	if err != nil {
		return env, ErrInvalidEnvelope
	}
	result, hasResult := obj["result"]
	errRaw, hasError := obj["error"]
	if isOK {
		if id == "" || !hasResult || hasError || isNull(result) {
			return env, ErrInvalidEnvelope
		}
		env.Result = result
	} else {
		if hasResult || !hasError {
			return env, ErrInvalidEnvelope
		}
		appErr, err := parseAppError(errRaw)
		if err != nil {
			return env, err
		}
		env.Error = &appErr
	}
	env.ProtocolVersion = ProtocolVersion
	env.RequestID = id
	env.OK = isOK
	return env, nil
}

func parseAppError(raw json.RawMessage) (AppError, error) {
	var e AppError
	obj, err := decodeObject(raw)
	if err != nil {
		return e, ErrInvalidEnvelope
	}
	if err := obj.only("code", "message", "retryable", "userAction"); err != nil {
		return e, err
	}
	cr, ok1 := obj["code"]
	mr, ok2 := obj["message"]
	rr, ok3 := obj["retryable"]
	if !ok1 || !ok2 || !ok3 {
		return e, ErrInvalidEnvelope
	}
	code, err := asString(cr)
	if err != nil || !IsKnownErrorCode(ErrorCode(code)) {
		return e, ErrInvalidEnvelope
	}
	e.Code = ErrorCode(code)
	if e.Message, err = asString(mr); err != nil {
		return e, ErrInvalidEnvelope
	}
	if e.Retryable, err = asBool(rr); err != nil {
		return e, ErrInvalidEnvelope
	}
	if ua, ok := obj["userAction"]; ok {
		if e.UserAction, err = asString(ua); err != nil {
			return e, ErrInvalidEnvelope
		}
	}
	return e, nil
}

// BuildCodeErrorResponse builds a failure response for a catalog code. Use it
// when the failure is not a protocol-layer error (for example a provider
// failure or an oversize response). requestID is echoed only if valid.
func BuildCodeErrorResponse(requestID string, code ErrorCode) ResponseEnvelope {
	if !ValidRequestID(requestID) {
		requestID = ""
	}
	appErr := NewAppError(code)
	return ResponseEnvelope{ProtocolVersion: ProtocolVersion, RequestID: requestID, Error: &appErr}
}

// marshalPlain is json.Marshal without HTML escaping, so "<", ">" and "&" stay
// one byte each. The profile store writes its file the same way, which keeps a
// profile.get response no larger than the profile file it came from.
func marshalPlain(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// MarshalResponse encodes a response envelope without HTML escaping (see
// marshalPlain).
func MarshalResponse(resp ResponseEnvelope) ([]byte, error) { return marshalPlain(resp) }
