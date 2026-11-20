package fake

import (
	"context"

	"jobanswer/helper/internal/protocol"
)

// Answer is the fixed draft text. It is independent of the request, so it
// never echoes question or job context.
const Answer = "Deterministic sample draft from the fake provider. Replace this text with your own words before using it."

// FakeProvider returns the same valid DraftResponse for every request. It
// touches no profile, file, process, or network.
type FakeProvider struct{}

// Draft implements provider.Provider.
func (FakeProvider) Draft(_ context.Context, _ protocol.DraftRequest) (protocol.DraftResponse, error) {
	return protocol.DraftResponse{
		Answer:      Answer,
		EvidenceIDs: []string{"f_1", "f_2"},
		Warnings:    []protocol.DraftWarning{},
		UsedFacts: []protocol.UsedFact{
			{ID: "f_1", Text: "Sample fact one from the fake provider."},
			{ID: "f_2", Text: "Sample fact two from the fake provider."},
		},
	}, nil
}
