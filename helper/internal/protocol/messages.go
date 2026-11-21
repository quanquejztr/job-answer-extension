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

	TypeProfileGet        = "profile.get"
	TypeProfileItemUpsert = "profile.item.upsert"
	TypeProfileItemDelete = "profile.item.delete"
	TypeProfileResumeSet  = "profile.resume.set"
	TypeProfileExport     = "profile.export"
	TypeProfileDeleteAll  = "profile.deleteAll"

	TypeProfileImportDocument = "profile.import.document"

	TypeDiagnosticsRun = "diagnostics.run"

	TypeSettingsSetProvider      = "settings.setProvider"
	TypeSettingsAcceptDisclosure = "settings.acceptDisclosure"
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

// ParseDiagnosticsPayload strictly decodes a diagnostics.run payload: exactly {}.
func ParseDiagnosticsPayload(raw json.RawMessage) error {
	obj, err := decodeObject(raw)
	if err != nil {
		return ErrInvalidPayload
	}
	return obj.only()
}

// Provider names on the wire (PRD 16.1 settings).
const (
	ProviderClaude = "claude"
	ProviderCodex  = "codex"
)

// SetProviderPayload is the settings.setProvider payload.
type SetProviderPayload struct {
	Provider string
}

// ParseSetProviderPayload strictly decodes {"provider":"claude"|"codex"}.
func ParseSetProviderPayload(raw json.RawMessage) (SetProviderPayload, error) {
	var p SetProviderPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("provider"); err != nil {
		return p, err
	}
	if p.Provider, err = requiredString(obj, "provider"); err != nil {
		return p, err
	}
	if p.Provider != ProviderClaude && p.Provider != ProviderCodex {
		return p, ErrInvalidPayload
	}
	return p, nil
}

// ParseAcceptDisclosurePayload strictly decodes a settings.acceptDisclosure
// payload: exactly {}. The helper stamps the time itself.
func ParseAcceptDisclosurePayload(raw json.RawMessage) error {
	obj, err := decodeObject(raw)
	if err != nil {
		return ErrInvalidPayload
	}
	return obj.only()
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

	TypeProfileGet:        func(r json.RawMessage) error { return ParseProfileGetPayload(r) },
	TypeProfileItemUpsert: func(r json.RawMessage) error { _, err := ParseItemUpsertPayload(r); return err },
	TypeProfileItemDelete: func(r json.RawMessage) error { _, err := ParseItemDeletePayload(r); return err },
	TypeProfileResumeSet:  func(r json.RawMessage) error { _, err := ParseResumeSetPayload(r); return err },
	TypeProfileExport:     func(r json.RawMessage) error { return ParseProfileExportPayload(r) },
	TypeProfileDeleteAll:  func(r json.RawMessage) error { return ParseDeleteAllPayload(r) },

	TypeProfileImportDocument: func(r json.RawMessage) error { _, err := ParseImportDocumentPayload(r); return err },

	TypeDiagnosticsRun: func(r json.RawMessage) error { return ParseDiagnosticsPayload(r) },

	TypeSettingsSetProvider:      func(r json.RawMessage) error { _, err := ParseSetProviderPayload(r); return err },
	TypeSettingsAcceptDisclosure: func(r json.RawMessage) error { return ParseAcceptDisclosurePayload(r) },
}

// RegisteredTypes returns the implemented message types.
func RegisteredTypes() []string {
	return []string{
		TypeHelperHello, TypeDraftGenerate, TypeDraftCancel,
		TypeProfileGet, TypeProfileItemUpsert, TypeProfileItemDelete, TypeProfileResumeSet,
		TypeProfileExport, TypeProfileDeleteAll, TypeProfileImportDocument,
		TypeDiagnosticsRun, TypeSettingsSetProvider, TypeSettingsAcceptDisclosure,
	}
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
