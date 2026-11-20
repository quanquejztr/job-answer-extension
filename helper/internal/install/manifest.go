package install

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"

	"jobanswer/helper/internal/identity"
)

// Errors carry no file contents.
var (
	ErrInvalidExtensionID = errors.New("extension id must be 32 letters a-p")
	ErrExtensionIDDiffers = errors.New("extension id differs from the pinned id; pass the override flag to allow it")
	ErrInvalidTemplate    = errors.New("native host manifest template is invalid")
)

var extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

// ValidateExtensionID checks the ID shape and, unless allowOther is set, that
// it equals the pinned ID.
func ValidateExtensionID(id string, allowOther bool) error {
	if !extensionIDPattern.MatchString(id) {
		return ErrInvalidExtensionID
	}
	if id != identity.ExtensionID && !allowOther {
		return ErrExtensionIDDiffers
	}
	return nil
}

// Manifest is Chrome's native-messaging host manifest.
type Manifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// RenderManifest decodes the template strictly, checks its fixed fields, fills
// in the host path and the single allowed origin, and encodes the result with
// encoding/json (no string splicing).
func RenderManifest(template []byte, hostPath, extensionID string) ([]byte, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(template))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return nil, ErrInvalidTemplate
	}
	if dec.More() || m.Name != identity.NativeHostName || m.Type != "stdio" || m.Description == "" ||
		m.Path != "" || len(m.AllowedOrigins) != 0 {
		return nil, ErrInvalidTemplate
	}
	if !extensionIDPattern.MatchString(extensionID) {
		return nil, ErrInvalidExtensionID
	}
	m.Path = hostPath
	m.AllowedOrigins = []string{"chrome-extension://" + extensionID + "/"}
	out, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, ErrInvalidTemplate
	}
	return append(out, '\n'), nil
}
