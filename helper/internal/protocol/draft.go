package protocol

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"jobanswer/helper/internal/limits"
)

// Refinement values.
const (
	RefinementRegenerate = "regenerate"
	RefinementShorter    = "shorter"
	RefinementDirect     = "direct"
)

// DraftConstraints is PRD 16.2. MaxWords is required on the wire.
type DraftConstraints struct {
	MaxWords     int     `json:"maxWords"`
	MaxChars     *int    `json:"maxChars,omitempty"`
	Refinement   *string `json:"refinement,omitempty"`
	CurrentDraft *string `json:"currentDraft,omitempty"`
}

// DraftRequest is PRD 16.2.
type DraftRequest struct {
	Question    string           `json:"question"`
	JobContext  *string          `json:"jobContext,omitempty"`
	Constraints DraftConstraints `json:"constraints"`
	RequestedAt string           `json:"requestedAt"`
}

// DraftWarning is PRD 16.2.
type DraftWarning struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// UsedFact is a fact shown as evidence; texts come from the helper.
type UsedFact struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// DraftResponse is PRD 16.2.
type DraftResponse struct {
	Answer      string         `json:"answer"`
	EvidenceIDs []string       `json:"evidenceIds"`
	Warnings    []DraftWarning `json:"warnings"`
	UsedFacts   []UsedFact     `json:"usedFacts"`
}

// MarshalJSON emits empty arrays instead of null for nil slices.
func (d DraftResponse) MarshalJSON() ([]byte, error) {
	type alias DraftResponse
	if d.EvidenceIDs == nil {
		d.EvidenceIDs = []string{}
	}
	if d.Warnings == nil {
		d.Warnings = []DraftWarning{}
	}
	if d.UsedFacts == nil {
		d.UsedFacts = []UsedFact{}
	}
	return json.Marshal(alias(d))
}

var requestedAtPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)

func validRequestedAt(s string) bool {
	if !requestedAtPattern.MatchString(s) {
		return false
	}
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}

// ParseDraftRequest strictly decodes and validates a draft.generate payload.
func ParseDraftRequest(raw json.RawMessage) (DraftRequest, error) {
	var req DraftRequest
	obj, err := decodeObject(raw)
	if err != nil {
		return req, ErrInvalidPayload
	}
	if err := obj.only("question", "jobContext", "constraints", "requestedAt"); err != nil {
		return req, err
	}
	qRaw, ok := obj["question"]
	if !ok {
		return req, ErrInvalidPayload
	}
	if req.Question, err = asString(qRaw); err != nil {
		return req, err
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(req.Question)); n < limits.MinQuestionChars || n > limits.MaxQuestionChars {
		return req, ErrInvalidPayload
	}
	if jc, ok := obj["jobContext"]; ok {
		s, err := asStringBounded(jc, 0, limits.MaxJobContextChars)
		if err != nil {
			return req, err
		}
		req.JobContext = &s
	}
	atRaw, ok := obj["requestedAt"]
	if !ok {
		return req, ErrInvalidPayload
	}
	if req.RequestedAt, err = asString(atRaw); err != nil {
		return req, err
	}
	if !validRequestedAt(req.RequestedAt) {
		return req, ErrInvalidPayload
	}
	cRaw, ok := obj["constraints"]
	if !ok {
		return req, ErrInvalidPayload
	}
	if req.Constraints, err = parseConstraints(cRaw); err != nil {
		return req, err
	}
	return req, nil
}

func parseConstraints(raw json.RawMessage) (DraftConstraints, error) {
	var c DraftConstraints
	obj, err := decodeObject(raw)
	if err != nil {
		return c, ErrInvalidPayload
	}
	if err := obj.only("maxWords", "maxChars", "refinement", "currentDraft"); err != nil {
		return c, err
	}
	mw, ok := obj["maxWords"]
	if !ok {
		return c, ErrInvalidPayload
	}
	if c.MaxWords, err = asInt(mw); err != nil {
		return c, err
	}
	if c.MaxWords < limits.MinMaxWords || c.MaxWords > limits.MaxMaxWords {
		return c, ErrInvalidPayload
	}
	if raw, ok := obj["maxChars"]; ok {
		n, err := asInt(raw)
		if err != nil || n < 1 {
			return c, ErrInvalidPayload
		}
		c.MaxChars = &n
	}
	if raw, ok := obj["refinement"]; ok {
		s, err := asString(raw)
		if err != nil {
			return c, err
		}
		if s != RefinementRegenerate && s != RefinementShorter && s != RefinementDirect {
			return c, ErrInvalidPayload
		}
		c.Refinement = &s
	}
	if raw, ok := obj["currentDraft"]; ok {
		s, err := asStringBounded(raw, 1, limits.MaxCurrentDraftChars)
		if err != nil {
			return c, err
		}
		c.CurrentDraft = &s
	}
	needsDraft := c.Refinement != nil && (*c.Refinement == RefinementShorter || *c.Refinement == RefinementDirect)
	if needsDraft != (c.CurrentDraft != nil) {
		return c, ErrInvalidPayload
	}
	return c, nil
}

// ParseDraftResponse strictly decodes and validates a DraftResponse result.
func ParseDraftResponse(raw json.RawMessage) (DraftResponse, error) {
	var d DraftResponse
	obj, err := decodeObject(raw)
	if err != nil {
		return d, ErrInvalidPayload
	}
	if err := obj.only("answer", "evidenceIds", "warnings", "usedFacts"); err != nil {
		return d, err
	}
	for _, k := range []string{"answer", "evidenceIds", "warnings", "usedFacts"} {
		if _, ok := obj[k]; !ok {
			return d, ErrInvalidPayload
		}
	}
	if d.Answer, err = asStringBounded(obj["answer"], 1, 1<<30); err != nil {
		return d, err
	}
	ids, err := decodeArray(obj["evidenceIds"])
	if err != nil {
		return d, err
	}
	d.EvidenceIDs = []string{}
	for _, e := range ids {
		s, err := asString(e)
		if err != nil {
			return d, err
		}
		d.EvidenceIDs = append(d.EvidenceIDs, s)
	}
	ws, err := decodeArray(obj["warnings"])
	if err != nil {
		return d, err
	}
	d.Warnings = []DraftWarning{}
	for _, e := range ws {
		w, err := parseWarning(e)
		if err != nil {
			return d, err
		}
		d.Warnings = append(d.Warnings, w)
	}
	fs, err := decodeArray(obj["usedFacts"])
	if err != nil {
		return d, err
	}
	d.UsedFacts = []UsedFact{}
	for _, e := range fs {
		fo, err := decodeObject(e)
		if err != nil {
			return d, ErrInvalidPayload
		}
		if err := fo.only("id", "text"); err != nil {
			return d, err
		}
		idRaw, ok1 := fo["id"]
		textRaw, ok2 := fo["text"]
		if !ok1 || !ok2 {
			return d, ErrInvalidPayload
		}
		var f UsedFact
		if f.ID, err = asString(idRaw); err != nil {
			return d, err
		}
		if f.Text, err = asString(textRaw); err != nil {
			return d, err
		}
		d.UsedFacts = append(d.UsedFacts, f)
	}
	return d, nil
}

func decodeArray(raw json.RawMessage) ([]json.RawMessage, error) {
	var arr []json.RawMessage
	t := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(t, "[") {
		return nil, ErrInvalidPayload
	}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil, ErrInvalidPayload
	}
	return arr, nil
}

func parseWarning(raw json.RawMessage) (DraftWarning, error) {
	var w DraftWarning
	obj, err := decodeObject(raw)
	if err != nil {
		return w, ErrInvalidPayload
	}
	if err := obj.only("code", "severity", "message"); err != nil {
		return w, err
	}
	cr, ok1 := obj["code"]
	sr, ok2 := obj["severity"]
	mr, ok3 := obj["message"]
	if !ok1 || !ok2 || !ok3 {
		return w, ErrInvalidPayload
	}
	if w.Code, err = asString(cr); err != nil {
		return w, err
	}
	switch w.Code {
	case "UNSUPPORTED_CLAIM", "LOW_FACT_SUPPORT", "TRUNCATED_CONTEXT", "MODEL_NOTE":
	default:
		return w, ErrInvalidPayload
	}
	if w.Severity, err = asString(sr); err != nil {
		return w, err
	}
	if w.Severity != "info" && w.Severity != "warn" {
		return w, ErrInvalidPayload
	}
	if w.Message, err = asStringBounded(mr, 0, limits.MaxWarningMessageChars); err != nil {
		return w, err
	}
	return w, nil
}
