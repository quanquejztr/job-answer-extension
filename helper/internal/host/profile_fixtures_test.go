package host

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

const protocolFixtureDir = "../../../tests/protocol-fixtures"

type resultCase struct {
	File        string `json:"file"`
	ResultType  string `json:"resultType"`
	ResultValid *bool  `json:"resultValid"`
	Note        string `json:"note"`
}

func strictDecode(raw []byte, into any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(into)
}

// checkResult validates a response result against the Go profile types the
// helper itself produces; the TypeScript runtime reads the same cases.
func checkResult(resultType string, result []byte) bool {
	switch {
	case resultType == "profile":
		_, err := profile.Decode(result)
		return err == nil
	case resultType == "export":
		var r struct {
			File json.RawMessage `json:"file"`
		}
		if strictDecode(result, &r) != nil || len(r.File) == 0 {
			return false
		}
		_, err := profile.Decode(r.File)
		return err == nil
	case resultType == "resume":
		var r struct {
			Resume json.RawMessage `json:"resume"`
		}
		if strictDecode(result, &r) != nil || len(r.Resume) == 0 {
			return false
		}
		// Validate the résumé exactly as the store does by embedding it in an
		// otherwise empty profile.
		_, err := profile.Decode([]byte(`{"schemaVersion":2,"nextId":1,"settings":{},"resume":` + string(r.Resume) + `,"stories":[],"samples":[],"rules":[]}`))
		return err == nil
	case resultType == "imported":
		var r struct {
			Text   string `json:"text"`
			Source string `json:"source"`
		}
		return strictDecode(result, &r) == nil && r.Text != "" && r.Source == profile.SourceDOCX
	case resultType == "diagnostics":
		var r struct {
			Checks []struct {
				Name       string `json:"name"`
				OK         bool   `json:"ok"`
				Code       string `json:"code"`
				UserAction string `json:"userAction"`
			} `json:"checks"`
		}
		if strictDecode(result, &r) != nil || len(r.Checks) == 0 {
			return false
		}
		for _, c := range r.Checks {
			if c.Name == "" || c.OK != (c.Code == "") {
				return false
			}
			if c.Code != "" && !protocol.IsKnownErrorCode(protocol.ErrorCode(c.Code)) {
				return false
			}
		}
		return true
	case resultType == "deleted":
		var r struct {
			Deleted bool `json:"deleted"`
		}
		return strictDecode(result, &r) == nil && r.Deleted
	case strings.HasPrefix(resultType, "item:"):
		var wrap struct {
			Item json.RawMessage `json:"item"`
		}
		if strictDecode(result, &wrap) != nil {
			return false
		}
		switch strings.TrimPrefix(resultType, "item:") {
		case "story":
			var s profile.Story
			return strictDecode(wrap.Item, &s) == nil && strings.HasPrefix(s.ID, "s_")
		case "sample":
			var w profile.WritingSample
			return strictDecode(wrap.Item, &w) == nil && strings.HasPrefix(w.ID, "w_")
		case "rule":
			var r profile.WritingRule
			return strictDecode(wrap.Item, &r) == nil && strings.HasPrefix(r.ID, "r_")
		}
	}
	return false
}

func TestSharedFixturesProfileResults(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(protocolFixtureDir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []resultCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, c := range cases {
		if c.ResultType == "" {
			continue
		}
		n++
		t.Run(c.File, func(t *testing.T) {
			body, err := os.ReadFile(filepath.Join(protocolFixtureDir, c.File))
			if err != nil {
				t.Fatal(err)
			}
			env, err := protocol.ParseResponse(body)
			if err != nil {
				t.Fatalf("envelope: %v", err)
			}
			if c.ResultValid == nil {
				t.Fatal("resultValid missing")
			}
			if got := checkResult(c.ResultType, env.Result); got != *c.ResultValid {
				t.Fatalf("result valid = %v, want %v (%s)", got, *c.ResultValid, c.Note)
			}
		})
	}
	if n < 20 {
		t.Fatalf("only %d result cases", n)
	}
}
