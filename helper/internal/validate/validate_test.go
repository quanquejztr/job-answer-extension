package validate

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

const (
	resumeText = "Built a route optimizer in Go that cut delivery time by 15% for 3.5 million parcels in 2024.\n\n  Managed a $120,000 budget and shipped a 10x faster importer."
	storyText  = "Led a team of three on the Harbor Logistics project, shipping on time."
	sampleText = "My writing sample says something unique about gardening."
)

func prof() profile.Profile {
	return profile.Profile{
		SchemaVersion: profile.SchemaVersion,
		Resume:        &profile.Resume{Text: resumeText, Source: profile.SourcePasted},
		Stories:       []profile.Story{{ID: "s_2", Title: "Harbor", Text: storyText}},
		Samples:       []profile.WritingSample{{ID: "w_3", Label: "l", Text: sampleText}},
	}
}

func req(maxWords int, maxChars *int) protocol.DraftRequest {
	jc := "We value Customer Obsession and hire for 2025."
	return protocol.DraftRequest{
		Question:    "Tell us about a project you shipped in 90 days?",
		JobContext:  &jc,
		Constraints: protocol.DraftConstraints{MaxWords: maxWords, MaxChars: maxChars},
	}
}

var resumeQuote = protocol.EvidenceQuote{Source: "resume", Quote: "Built a route optimizer in Go"}

func resp(mod func(*protocol.DraftResponse)) protocol.DraftResponse {
	r := protocol.DraftResponse{
		Answer:   "one two three",
		Evidence: []protocol.EvidenceQuote{resumeQuote},
		Warnings: []protocol.DraftWarning{},
	}
	if mod != nil {
		mod(&r)
	}
	return r
}

func quote(source, q string) func(*protocol.DraftResponse) {
	return func(r *protocol.DraftResponse) { r.Evidence = []protocol.EvidenceQuote{{Source: source, Quote: q}} }
}

func answer(a string) func(*protocol.DraftResponse) {
	return func(r *protocol.DraftResponse) { r.Answer = a }
}

func TestDraftResponse(t *testing.T) {
	three := 13
	unsupported, invalid := ErrUnsupported, ErrOutputInvalid
	cFact, cOut := protocol.CodeFactValidationFailed, protocol.CodeProviderOutputInvalid
	tests := []struct {
		name string
		req  protocol.DraftRequest
		resp protocol.DraftResponse
		want error
		code protocol.ErrorCode
	}{
		{"valid", req(20, nil), resp(nil), nil, ""},
		{"empty answer", req(20, nil), resp(answer("")), invalid, cOut},
		{"blank answer", req(20, nil), resp(answer(" \n\t")), invalid, cOut},
		{"too many words", req(20, nil), resp(answer(strings.Repeat("w ", 21))), invalid, cOut},
		{"exactly maxWords", req(20, nil), resp(answer(strings.Repeat("w ", 20))), nil, ""},
		{"exactly maxChars", req(20, &three), resp(nil), nil, ""},
		{"one over maxChars", req(20, &three), resp(answer("one two three x")), invalid, cOut},
		{"maxChars counts characters not bytes", req(20, &three), resp(answer("ééé ééé ééé")), nil, ""},
		{"bad warning code", req(20, nil), resp(func(r *protocol.DraftResponse) {
			r.Warnings = []protocol.DraftWarning{{Code: "X", Severity: "info", Message: "m"}}
		}), invalid, cOut},
		{"removed LOW_FACT_SUPPORT warning code", req(20, nil), resp(func(r *protocol.DraftResponse) {
			r.Warnings = []protocol.DraftWarning{{Code: "LOW_FACT_SUPPORT", Severity: "info", Message: "m"}}
		}), invalid, cOut},
		{"too many quotes", req(20, nil), resp(func(r *protocol.DraftResponse) {
			r.Evidence = make([]protocol.EvidenceQuote, MaxEvidence+1)
			for i := range r.Evidence {
				r.Evidence[i] = resumeQuote
			}
		}), invalid, cOut},

		// Evidence quotes (AC-031, AC-063).
		{"story source", req(20, nil), resp(quote("story:s_2", "Led a team of three on the Harbor Logistics")), nil, ""},
		{"zero quotes", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Evidence = []protocol.EvidenceQuote{} }), unsupported, cFact},
		{"nil quotes", req(20, nil), resp(func(r *protocol.DraftResponse) { r.Evidence = nil }), unsupported, cFact},
		{"unknown story id", req(20, nil), resp(quote("story:s_9", "Led a team of three on the Harbor")), unsupported, cFact},
		{"empty story id", req(20, nil), resp(quote("story:", "Built a route optimizer in Go")), unsupported, cFact},
		{"unknown source name", req(20, nil), resp(quote("job", "Built a route optimizer in Go")), unsupported, cFact},
		{"empty source", req(20, nil), resp(quote("", "Built a route optimizer in Go")), unsupported, cFact},
		{"writing sample source", req(20, nil), resp(quote("sample:w_3", "says something unique about gardening")), unsupported, cFact},
		{"writing sample id as story", req(20, nil), resp(quote("story:w_3", "says something unique about gardening")), unsupported, cFact},
		{"story quote cited as resume", req(20, nil), resp(quote("resume", "Led a team of three on the Harbor")), unsupported, cFact},
		{"resume quote cited as story", req(20, nil), resp(quote("story:s_2", "Built a route optimizer in Go")), unsupported, cFact},
		{"not an excerpt", req(20, nil), resp(quote("resume", "Built a route optimizer in Rust")), unsupported, cFact},
		{"case differs", req(20, nil), resp(quote("resume", "built a route optimizer in go")), unsupported, cFact},
		{"whitespace collapsed in the source", req(20, nil), resp(quote("resume", "in 2024. Managed a $120,000 budget")), nil, ""},
		{"whitespace collapsed in the quote", req(20, nil), resp(quote("resume", "Built   a\nroute  optimizer in Go")), nil, ""},
		{"quote of 11 code points", req(20, nil), resp(quote("resume", "Built a rou")), unsupported, cFact},
		{"quote of 12 code points", req(20, nil), resp(quote("resume", "Built a rout")), nil, ""},
		{"quote of 12 code points counts characters", req(20, nil), resp(quote("story:s_2", "Led a team of")), nil, ""},
		{"one bad quote among good ones", req(20, nil), resp(func(r *protocol.DraftResponse) {
			r.Evidence = []protocol.EvidenceQuote{resumeQuote, {Source: "resume", Quote: "never in the resume"}}
		}), unsupported, cFact},

		// Numbers, years, percentages, amounts (AC-032).
		{"supported percent", req(40, nil), resp(answer("I cut delivery time by 15% last year")), nil, ""},
		{"supported amount with commas", req(40, nil), resp(answer("I managed a $120,000 budget")), nil, ""},
		{"supported amount without commas", req(40, nil), resp(answer("I managed a 120000 budget")), nil, ""},
		{"supported decimal", req(40, nil), resp(answer("I served 3.5 million parcels")), nil, ""},
		{"supported year", req(40, nil), resp(answer("I shipped it in 2024")), nil, ""},
		{"supported multiplier", req(40, nil), resp(answer("It was 10x faster")), nil, ""},
		{"number from the question", req(40, nil), resp(answer("I did it within 90 days")), nil, ""},
		{"year from the job context", req(40, nil), resp(answer("I want to join in 2025")), nil, ""},
		{"unsupported percent", req(40, nil), resp(answer("I reduced latency by 45%")), unsupported, cFact},
		{"unsupported year", req(40, nil), resp(answer("I started in 2019")), unsupported, cFact},
		{"unsupported amount", req(40, nil), resp(answer("I managed a $250,000 budget")), unsupported, cFact},
		{"unsupported decimal", req(40, nil), resp(answer("Over 3.6 million parcels")), unsupported, cFact},
		{"decimal part must match", req(40, nil), resp(answer("Over 3 million parcels")), unsupported, cFact},
		{"unsupported multiplier", req(40, nil), resp(answer("It was 5x faster")), unsupported, cFact},
		{"multiplier letter must match", req(40, nil), resp(answer("It was 10k faster")), unsupported, cFact},
		{"one digit is not a substring match", req(40, nil), resp(answer("I did it in 4")), unsupported, cFact},
		{"number inside a range", req(40, nil), resp(answer("From 2024 to 2031")), unsupported, cFact},
		{"ordinal is skipped", req(40, nil), resp(answer("I finished 2nd in the contest")), nil, ""},
		{"numbers in the sample are not evidence", req(40, nil), resp(func(r *protocol.DraftResponse) {
			r.Answer = "I wrote 77 posts"
		}), unsupported, cFact},
	}
	p := prof()
	p.Samples[0].Text += " It has 77 posts."
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DraftResponse(tt.req, p, tt.resp)
			if !errors.Is(err, tt.want) || (tt.want == nil) != (err == nil) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if err != nil {
				if !reflect.DeepEqual(got, protocol.DraftResponse{}) {
					t.Fatal("a failed validation returned a response")
				}
				if got := CodeFor(err); got != tt.code {
					t.Fatalf("code = %s, want %s", got, tt.code)
				}
				for _, leak := range []string{"one two three", "route optimizer", "45%"} {
					if strings.Contains(err.Error(), leak) {
						t.Fatalf("error contains %q", leak)
					}
				}
			}
		})
	}
}

func TestNoResumeMeansNoValidResumeQuote(t *testing.T) {
	p := profile.Profile{SchemaVersion: profile.SchemaVersion}
	if _, err := DraftResponse(req(20, nil), p, resp(nil)); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v", err)
	}
}

func TestReturnedEvidenceIsTheVerifiedList(t *testing.T) {
	got, err := DraftResponse(req(20, nil), prof(), resp(quote("resume", "Built   a\nroute  optimizer in Go")))
	if err != nil {
		t.Fatal(err)
	}
	want := []protocol.EvidenceQuote{{Source: "resume", Quote: "Built a route optimizer in Go"}}
	if !reflect.DeepEqual(got.Evidence, want) {
		t.Fatalf("evidence = %+v", got.Evidence)
	}
}

func TestUnsupportedNameWarns(t *testing.T) {
	tests := []struct {
		name   string
		answer string
		warn   bool
	}{
		{"name in the job context", "I admire Customer Obsession at your firm", false},
		{"name in a story", "I led work on Harbor Logistics last year", false},
		{"unsupported name", "I worked at Acme Widgets before", true},
		{"unsupported name mentions it", "I worked with Globex Corporation Holdings", true},
		{"single capitalized word is ignored", "I worked at Acme before", false},
		{"sentence start with supported tail", "Led Harbor Logistics well", false},
		{"sentence start is not a name by itself", "Built things. Shipped things.", false},
		{"lowercase words ignored", "i worked at acme widgets", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DraftResponse(req(40, nil), prof(), resp(answer(tt.answer)))
			if err != nil {
				t.Fatalf("a name must never fail the draft: %v", err)
			}
			if got.Answer != tt.answer || len(got.Evidence) != 1 {
				t.Fatalf("draft changed: %+v", got)
			}
			if tt.warn {
				if len(got.Warnings) != 1 || got.Warnings[0].Code != "UNSUPPORTED_CLAIM" || got.Warnings[0].Severity != "warn" {
					t.Fatalf("warnings = %+v", got.Warnings)
				}
				if n := len([]rune(got.Warnings[0].Message)); n > 200 {
					t.Fatalf("warning message %d chars", n)
				}
			} else if len(got.Warnings) != 0 {
				t.Fatalf("unexpected warnings %+v", got.Warnings)
			}
		})
	}
}

func TestProviderWarningsArePreserved(t *testing.T) {
	got, err := DraftResponse(req(40, nil), prof(), resp(func(r *protocol.DraftResponse) {
		r.Answer = "I worked at Acme Widgets before"
		r.Warnings = []protocol.DraftWarning{{Code: "MODEL_NOTE", Severity: "info", Message: "note"}}
	}))
	if err != nil || len(got.Warnings) != 2 || got.Warnings[0].Code != "MODEL_NOTE" || got.Warnings[1].Code != "UNSUPPORTED_CLAIM" {
		t.Fatalf("warnings = %+v err %v", got.Warnings, err)
	}
}

func TestLongNameWarningStaysWithinTheMessageLimit(t *testing.T) {
	var names []string
	for i := 0; i < 20; i++ {
		names = append(names, "Zzzzzzzzz Qqqqqqqqq")
	}
	if n := len([]rune(nameWarning(names))); n > 200 {
		t.Fatalf("%d chars", n)
	}
}
