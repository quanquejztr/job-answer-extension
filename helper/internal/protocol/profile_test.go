package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
)

func TestParseItemUpsertPayloadShapes(t *testing.T) {
	p, err := ParseItemUpsertPayload(json.RawMessage(`{"kind":"story","item":{"id":"s_3","title":"a","text":"b"}}`))
	if err != nil || p.Story == nil || p.Story.ID != "s_3" || p.Story.Title != "a" || p.Sample != nil {
		t.Fatalf("story update: %+v %v", p, err)
	}
	p, err = ParseItemUpsertPayload(json.RawMessage(`{"kind":"story","item":{"title":"a","text":"b"}}`))
	if err != nil || p.Story == nil || p.Story.ID != "" {
		t.Fatalf("create has no id: %+v %v", p, err)
	}
	p, err = ParseItemUpsertPayload(json.RawMessage(`{"kind":"rule","item":{"kind":"tone","text":"x","enabled":false}}`))
	if err != nil || p.Rule == nil || p.Rule.Enabled == nil || *p.Rule.Enabled {
		t.Fatalf("rule: %+v %v", p, err)
	}
	p, err = ParseItemUpsertPayload(json.RawMessage(`{"kind":"rule","item":{"kind":"tone","text":"x"}}`))
	if err != nil || p.Rule.Enabled != nil {
		t.Fatalf("rule default: %+v %v", p, err)
	}
	p, err = ParseItemUpsertPayload(json.RawMessage(`{"kind":"sample","item":{"label":"l","text":"t"}}`))
	if err != nil || p.Sample == nil {
		t.Fatalf("sample: %+v %v", p, err)
	}
}

func TestProfilePayloadRejectionsNeverEchoInput(t *testing.T) {
	const sentinel = "PAYLOADSENTINEL"
	bad := []string{
		`{"kind":"` + sentinel + `","item":{}}`,
		`{"kind":"story","item":{"title":"t","text":"` + sentinel + `","extra":1}}`,
		`{"kind":"story","item":{"title":"t","text":"` + sentinel + `","tags":[]}}`,
		`{"kind":"story","item":{"title":"t","text":"` + sentinel + `","factIds":["f_1"]}}`,
		`{"kind":"fact","item":{"text":"` + sentinel + `","source":"user","tags":[]}}`,
		`{"kind":"story","item":{"id":"` + sentinel + `","title":"t","text":"t"}}`,
		`{"kind":"story","item":{"title":"t","text":"t","text":"` + sentinel + `"}}`,
	}
	for _, b := range bad {
		_, err := ParseItemUpsertPayload(json.RawMessage(b))
		if err == nil {
			t.Fatalf("accepted %s", b)
		}
		if strings.Contains(err.Error(), sentinel) || ToAppError(err).Code != CodeInvalidRequest {
			t.Fatalf("bad error for %s: %v", b, err)
		}
	}
	if _, err := ParseItemDeletePayload(json.RawMessage(`{"kind":"story","id":"` + sentinel + `"}`)); !errors.Is(err, ErrInvalidPayload) {
		t.Fatalf("delete: %v", err)
	}
	if _, err := ParseItemDeletePayload(json.RawMessage(`{"kind":"fact","id":"f_1"}`)); !errors.Is(err, ErrInvalidPayload) {
		t.Fatalf("fact delete kind must be gone: %v", err)
	}
	for _, b := range []string{
		`{"text":"` + sentinel + `","source":"` + sentinel + `"}`,
		`{"text":"` + sentinel + `"}`,
		`{"text":"` + sentinel + `","source":"pasted","extra":1}`,
		`{"text":"` + sentinel + `","source":"pasted","text":"x"}`,
		`{"text":1,"source":"pasted"}`,
		`[]`,
	} {
		_, err := ParseResumeSetPayload(json.RawMessage(b))
		if err == nil || strings.Contains(err.Error(), sentinel) || ToAppError(err).Code != CodeInvalidRequest {
			t.Fatalf("resume payload %s: %v", b, err)
		}
	}
	if err := ParseProfileGetPayload(json.RawMessage(`[]`)); err == nil {
		t.Fatal("array payload accepted")
	}
	if err := ParseProfileGetPayload(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
}

func TestBuildSuccessResponseDoesNotEscapeHTML(t *testing.T) {
	resp, err := BuildSuccessResponse("r1", map[string]string{"t": "<a & b>"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := MarshalResponse(resp)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"<a & b>"`) {
		t.Fatalf("escaped: %s", out)
	}
}

func TestParseExportAndDeleteAllPayloads(t *testing.T) {
	const sentinel = "PAYLOADSENTINEL"
	if err := ParseProfileExportPayload(json.RawMessage(`{}`)); err != nil {
		t.Fatalf("export {}: %v", err)
	}
	for _, b := range []string{`{"x":1}`, `[]`, `null`, `"s"`, `{"a":1,"a":2}`} {
		if err := ParseProfileExportPayload(json.RawMessage(b)); err == nil {
			t.Errorf("export accepted %s", b)
		}
	}
	if err := ParseDeleteAllPayload(json.RawMessage(`{"confirm":"DELETE"}`)); err != nil {
		t.Fatalf("deleteAll: %v", err)
	}
	bad := []string{
		`{}`, `{"confirm":"delete"}`, `{"confirm":"Delete"}`, `{"confirm":"DELETE "}`, `{"confirm":" DELETE"}`,
		`{"confirm":""}`, `{"confirm":true}`, `{"confirm":1}`, `{"confirm":null}`, `{"confirm":["DELETE"]}`,
		`{"confirm":"DELETE","keep":"facts"}`, `{"confirm":"DELETE","confirm":"DELETE"}`, `[]`, `null`,
		`{"confirm":"` + sentinel + `"}`,
	}
	for _, b := range bad {
		err := ParseDeleteAllPayload(json.RawMessage(b))
		if err == nil {
			t.Errorf("deleteAll accepted %s", b)
			continue
		}
		if strings.Contains(err.Error(), sentinel) || strings.Contains(ToAppError(err).Message, sentinel) {
			t.Errorf("error echoes input for %s", b)
		}
		if ToAppError(err).Code != CodeInvalidRequest {
			t.Errorf("%s -> %s", b, ToAppError(err).Code)
		}
	}
}

func TestParseResumeSetPayload(t *testing.T) {
	for _, src := range []string{"pasted", "pdf", "docx"} {
		p, err := ParseResumeSetPayload(json.RawMessage(`{"text":"my résumé","source":"` + src + `"}`))
		if err != nil || p.Text != "my résumé" || p.Source != src {
			t.Fatalf("%s: %+v %v", src, p, err)
		}
	}
	// Length and content rules belong to the store, not the protocol layer.
	long := strings.Repeat("a", 20000)
	if _, err := ParseResumeSetPayload(json.RawMessage(`{"text":"` + long + `","source":"pasted"}`)); err != nil {
		t.Fatalf("protocol layer must not apply length limits: %v", err)
	}
	if _, err := ParseResumeSetPayload(json.RawMessage(`{"text":"x","source":"Pasted"}`)); err == nil {
		t.Fatal("source is case sensitive")
	}
}

func TestParseImportDocumentPayload(t *testing.T) {
	raw := bytes.Repeat([]byte{7}, 1000)
	enc := base64.StdEncoding.EncodeToString(raw)
	p, err := ParseImportDocumentPayload(json.RawMessage(`{"bytesBase64":"` + enc + `"}`))
	if err != nil || !bytes.Equal(p.Bytes, raw) {
		t.Fatalf("valid payload: %v", err)
	}
	atCap := base64.StdEncoding.EncodeToString(make([]byte, limits.MaxDocxFileBytes))
	if _, err := ParseImportDocumentPayload(json.RawMessage(`{"bytesBase64":"` + atCap + `"}`)); err != nil {
		t.Fatalf("at the cap: %v", err)
	}
	if limits.MaxNativeRequestBytes < len(atCap)+200 {
		t.Fatalf("a file at the cap does not fit one native request: %d", len(atCap))
	}
	overCap := base64.StdEncoding.EncodeToString(make([]byte, limits.MaxDocxFileBytes+1))
	bad := map[string]string{
		"over cap":       `{"bytesBase64":"` + overCap + `"}`,
		"way over":       `{"bytesBase64":"` + strings.Repeat("A", 400000) + `"}`,
		"empty":          `{"bytesBase64":""}`,
		"missing":        `{}`,
		"filename":       `{"bytesBase64":"` + enc + `","filename":"a.docx"}`,
		"not string":     `{"bytesBase64":5}`,
		"null":           `{"bytesBase64":null}`,
		"bad characters": `{"bytesBase64":"@@@@"}`,
		"unpadded":       `{"bytesBase64":"` + strings.TrimRight(enc, "=") + `A"}`,
		"url alphabet":   `{"bytesBase64":"_-_-"}`,
		"newline":        `{"bytesBase64":"AAAA\nAAAA"}`,
		"array":          `[]`,
	}
	for name, body := range bad {
		if _, err := ParseImportDocumentPayload(json.RawMessage(body)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
