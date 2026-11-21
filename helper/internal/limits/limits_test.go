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
		"maxStoryChars":          MaxStoryChars,
		"maxSampleChars":         MaxSampleChars,
		"maxRuleChars":           MaxRuleChars,
		"maxRules":               MaxRules,
		"maxSamples":             MaxSamples,
		"maxTitleChars":          MaxTitleChars,
		"maxLabelChars":          MaxLabelChars,
		"maxStories":             MaxStories,
		"maxProfileBytes":        MaxProfileBytes,
		"maxResumeChars":         MaxResumeChars,
		"maxProfileTotalChars":   MaxProfileTotalChars,
		"maxDocxFileBytes":       MaxDocxFileBytes,
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
	profile := map[string]int{
		"maxResumeChars":       15000,
		"maxStoryChars":        3000,
		"maxSampleChars":       3000,
		"maxRuleChars":         200,
		"maxRules":             20,
		"maxSamples":           5,
		"maxTitleChars":        100,
		"maxLabelChars":        60,
		"maxStories":           30,
		"maxProfileTotalChars": 40000,
		"maxProfileBytes":      393216,
		"maxDocxFileBytes":     194560,
	}
	for k, v := range profile {
		if want[k] != v {
			t.Errorf("profile limit %s changed: %d", k, want[k])
		}
	}
}
