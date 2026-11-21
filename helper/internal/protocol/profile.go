package protocol

import (
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"

	"jobanswer/helper/internal/limits"
)

// Profile item kinds on the wire.
const (
	KindStory  = "story"
	KindSample = "sample"
	KindRule   = "rule"
)

// This file is structural validation only (types, enums, id shape, unknown
// fields). Length limits, trimming, and content rules belong to the profile
// store, which answers INVALID_REQUEST for them. The package imports no
// profile code (PRD architecture), so it has its own plain input structs.

// StoryItem is the story input.
type StoryItem struct {
	ID    string
	Title string
	Text  string
}

// SampleItem is the writing-sample input.
type SampleItem struct {
	ID    string
	Label string
	Text  string
}

// RuleItem is the writing-rule input. Enabled nil means the default.
type RuleItem struct {
	ID      string
	Kind    string
	Text    string
	Enabled *bool
}

// ItemUpsertPayload is the profile.item.upsert payload. Exactly the field that
// matches Kind is set.
type ItemUpsertPayload struct {
	Kind   string
	Story  *StoryItem
	Sample *SampleItem
	Rule   *RuleItem
}

// ItemDeletePayload is the profile.item.delete payload.
type ItemDeletePayload struct {
	Kind string
	ID   string
}

func kindPrefix(kind string) (string, bool) {
	switch kind {
	case KindStory:
		return "s_", true
	case KindSample:
		return "w_", true
	case KindRule:
		return "r_", true
	}
	return "", false
}

// validItemID accepts prefix plus a positive decimal without leading zeros,
// at most nine digits (the profile store's own ID rule).
func validItemID(id, prefix string) bool {
	rest, ok := strings.CutPrefix(id, prefix)
	if !ok || rest == "" || rest[0] == '0' || len(rest) > 9 {
		return false
	}
	for _, c := range rest {
		if c < '0' || c > '9' {
			return false
		}
	}
	n, err := strconv.Atoi(rest)
	return err == nil && n > 0
}

// ParseProfileGetPayload strictly decodes a profile.get payload: exactly {}.
func ParseProfileGetPayload(raw json.RawMessage) error {
	obj, err := decodeObject(raw)
	if err != nil {
		return ErrInvalidPayload
	}
	return obj.only()
}

// ParseProfileExportPayload strictly decodes a profile.export payload: exactly {}.
func ParseProfileExportPayload(raw json.RawMessage) error { return ParseProfileGetPayload(raw) }

// DeleteAllConfirmation is the literal string profile.deleteAll requires.
const DeleteAllConfirmation = "DELETE"

// ParseDeleteAllPayload strictly decodes a profile.deleteAll payload: exactly
// {"confirm":"DELETE"}. Any other value, case, or extra field is rejected.
func ParseDeleteAllPayload(raw json.RawMessage) error {
	obj, err := decodeObject(raw)
	if err != nil {
		return ErrInvalidPayload
	}
	if err := obj.only("confirm"); err != nil {
		return err
	}
	c, err := requiredString(obj, "confirm")
	if err != nil {
		return err
	}
	if c != DeleteAllConfirmation {
		return ErrInvalidPayload
	}
	return nil
}

func requiredString(obj object, key string) (string, error) {
	v, ok := obj[key]
	if !ok {
		return "", ErrInvalidPayload
	}
	return asString(v)
}

func optionalID(obj object, prefix string) (string, error) {
	v, ok := obj["id"]
	if !ok {
		return "", nil
	}
	id, err := asString(v)
	if err != nil || !validItemID(id, prefix) {
		return "", ErrInvalidPayload
	}
	return id, nil
}

// ParseItemUpsertPayload strictly decodes a profile.item.upsert payload.
func ParseItemUpsertPayload(raw json.RawMessage) (ItemUpsertPayload, error) {
	var p ItemUpsertPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("kind", "item"); err != nil {
		return p, err
	}
	if p.Kind, err = requiredString(obj, "kind"); err != nil {
		return p, err
	}
	prefix, ok := kindPrefix(p.Kind)
	if !ok {
		return p, ErrInvalidPayload
	}
	itemRaw, ok := obj["item"]
	if !ok {
		return p, ErrInvalidPayload
	}
	item, err := decodeObject(itemRaw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	id, err := optionalID(item, prefix)
	if err != nil {
		return p, err
	}
	switch p.Kind {
	case KindStory:
		if err := item.only("id", "title", "text"); err != nil {
			return p, err
		}
		st := StoryItem{ID: id}
		if st.Title, err = requiredString(item, "title"); err != nil {
			return p, err
		}
		if st.Text, err = requiredString(item, "text"); err != nil {
			return p, err
		}
		p.Story = &st
	case KindSample:
		if err := item.only("id", "label", "text"); err != nil {
			return p, err
		}
		w := SampleItem{ID: id}
		if w.Label, err = requiredString(item, "label"); err != nil {
			return p, err
		}
		if w.Text, err = requiredString(item, "text"); err != nil {
			return p, err
		}
		p.Sample = &w
	case KindRule:
		if err := item.only("id", "kind", "text", "enabled"); err != nil {
			return p, err
		}
		r := RuleItem{ID: id}
		if r.Kind, err = requiredString(item, "kind"); err != nil {
			return p, err
		}
		if r.Kind != "length" && r.Kind != "tone" && r.Kind != "style" && r.Kind != "avoid" {
			return p, ErrInvalidPayload
		}
		if r.Text, err = requiredString(item, "text"); err != nil {
			return p, err
		}
		if v, ok := item["enabled"]; ok {
			b, err := asBool(v)
			if err != nil {
				return p, err
			}
			r.Enabled = &b
		}
		p.Rule = &r
	}
	return p, nil
}

// ResumeSetPayload is the profile.resume.set payload.
type ResumeSetPayload struct {
	Text   string
	Source string
}

// ParseResumeSetPayload strictly decodes a profile.resume.set payload:
// exactly {text, source} with source pasted, pdf, or docx. Length limits and
// content rules belong to the profile store (INVALID_REQUEST).
func ParseResumeSetPayload(raw json.RawMessage) (ResumeSetPayload, error) {
	var p ResumeSetPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("text", "source"); err != nil {
		return p, err
	}
	if p.Text, err = requiredString(obj, "text"); err != nil {
		return p, err
	}
	if p.Source, err = requiredString(obj, "source"); err != nil {
		return p, err
	}
	if p.Source != "pasted" && p.Source != "pdf" && p.Source != "docx" {
		return p, ErrInvalidPayload
	}
	return p, nil
}

// ParseItemDeletePayload strictly decodes a profile.item.delete payload.
func ParseItemDeletePayload(raw json.RawMessage) (ItemDeletePayload, error) {
	var p ItemDeletePayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("kind", "id"); err != nil {
		return p, err
	}
	if p.Kind, err = requiredString(obj, "kind"); err != nil {
		return p, err
	}
	prefix, ok := kindPrefix(p.Kind)
	if !ok {
		return p, ErrInvalidPayload
	}
	if p.ID, err = requiredString(obj, "id"); err != nil {
		return p, err
	}
	if !validItemID(p.ID, prefix) {
		return p, ErrInvalidPayload
	}
	return p, nil
}

// ImportDocumentPayload is the profile.import.document payload: the raw bytes
// of one .docx file. There is deliberately no file name (privacy: nothing is
// needed from it; the file type is decided from the bytes).
type ImportDocumentPayload struct {
	Bytes []byte
}

// ParseImportDocumentPayload strictly decodes exactly {"bytesBase64": "..."}
// with standard padded base64 that decodes to at most limits.MaxDocxFileBytes.
// An empty or over-size file is INVALID_REQUEST (the extension shows the paste
// fallback); the type and content checks belong to the importer.
func ParseImportDocumentPayload(raw json.RawMessage) (ImportDocumentPayload, error) {
	var p ImportDocumentPayload
	obj, err := decodeObject(raw)
	if err != nil {
		return p, ErrInvalidPayload
	}
	if err := obj.only("bytesBase64"); err != nil {
		return p, err
	}
	s, err := requiredString(obj, "bytesBase64")
	if err != nil {
		return p, err
	}
	// Check the encoded length first so an oversized string is never decoded.
	if s == "" || len(s) > base64.StdEncoding.EncodedLen(limits.MaxDocxFileBytes) {
		return p, ErrInvalidPayload
	}
	// The decoder skips CR and LF; the TypeScript schema does not allow them.
	if strings.ContainsAny(s, "\r\n") {
		return p, ErrInvalidPayload
	}
	b, err := base64.StdEncoding.Strict().DecodeString(s)
	if err != nil || len(b) == 0 || len(b) > limits.MaxDocxFileBytes {
		return p, ErrInvalidPayload
	}
	p.Bytes = b
	return p, nil
}
