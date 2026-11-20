package identity

import (
	"encoding/json"
	"os"
	"testing"
)

func TestIdentityMatchesFixture(t *testing.T) {
	data, err := os.ReadFile("../../../tests/protocol-fixtures/extension.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		ExtensionID    string `json:"extensionId"`
		Origin         string `json:"origin"`
		NativeHostName string `json:"nativeHostName"`
	}
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	if f.ExtensionID != ExtensionID {
		t.Errorf("extension ID differs from fixture")
	}
	if f.Origin != Origin() {
		t.Errorf("origin differs from fixture")
	}
	if f.NativeHostName != NativeHostName {
		t.Errorf("native host name differs from fixture")
	}
}
