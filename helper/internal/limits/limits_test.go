package limits

import (
	"encoding/json"
	"os"
	"testing"
)

func TestLimitsMatchFixture(t *testing.T) {
	data, err := os.ReadFile("../../../tests/protocol-fixtures/limits.json")
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]int
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{
		"minQuestionChars":       MinQuestionChars,
		"maxQuestionChars":       MaxQuestionChars,
		"maxJobContextChars":     MaxJobContextChars,
		"maxNativeRequestBytes":  MaxNativeRequestBytes,
		"maxNativeResponseBytes": MaxNativeResponseBytes,
		"providerTimeoutSeconds": ProviderTimeoutSeconds,
		"targetLifetimeSeconds":  TargetLifetimeSeconds,
		"minMaxWords":            MinMaxWords,
		"maxMaxWords":            MaxMaxWords,
		"maxCurrentDraftChars":   MaxCurrentDraftChars,
		"maxWarningMessageChars": MaxWarningMessageChars,
	}
	if len(got) != len(want) {
		t.Fatalf("fixture has %d keys, want %d", len(got), len(want))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %d in fixture, %d in Go", k, got[k], v)
		}
	}
	// Hard-coded values per PRD §15.1.
	if MinQuestionChars != 10 || MaxQuestionChars != 1000 || MaxJobContextChars != 8000 ||
		MaxNativeRequestBytes != 262144 || MaxNativeResponseBytes != 524288 ||
		ProviderTimeoutSeconds != 90 || TargetLifetimeSeconds != 600 ||
		MinMaxWords != 20 || MaxMaxWords != 400 || MaxCurrentDraftChars != 4000 || MaxWarningMessageChars != 200 {
		t.Fatal("Go limits constants changed")
	}
}
