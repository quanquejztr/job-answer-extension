package fake

import (
	"context"
	"strings"
	"unicode/utf8"

	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
)

const (
	// SnippetChars caps each quoted snippet in code points.
	SnippetChars = 120
	// MinWords is the length the fixed padding aims for when limits allow.
	MinWords = 20
	// minQuoteChars is the shortest snippet worth citing (PRD 15.2).
	minQuoteChars = 12
)

// padding is fixed neutral wording appended when the draft is short.
const padding = "Please review and rewrite this sample wording in your own words before using it."

// FakeProvider returns a deterministic draft built ONLY from the start of the
// résumé it is given plus fixed sample wording, and cites evidence quotes taken
// from the start of the résumé and of the first story (both exact excerpts, 12
// to 120 code points). It never reads the question, job context, samples, or
// rules, and touches no file, process, or network.
type FakeProvider struct{}

// Draft implements provider.Provider.
func (FakeProvider) Draft(_ context.Context, in provider.Input) (protocol.DraftResponse, error) {
	var words []string
	words = append(words, strings.Fields("Deterministic sample draft based on your saved resume:")...)
	evidence := []protocol.EvidenceQuote{}
	if in.Profile.Resume != nil {
		snippet := snippetOf(in.Profile.Resume.Text)
		if ws := strings.Fields(snippet); len(ws) > 0 {
			last := ws[len(ws)-1]
			if !strings.HasSuffix(last, ".") && !strings.HasSuffix(last, "!") && !strings.HasSuffix(last, "?") {
				ws[len(ws)-1] = last + "."
			}
			words = append(words, ws...)
		}
		if utf8.RuneCountInString(snippet) >= minQuoteChars {
			evidence = append(evidence, protocol.EvidenceQuote{Source: "resume", Quote: snippet})
		}
	}
	for _, s := range in.Profile.Stories {
		if q := snippetOf(s.Text); utf8.RuneCountInString(q) >= minQuoteChars {
			evidence = append(evidence, protocol.EvidenceQuote{Source: "story:" + s.ID, Quote: q})
			break
		}
	}
	if len(words) < MinWords {
		words = append(words, strings.Fields(padding)...)
	}
	if limit := in.Request.Constraints.MaxWords; limit > 0 && len(words) > limit {
		words = words[:limit]
	}
	if mc := in.Request.Constraints.MaxChars; mc != nil {
		for len(words) > 0 && utf8.RuneCountInString(strings.Join(words, " ")) > *mc {
			words = words[:len(words)-1]
		}
	}
	return protocol.DraftResponse{
		Answer:   strings.Join(words, " "),
		Evidence: evidence,
		Warnings: []protocol.DraftWarning{},
	}, nil
}

// snippetOf returns the start of text with whitespace collapsed, cut to
// SnippetChars code points on a word boundary (so a number is never cut in
// half). A first word longer than the cap is cut by code points.
func snippetOf(text string) string {
	ws := strings.Fields(text)
	var b strings.Builder
	n := 0
	for _, w := range ws {
		wn := utf8.RuneCountInString(w)
		add := wn
		if n > 0 {
			add++
		}
		if n+add > SnippetChars {
			break
		}
		if n > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(w)
		n += add
	}
	if n == 0 && len(ws) > 0 {
		return string([]rune(ws[0])[:SnippetChars])
	}
	return b.String()
}

// Diagnose reports a usable fake provider: both checks pass.
func (FakeProvider) Diagnose(context.Context) []provider.Check {
	return []provider.Check{
		{Name: provider.CheckProviderExecutable, OK: true},
		{Name: provider.CheckProviderSignIn, OK: true},
	}
}
