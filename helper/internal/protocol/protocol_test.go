package protocol

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
)

const sentinel = "SENTINEL-SECRET-TEXT-123"

func TestValidRequestID(t *testing.T) {
	tests := []struct {
		id string
		ok bool
	}{
		{"a", true}, {"A-z_0-9", true}, {strings.Repeat("a", 64), true}, {"7c1f2a3b-0000-4000-8000-000000000001", true},
		{"", false}, {strings.Repeat("a", 65), false}, {"a b", false}, {"a/b", false}, {"é", false}, {"a\n", false},
	}
	for _, tt := range tests {
		if got := ValidRequestID(tt.id); got != tt.ok {
			t.Errorf("ValidRequestID(%q) = %v", tt.id, got)
		}
	}
}

func TestParseRequestStrictness(t *testing.T) {
	hello := `"type":"helper.hello","payload":{"extensionVersion":"1"}`
	tests := []struct {
		name   string
		body   string
		want   error
		wantID string
	}{
		{"ok", `{"protocolVersion":1,"requestId":"r1",` + hello + `}`, nil, "r1"},
		{"duplicate top-level key", `{"protocolVersion":1,"requestId":"r1","requestId":"r2",` + hello + `}`, ErrMalformed, ""},
		{"duplicate payload key", `{"protocolVersion":1,"requestId":"r1","type":"helper.hello","payload":{"extensionVersion":"1","extensionVersion":"2"}}`, ErrInvalidPayload, "r1"},
		{"trailing data", `{"protocolVersion":1,"requestId":"r1",` + hello + `}{}`, ErrMalformed, ""},
		{"trailing garbage", `{"protocolVersion":1,"requestId":"r1",` + hello + `} x`, ErrMalformed, ""},
		{"case-variant key", `{"protocolVersion":1,"RequestId":"r1",` + hello + `}`, ErrUnknownField, ""},
		{"payload case-variant key", `{"protocolVersion":1,"requestId":"r1","type":"helper.hello","payload":{"ExtensionVersion":"1"}}`, ErrUnknownField, "r1"},
		{"not an object", `[1]`, ErrMalformed, ""},
		{"null", `null`, ErrMalformed, ""},
		{"not json", `nope`, ErrMalformed, ""},
		{"version string", `{"protocolVersion":"1","requestId":"r1",` + hello + `}`, ErrInvalidEnvelope, "r1"},
		{"version 1.5", `{"protocolVersion":1.5,"requestId":"r1",` + hello + `}`, ErrUnsupportedVersion, "r1"},
		{"version 0", `{"protocolVersion":0,"requestId":"r1",` + hello + `}`, ErrUnsupportedVersion, "r1"},
		{"future version with extra field", `{"protocolVersion":2,"requestId":"r1","x":1,` + hello + `}`, ErrUnsupportedVersion, "r1"},
		{"type not string", `{"protocolVersion":1,"requestId":"r1","type":5,"payload":{}}`, ErrInvalidEnvelope, "r1"},
		{"payload missing", `{"protocolVersion":1,"requestId":"r1","type":"helper.hello"}`, ErrInvalidEnvelope, "r1"},
		{"payload null", `{"protocolVersion":1,"requestId":"r1","type":"helper.hello","payload":null}`, ErrInvalidPayload, "r1"},
		{"proto key type", `{"protocolVersion":1,"requestId":"r1","type":"constructor","payload":{}}`, ErrUnknownType, "r1"},
		{"bad id keeps empty", `{"protocolVersion":1,"requestId":"a b",` + hello + `}`, ErrInvalidRequestID, ""},
		{"empty body", ``, ErrMalformed, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env, err := ParseRequest([]byte(tt.body))
			if tt.want == nil {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if env.RequestID != tt.wantID && !(tt.want == nil && env.RequestID == tt.wantID) {
				t.Fatalf("requestID = %q, want %q", env.RequestID, tt.wantID)
			}
		})
	}
}

func TestParseRequestExactLimit(t *testing.T) {
	// A body of exactly the limit passes the size check and fails later on the
	// payload limits (not on size); limit+1 fails on size.
	head := `{"protocolVersion":1,"requestId":"r1","type":"draft.generate","payload":{"question":"Why do you want this?","constraints":{"maxWords":150},"requestedAt":"2026-11-19T15:04:05Z","jobContext":"`
	mk := func(n int) []byte {
		return []byte(head + strings.Repeat("a", n-len(head)-3) + `"}}`)
	}
	_, err := ParseRequest(mk(limits.MaxNativeRequestBytes))
	if errors.Is(err, ErrMessageTooLarge) || !errors.Is(err, ErrInvalidPayload) {
		t.Fatalf("exact limit: %v", err)
	}
	if _, err := ParseRequest(mk(limits.MaxNativeRequestBytes + 1)); !errors.Is(err, ErrMessageTooLarge) {
		t.Fatalf("limit+1: %v", err)
	}
}

func TestParseDraftRequestTyped(t *testing.T) {
	raw := `{"question":"  Why do you want this job?  ","jobContext":"ctx","constraints":{"maxWords":100,"maxChars":500,"refinement":"direct","currentDraft":"x"},"requestedAt":"2026-11-19T15:04:05Z"}`
	d, err := ParseDraftRequest(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if d.Constraints.MaxWords != 100 || *d.Constraints.MaxChars != 500 || *d.Constraints.Refinement != "direct" || *d.JobContext != "ctx" {
		t.Fatalf("%+v", d)
	}
	for _, bad := range []string{
		`{"question":"Why do you want this job?","constraints":{"maxWords":100.5},"requestedAt":"2026-11-19T15:04:05Z"}`,
		`{"question":"Why do you want this job?","constraints":{"maxWords":null},"requestedAt":"2026-11-19T15:04:05Z"}`,
		`{"question":"Why do you want this job?","jobContext":null,"constraints":{"maxWords":100},"requestedAt":"2026-11-19T15:04:05Z"}`,
		`{"question":"Why do you want this job?","constraints":{"maxWords":100},"requestedAt":"2026-11-19 15:04:05Z"}`,
		`{"question":"Why do you want this job?","constraints":{"maxWords":100}}`,
	} {
		if _, err := ParseDraftRequest(json.RawMessage(bad)); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestResponseBuilders(t *testing.T) {
	env, err := BuildSuccessResponse("r1", DraftResponse{Answer: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(env)
	if !strings.Contains(string(body), `"evidenceIds":[]`) || strings.Contains(string(body), `"error"`) {
		t.Fatalf("body: %s", body)
	}
	parsed, err := ParseResponse(body)
	if err != nil || !parsed.OK {
		t.Fatalf("round trip: %v", err)
	}
	if _, err := ParseDraftResponse(parsed.Result); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildSuccessResponse("", map[string]int{}); !errors.Is(err, ErrInvalidRequestID) {
		t.Fatal("empty id accepted for success")
	}
	if _, err := BuildSuccessResponse("r1", nil); err == nil {
		t.Fatal("null result accepted")
	}

	e := BuildErrorResponse("bad id", ErrMalformed)
	body, _ = json.Marshal(e)
	if e.RequestID != "" || e.OK || e.Result != nil || !strings.Contains(string(body), `"requestId":""`) || strings.Contains(string(body), `"result"`) {
		t.Fatalf("error response: %s", body)
	}
	if _, err := ParseResponse(body); err != nil {
		t.Fatalf("own error response rejected: %v", err)
	}
	if BuildErrorResponse("r1", ErrMalformed).RequestID != "r1" {
		t.Fatal("valid id not echoed")
	}
}

func TestToAppErrorMapping(t *testing.T) {
	tests := []struct {
		err  error
		want ErrorCode
	}{
		{ErrUnsupportedVersion, CodeProtocolVersionUnsupported},
		{ErrMessageTooLarge, CodeMessageTooLarge},
		{ErrMalformed, CodeInvalidRequest},
		{ErrUnknownField, CodeInvalidRequest},
		{ErrUnknownType, CodeInvalidRequest},
		{ErrInvalidPayload, CodeInvalidRequest},
		{ErrInvalidRequestID, CodeInvalidRequest},
		{ErrInvalidEnvelope, CodeInvalidRequest},
		{ErrEmptyMessage, CodeInvalidRequest},
		{ErrTruncatedBody, CodeInternalError},
		{ErrEndOfStream, CodeInternalError},
		{errors.New("something " + sentinel), CodeInternalError},
		{nil, CodeInternalError},
	}
	for _, tt := range tests {
		if got := ToAppError(tt.err).Code; got != tt.want {
			t.Errorf("ToAppError(%v) = %s, want %s", tt.err, got, tt.want)
		}
	}
	wrapped := errors.Join(errors.New(sentinel), ErrMessageTooLarge)
	if ToAppError(wrapped).Code != CodeMessageTooLarge {
		t.Error("wrapped error not mapped")
	}
}

func TestErrorsNeverContainInput(t *testing.T) {
	bodies := []string{
		`{"protocolVersion":1,"requestId":"r1","type":"` + sentinel + `","payload":{}}`,
		`{"protocolVersion":1,"requestId":"r1","type":"draft.generate","payload":{"question":"` + sentinel + `","constraints":{"maxWords":1},"requestedAt":"x"}}`,
		`{"protocolVersion":1,"requestId":"r1","type":"helper.hello","payload":{"` + sentinel + `":1}}`,
		`{"protocolVersion":1,"requestId":"r1","` + sentinel + `":1}`,
		`{"protocolVersion":1,"requestId":"` + sentinel + ` x","type":"helper.hello","payload":{}}`,
		`{"protocolVersion":1,"requestId":"r1","type":"helper.hello","payload":{"extensionVersion":"` + sentinel + `"}} ` + sentinel,
		sentinel,
	}
	for _, b := range bodies {
		env, err := ParseRequest([]byte(b))
		if err == nil {
			t.Fatalf("accepted %s", b)
		}
		if strings.Contains(err.Error(), sentinel) {
			t.Errorf("internal error text leaks input: %v", err)
		}
		resp := BuildErrorResponse(env.RequestID, err)
		out, _ := json.Marshal(resp)
		if strings.Contains(string(out), sentinel) {
			t.Errorf("response leaks input: %s", out)
		}
	}
	// AppError text is fixed regardless of the wrapped error's text.
	leaky := ToAppError(errors.New(sentinel))
	out, _ := json.Marshal(leaky)
	if strings.Contains(string(out), sentinel) {
		t.Error("AppError leaks error text")
	}
}

func TestRegistryOnlyImplementedTypes(t *testing.T) {
	got := RegisteredTypes()
	if len(got) != 3 || len(payloadValidators) != 3 {
		t.Fatalf("registry: %v", got)
	}
	for _, name := range []string{"diagnostics.run", "profile.get", "profile.item.upsert", "profile.item.delete", "profile.import.text", "profile.import.document", "profile.export", "profile.deleteAll", "settings.setProvider"} {
		body := `{"protocolVersion":1,"requestId":"r1","type":"` + name + `","payload":{}}`
		if _, err := ParseRequest([]byte(body)); !errors.Is(err, ErrUnknownType) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestParseResponseRules(t *testing.T) {
	good := `{"code":"INTERNAL_ERROR","message":"m","retryable":false}`
	tests := []struct {
		name string
		body string
		ok   bool
	}{
		{"success", `{"protocolVersion":1,"requestId":"r1","ok":true,"result":{}}`, true},
		{"failure", `{"protocolVersion":1,"requestId":"r1","ok":false,"error":` + good + `}`, true},
		{"failure empty id", `{"protocolVersion":1,"requestId":"","ok":false,"error":` + good + `}`, true},
		{"success empty id", `{"protocolVersion":1,"requestId":"","ok":true,"result":{}}`, false},
		{"null result", `{"protocolVersion":1,"requestId":"r1","ok":true,"result":null}`, false},
		{"failure with null result", `{"protocolVersion":1,"requestId":"r1","ok":false,"result":null,"error":` + good + `}`, false},
		{"error null", `{"protocolVersion":1,"requestId":"r1","ok":false,"error":null}`, false},
		{"ok not bool", `{"protocolVersion":1,"requestId":"r1","ok":1,"result":{}}`, false},
		{"duplicate key", `{"protocolVersion":1,"requestId":"r1","ok":true,"ok":true,"result":{}}`, false},
	}
	for _, tt := range tests {
		_, err := ParseResponse([]byte(tt.body))
		if (err == nil) != tt.ok {
			t.Errorf("%s: err = %v", tt.name, err)
		}
	}
	big := `{"protocolVersion":1,"requestId":"r1","ok":true,"result":{"a":"` + strings.Repeat("a", limits.MaxNativeResponseBytes) + `"}}`
	if _, err := ParseResponse([]byte(big)); !errors.Is(err, ErrMessageTooLarge) {
		t.Fatal("oversize response accepted")
	}
}

func TestBuildCodeErrorResponse(t *testing.T) {
	r := BuildCodeErrorResponse("abc", CodeInternalError)
	if r.OK || r.RequestID != "abc" || r.Error == nil || *r.Error != NewAppError(CodeInternalError) || r.Result != nil {
		t.Fatalf("unexpected response %+v", r)
	}
	if BuildCodeErrorResponse("bad id!", CodeInternalError).RequestID != "" {
		t.Fatal("invalid request id must not be echoed")
	}
	if BuildCodeErrorResponse("abc", "NOPE").Error.Code != CodeInternalError {
		t.Fatal("unknown code must become INTERNAL_ERROR")
	}
}
