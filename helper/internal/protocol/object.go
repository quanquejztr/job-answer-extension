package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"unicode/utf8"
)

// object is a decoded JSON object whose keys are matched exactly (the standard
// struct decoder matches case-insensitively) and whose duplicate keys were
// rejected.
type object map[string]json.RawMessage

func decodeObject(raw []byte) (object, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, ErrMalformed
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return nil, ErrMalformed
	}
	obj := object{}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, ErrMalformed
		}
		key, ok := keyTok.(string)
		if !ok {
			return nil, ErrMalformed
		}
		if _, dup := obj[key]; dup {
			return nil, ErrMalformed
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, ErrMalformed
		}
		obj[key] = v
	}
	if _, err := dec.Token(); err != nil { // closing brace
		return nil, ErrMalformed
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) { // trailing data
		return nil, ErrMalformed
	}
	return obj, nil
}

// only returns ErrUnknownField if the object has a key outside allowed.
func (o object) only(allowed ...string) error {
	for k := range o {
		found := false
		for _, a := range allowed {
			if k == a {
				found = true
				break
			}
		}
		if !found {
			return ErrUnknownField
		}
	}
	return nil
}

func isNull(raw json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }

func asString(raw json.RawMessage) (string, error) {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 || t[0] != '"' {
		return "", ErrInvalidPayload
	}
	var s string
	if err := json.Unmarshal(t, &s); err != nil {
		return "", ErrInvalidPayload
	}
	return s, nil
}

func asBool(raw json.RawMessage) (bool, error) {
	switch string(bytes.TrimSpace(raw)) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	}
	return false, ErrInvalidPayload
}

func asNumber(raw json.RawMessage) (float64, error) {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 || (t[0] != '-' && (t[0] < '0' || t[0] > '9')) {
		return 0, ErrInvalidPayload
	}
	var f float64
	if err := json.Unmarshal(t, &f); err != nil {
		return 0, ErrInvalidPayload
	}
	return f, nil
}

func asInt(raw json.RawMessage) (int, error) {
	f, err := asNumber(raw)
	if err != nil || f != math.Trunc(f) || math.Abs(f) > 1e9 {
		return 0, ErrInvalidPayload
	}
	return int(f), nil
}

func asStringBounded(raw json.RawMessage, min, max int) (string, error) {
	s, err := asString(raw)
	if err != nil {
		return "", err
	}
	n := utf8.RuneCountInString(s)
	if n < min || n > max {
		return "", ErrInvalidPayload
	}
	return s, nil
}
