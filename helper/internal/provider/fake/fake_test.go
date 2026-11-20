package fake

import (
	"context"
	"reflect"
	"testing"

	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/validate"
)

var _ provider.Provider = FakeProvider{}

func TestFakeIsDeterministicAndValid(t *testing.T) {
	reqA := protocol.DraftRequest{Question: "Why do you want this role?", Constraints: protocol.DraftConstraints{MaxWords: 150}}
	reqB := protocol.DraftRequest{Question: "Completely different question here", Constraints: protocol.DraftConstraints{MaxWords: 20}}
	a, err := FakeProvider{}.Draft(context.Background(), reqA)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := FakeProvider{}.Draft(context.Background(), reqB)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("response depends on the request")
	}
	if !reflect.DeepEqual(a.EvidenceIDs, []string{"f_1", "f_2"}) || len(a.UsedFacts) != 2 ||
		a.UsedFacts[0].ID != "f_1" || a.UsedFacts[1].ID != "f_2" || len(a.Warnings) != 0 {
		t.Fatalf("unexpected response %+v", a)
	}
	// Valid for the smallest allowed word limit.
	if err := validate.DraftResponse(reqB, b); err != nil {
		t.Fatalf("fake response fails validation at 20 words: %v", err)
	}
}
