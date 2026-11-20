package protocol

import (
	"encoding/json"

	"jobanswer/helper/internal/limits"
)

// Implemented message types. Every other type, including the remaining names
// in PRD 17.2, is rejected as unknown until its slice adds it here.
const (
	TypeHelperHello   = "helper.hello"
	TypeDraftGenerate = "draft.generate"
	TypeDraftCancel   = "draft.cancel"
)

// HelloPayload is the helper.hello payload.
type HelloPayload struct {
	ExtensionVersion string `json:"extensionVersion"`
}

// CancelPayload is the draft.cancel payload.
type CancelPayload struct {
	TargetRequestID string `json:"targetRequestId"`
}

// ParseHelloPayload strictly decodes a helper.hello payload.
func ParseHelloPayload(raw json.RawMessage) (HelloPayload, error) {
	var p HelloPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("extensionVersion"); err != nil {
		return p, err
	}
	v, ok := obj["extensionVersion"]
	if !ok {
		return p, ErrInvalidPayload
	}
	p.ExtensionVersion, err = asStringBounded(v, 1, 32)
	return p, err
}

// ParseCancelPayload strictly decodes a draft.cancel payload.
func ParseCancelPayload(raw json.RawMessage) (CancelPayload, error) {
	var p CancelPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("targetRequestId"); err != nil {
		return p, err
	}
	v, ok := obj["targetRequestId"]
	if !ok {
		return p, ErrInvalidPayload
	}
	if p.TargetRequestID, err = asString(v); err != nil {
		return p, err
	}
	if !ValidRequestID(p.TargetRequestID) {
		return p, ErrInvalidPayload
	}
	return p, nil
}

// payloadValidators is the message-type registry.
var payloadValidators = map[string]func(json.RawMessage) error{
	TypeHelperHello:   func(r json.RawMessage) error { _, err := ParseHelloPayload(r); return err },
	TypeDraftGenerate: func(r json.RawMessage) error { _, err := ParseDraftRequest(r); return err },
	TypeDraftCancel:   func(r json.RawMessage) error { _, err := ParseCancelPayload(r); return err },
}

// RegisteredTypes returns the implemented message types.
func RegisteredTypes() []string {
	return []string{TypeHelperHello, TypeDraftGenerate, TypeDraftCancel}
}

// RequestEnvelope is the extension-to-helper envelope. Payload is the raw,
// already validated payload JSON.
type RequestEnvelope struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	Type            string          `json:"type"`
	Payload         json.RawMessage `json:"payload"`
}

// ProtocolVersion is the only supported envelope version.
const ProtocolVersion = 1

// ParseRequest validates a request body: size first, then strict JSON object
// decoding (duplicate keys, unknown top-level keys, trailing data rejected),
// exact version 1, requestId, registered type, and payload schema.
//
// On error, the returned envelope has RequestID set only when a valid
// requestId was present, so the caller can echo it; otherwise it is empty.
func ParseRequest(body []byte) (RequestEnvelope, error) {
	var env RequestEnvelope
	if len(body) > limits.MaxNativeRequestBytes {
		return env, ErrMessageTooLarge
	}
	obj, err := decodeObject(body)
	if err != nil {
		return env, err
	}
	if raw, ok := obj["requestId"]; ok {
		if id, err := asString(raw); err == nil && ValidRequestID(id) {
			env.RequestID = id
		}
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
	if err := obj.only("protocolVersion", "requestId", "type", "payload"); err != nil {
		return env, err
	}
	if env.RequestID == "" {
		return env, ErrInvalidRequestID
	}
	tRaw, ok := obj["type"]
	if !ok {
		return env, ErrInvalidEnvelope
	}
	typ, err := asString(tRaw)
	if err != nil {
		return env, ErrInvalidEnvelope
	}
	validate, ok := payloadValidators[typ]
	if !ok {
		return env, ErrUnknownType
	}
	payload, ok := obj["payload"]
	if !ok {
		return env, ErrInvalidEnvelope
	}
	if err := validate(payload); err != nil {
		return env, err
	}
	env.ProtocolVersion = ProtocolVersion
	env.Type = typ
	env.Payload = payload
	return env, nil
}
