package profile

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

// decodeProfile parses and validates profile bytes. Order: syntax and
// duplicate keys, then version, then strict schema decode, then invariants.
func decodeProfile(data []byte) (*Profile, error) {
	if err := checkJSON(data); err != nil {
		return nil, ErrCorrupt
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, ErrCorrupt
	}
	raw, ok := top["schemaVersion"]
	if !ok {
		return nil, ErrUnsupportedVersion
	}
	version, ok := parseVersion(raw)
	if !ok {
		return nil, ErrUnsupportedVersion
	}
	return migrate(version, data)
}

// migrate is the single extension point for schema versions. Only version 2
// is supported. Version 1 (facts, ADR 0003) is rejected, never migrated and
// never rewritten.
func migrate(version int, data []byte) (*Profile, error) {
	if version != SchemaVersion {
		return nil, ErrUnsupportedVersion
	}
	return decodeV2(data)
}

func decodeV2(data []byte) (*Profile, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var p Profile
	if err := dec.Decode(&p); err != nil {
		return nil, ErrCorrupt
	}
	p.normalizeNil()
	if err := validateProfile(&p); err != nil {
		if errors.Is(err, ErrUnsupportedVersion) {
			return nil, err
		}
		return nil, ErrCorrupt
	}
	return &p, nil
}

func parseVersion(raw json.RawMessage) (int, bool) {
	s := string(bytes.TrimSpace(raw))
	// Only plain decimal integers; "1.0", "1e0", strings, null are rejected.
	if s == "" || len(s) > 6 {
		return 0, false
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		return 0, false
	}
	return n, true
}

// checkJSON verifies a single well-formed JSON value with no trailing data
// and no duplicate object keys at any depth.
func checkJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := walk(dec); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return ErrCorrupt
	}
	return nil
}

func walk(dec *json.Decoder) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	d, ok := tok.(json.Delim)
	if !ok {
		return nil
	}
	switch d {
	case '{':
		seen := map[string]bool{}
		for dec.More() {
			kt, err := dec.Token()
			if err != nil {
				return err
			}
			k, _ := kt.(string)
			if seen[k] {
				return ErrCorrupt
			}
			seen[k] = true
			if err := walk(dec); err != nil {
				return err
			}
		}
	case '[':
		for dec.More() {
			if err := walk(dec); err != nil {
				return err
			}
		}
	}
	_, err = dec.Token() // closing delimiter
	return err
}

// Decode strictly parses and validates profile JSON exactly as the store does
// when it loads a file. It exists so other packages' tests can check results
// against the real schema.
func Decode(data []byte) (*Profile, error) { return decodeProfile(data) }
