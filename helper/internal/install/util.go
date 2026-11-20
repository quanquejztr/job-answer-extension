package install

import (
	"bytes"
	"encoding/json"
	"io"

	"jobanswer/helper/internal/identity"
)

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

func manifestNameValue() string { return identity.NativeHostName }

func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return ErrInvalidTemplate
	}
	return nil
}
