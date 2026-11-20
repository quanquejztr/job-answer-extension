package protocol

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const fixtureDir = "../../../tests/protocol-fixtures"

type fixtureCase struct {
	File      string `json:"file"`
	Direction string `json:"direction"`
	Valid     bool   `json:"valid"`
	ErrorCode string `json:"errorCode"`
	Generated string `json:"generated"`
	Note      string `json:"note"`
}

func loadCases(t *testing.T) []fixtureCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixtureDir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []fixtureCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	return cases
}

// generatedBody builds a well-formed draft.generate envelope of exactly size bytes.
func generatedBody(t *testing.T, kind string) []byte {
	t.Helper()
	size := map[string]int{"oversize-request": 256*1024 + 1, "ac052-300kib": 300 * 1024}[kind]
	if size == 0 {
		t.Fatalf("unknown generated kind %q", kind)
	}
	head := `{"protocolVersion":1,"requestId":"gen-1","type":"draft.generate","payload":{"question":"Why do you want this role?","constraints":{"maxWords":150},"requestedAt":"2026-11-19T15:04:05Z","jobContext":"`
	tail := `"}}`
	pad := size - len(head) - len(tail)
	return []byte(head + string(bytes.Repeat([]byte("a"), pad)) + tail)
}

func TestSharedFixtures(t *testing.T) {
	for _, c := range loadCases(t) {
		t.Run(c.File, func(t *testing.T) {
			var body []byte
			if c.Generated != "" {
				body = generatedBody(t, c.Generated)
			} else {
				var err error
				if body, err = os.ReadFile(filepath.Join(fixtureDir, c.File)); err != nil {
					t.Fatal(err)
				}
			}
			var err error
			switch c.Direction {
			case "request":
				_, err = ParseRequest(body)
			case "response":
				_, err = ParseResponse(body)
			default:
				t.Fatalf("bad direction %q", c.Direction)
			}
			if c.Valid {
				if err != nil {
					t.Fatalf("want accept (%s), got error: %v", c.Note, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want reject (%s), got accept", c.Note)
			}
			if got := string(ToAppError(err).Code); got != c.ErrorCode {
				t.Fatalf("code = %s, want %s (%s)", got, c.ErrorCode, c.Note)
			}
		})
	}
}

func TestErrorCatalogMatchesFixture(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(fixtureDir, "errors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var want []AppError
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	codes := AllErrorCodes()
	if len(want) != 20 || len(codes) != 20 {
		t.Fatalf("catalog sizes: fixture %d, go %d", len(want), len(codes))
	}
	for i, w := range want {
		if codes[i] != w.Code {
			t.Fatalf("code order %d: %s vs %s", i, codes[i], w.Code)
		}
		if got := NewAppError(w.Code); got != w {
			t.Errorf("%s: got %+v want %+v", w.Code, got, w)
		}
	}
}

func TestValidFixtureResultParsesAsDraftResponse(t *testing.T) {
	body, err := os.ReadFile(filepath.Join(fixtureDir, "valid/response-success.json"))
	if err != nil {
		t.Fatal(err)
	}
	env, err := ParseResponse(body)
	if err != nil {
		t.Fatal(err)
	}
	d, err := ParseDraftResponse(env.Result)
	if err != nil {
		t.Fatal(err)
	}
	if d.Answer == "" || len(d.UsedFacts) != 1 || len(d.Warnings) != 1 {
		t.Fatalf("unexpected parse: %+v", d)
	}
}
