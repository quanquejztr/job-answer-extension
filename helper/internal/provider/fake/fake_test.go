package fake

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/validate"
)

var _ provider.Provider = FakeProvider{}

func input(maxWords int, maxChars *int, resume string) provider.Input {
	p := profile.Profile{SchemaVersion: profile.SchemaVersion, NextID: 1}
	if resume != "" {
		p.Resume = &profile.Resume{Text: resume, Source: profile.SourcePasted, UpdatedAt: "2026-11-20T12:00:00Z"}
	}
	return provider.Input{
		Request: protocol.DraftRequest{Question: "Why do you want this role?", Constraints: protocol.DraftConstraints{MaxWords: maxWords, MaxChars: maxChars}},
		Profile: p,
	}
}

func TestFakeIsDeterministicAndIgnoresQuestionSamplesAndRules(t *testing.T) {
	in := input(150, nil, "Built a route optimizer in Go. Led a team of three.")
	in.Profile.Stories = []profile.Story{{ID: "s_1", Title: "T", Text: "Led a logistics project for a year."}}
	a, err := FakeProvider{}.Draft(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	other := in
	other.Request.Question = "Completely different question here"
	other.Profile.Samples = []profile.WritingSample{{ID: "w_2", Label: "l", Text: "sample text must be ignored"}}
	other.Profile.Rules = []profile.WritingRule{{ID: "r_3", Kind: "tone", Text: "rule text must be ignored", Enabled: true}}
	b, _ := FakeProvider{}.Draft(context.Background(), other)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("response depends on the question, samples, or rules")
	}
	if len(a.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %+v", a)
	}
	if !strings.Contains(a.Answer, "based on your saved resume") || !strings.Contains(a.Answer, "Built a route optimizer in Go. Led a team of three.") {
		t.Fatalf("answer = %q", a.Answer)
	}
	want := []protocol.EvidenceQuote{
		{Source: "resume", Quote: "Built a route optimizer in Go. Led a team of three."},
		{Source: "story:s_1", Quote: "Led a logistics project for a year."},
	}
	if !reflect.DeepEqual(a.Evidence, want) {
		t.Fatalf("evidence = %+v", a.Evidence)
	}
	for _, w := range []int{20, 150} {
		in := input(w, nil, "Built a route optimizer in Go.")
		r, _ := FakeProvider{}.Draft(context.Background(), in)
		if _, err := validate.DraftResponse(in.Request, in.Profile, r); err != nil {
			t.Fatalf("maxWords %d: %v", w, err)
		}
	}
}

func TestFakeEvidenceIsAlwaysAnExactExcerptOfTheProfile(t *testing.T) {
	resumes := []string{
		"Built a route optimizer in Go. Led a team of three.",
		"  Spaced \n\n out   resume text with 2024 and 15% and $1,200 in it, then more words follow here.  ",
		strings.Repeat("word 2024 ", 60),
		strings.Repeat("é", 200),
	}
	for _, text := range resumes {
		in := input(150, nil, text)
		in.Profile.Stories = []profile.Story{{ID: "s_4", Title: "T", Text: "A  story\twith   odd spacing and enough length to cite."}}
		r, err := FakeProvider{}.Draft(context.Background(), in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := validate.DraftResponse(in.Request, in.Profile, r); err != nil {
			t.Fatalf("%q: %v", text, err)
		}
		for _, e := range r.Evidence {
			if n := utf8.RuneCountInString(e.Quote); n < 12 || n > 300 {
				t.Fatalf("quote has %d code points", n)
			}
		}
	}
}

func TestFakeCitesNoQuoteWhenTheTextIsTooShort(t *testing.T) {
	in := input(150, nil, "Too short")
	in.Profile.Stories = []profile.Story{{ID: "s_1", Title: "T", Text: "tiny"}}
	r, _ := FakeProvider{}.Draft(context.Background(), in)
	if len(r.Evidence) != 0 {
		t.Fatalf("evidence = %+v", r.Evidence)
	}
}

func TestFakeSkipsAStoryTooShortToCite(t *testing.T) {
	in := input(150, nil, "Built a route optimizer in Go.")
	in.Profile.Stories = []profile.Story{{ID: "s_1", Title: "T", Text: "tiny"}, {ID: "s_2", Title: "T", Text: "A story long enough to cite."}}
	r, _ := FakeProvider{}.Draft(context.Background(), in)
	if len(r.Evidence) != 2 || r.Evidence[1].Source != "story:s_2" {
		t.Fatalf("evidence = %+v", r.Evidence)
	}
}

func TestFakeSnippetNeverCutsAWordInHalf(t *testing.T) {
	text := strings.Repeat("alpha 2024 ", 30)
	r, _ := FakeProvider{}.Draft(context.Background(), input(150, nil, text))
	q := r.Evidence[0].Quote
	if n := utf8.RuneCountInString(q); n > SnippetChars || !strings.HasSuffix(q, "2024") && !strings.HasSuffix(q, "alpha") {
		t.Fatalf("quote %q (%d)", q, n)
	}
}

func TestFakeSnippetTruncatedTo120CodePointsForOneLongWord(t *testing.T) {
	r, _ := FakeProvider{}.Draft(context.Background(), input(150, nil, strings.Repeat("é", 200)))
	if strings.Count(r.Answer, "é") != SnippetChars || utf8.RuneCountInString(r.Evidence[0].Quote) != SnippetChars {
		t.Fatalf("snippet has %d code points", strings.Count(r.Answer, "é"))
	}
}

func TestFakeWithoutAResumeStillReturnsFixedWording(t *testing.T) {
	r, err := FakeProvider{}.Draft(context.Background(), input(150, nil, ""))
	if err != nil || len(strings.Fields(r.Answer)) < MinWords || len(r.Evidence) != 0 {
		t.Fatalf("answer %q err %v", r.Answer, err)
	}
}

func TestFakeRespectsLimits(t *testing.T) {
	r, _ := FakeProvider{}.Draft(context.Background(), input(20, nil, strings.Repeat("word ", 60)))
	if n := len(strings.Fields(r.Answer)); n > 20 {
		t.Fatalf("%d words over maxWords 20", n)
	}
	mc := 60
	r, _ = FakeProvider{}.Draft(context.Background(), input(150, &mc, "alpha beta gamma delta epsilon zeta eta theta"))
	if utf8.RuneCountInString(r.Answer) > mc {
		t.Fatalf("%d chars over maxChars", utf8.RuneCountInString(r.Answer))
	}
}

func TestFakeAddsNothingOutsideResumeAndFixedWording(t *testing.T) {
	r, _ := FakeProvider{}.Draft(context.Background(), input(150, nil, "Alpha 7 Beta"))
	allowed := map[string]bool{}
	for _, w := range strings.Fields("Deterministic sample draft based on your saved resume: Alpha 7 Beta. " + padding) {
		allowed[w] = true
	}
	for _, w := range strings.Fields(r.Answer) {
		if !allowed[w] {
			t.Fatalf("unexpected word %q in %q", w, r.Answer)
		}
	}
}
