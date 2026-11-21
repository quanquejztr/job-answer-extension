package validate

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

// Evidence bounds (PRD 15.1 and 15.2). They are local to the validator and
// mirrored by the extension's internal message schema.
const (
	MinQuoteChars = 12
	MaxQuoteChars = 300
	// MaxEvidence caps the verified list a response may carry.
	MaxEvidence = 10

	maxNameWarningChars = 200
)

// Failures carry no answer, quote, or profile text.
var (
	ErrOutputInvalid = errors.New("provider output invalid")
	// ErrUnsupported means the draft is not supported by the user's résumé and
	// stories: an invalid evidence quote, no valid quote, or an unsupported
	// number, year, percentage, or amount.
	ErrUnsupported = errors.New("draft not supported by the profile")
)

// CodeFor maps a validation error to its AppError code.
func CodeFor(err error) protocol.ErrorCode {
	switch {
	case errors.Is(err, ErrUnsupported):
		return protocol.CodeFactValidationFailed
	case errors.Is(err, ErrOutputInvalid):
		return protocol.CodeProviderOutputInvalid
	default:
		return protocol.CodeInternalError
	}
}

// DraftResponse checks resp against req and the profile and returns the
// response the panel may see, or an error and nothing else.
//
// Structure, a non-empty answer, and the word and character limits fail with
// ErrOutputInvalid. Then every evidence quote must be an exact, case-sensitive
// excerpt (whitespace collapsed in both) of the résumé or a cited story, 12 to
// 300 code points, with at least one quote; every number, year, percentage, and
// amount in the answer must appear in the résumé, stories, question, or job
// context. Failures are ErrUnsupported. An unsupported capitalized multi-word
// name only adds an UNSUPPORTED_CLAIM warning. The returned evidence list is
// rebuilt from the verified quotes.
func DraftResponse(req protocol.DraftRequest, prof profile.Profile, resp protocol.DraftResponse) (protocol.DraftResponse, error) {
	// Round-trip through the strict parser so warnings and shapes are held to
	// the same rules as anything crossing the wire.
	raw, err := json.Marshal(resp)
	if err != nil {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if _, err := protocol.ParseDraftResponse(raw); err != nil {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if strings.TrimSpace(resp.Answer) == "" {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if len(strings.Fields(resp.Answer)) > req.Constraints.MaxWords {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if c := req.Constraints.MaxChars; c != nil && utf8.RuneCountInString(resp.Answer) > *c {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if len(resp.Evidence) > MaxEvidence {
		return protocol.DraftResponse{}, ErrOutputInvalid
	}
	if len(resp.Evidence) == 0 {
		return protocol.DraftResponse{}, ErrUnsupported
	}

	verified := make([]protocol.EvidenceQuote, 0, len(resp.Evidence))
	for _, e := range resp.Evidence {
		src, ok := sourceText(prof, e.Source)
		if !ok {
			return protocol.DraftResponse{}, ErrUnsupported
		}
		q := collapse(e.Quote)
		if n := utf8.RuneCountInString(q); n < MinQuoteChars || n > MaxQuoteChars {
			return protocol.DraftResponse{}, ErrUnsupported
		}
		if !strings.Contains(collapse(src), q) {
			return protocol.DraftResponse{}, ErrUnsupported
		}
		verified = append(verified, protocol.EvidenceQuote{Source: e.Source, Quote: q})
	}

	corpus := []string{req.Question}
	if req.JobContext != nil {
		corpus = append(corpus, *req.JobContext)
	}
	if prof.Resume != nil {
		corpus = append(corpus, prof.Resume.Text)
	}
	for _, s := range prof.Stories {
		corpus = append(corpus, s.Title, s.Text)
	}
	if !numbersSupported(resp.Answer, corpus) {
		return protocol.DraftResponse{}, ErrUnsupported
	}

	out := protocol.DraftResponse{
		Answer:   resp.Answer,
		Evidence: verified,
		Warnings: append([]protocol.DraftWarning{}, resp.Warnings...),
	}
	if names := unsupportedNames(resp.Answer, corpus); len(names) > 0 {
		out.Warnings = append(out.Warnings, protocol.DraftWarning{
			Code:     "UNSUPPORTED_CLAIM",
			Severity: "warn",
			Message:  nameWarning(names),
		})
	}
	return out, nil
}

// sourceText returns the text a quote source names. Only the résumé and a
// saved story are evidence; samples, rules, and unknown ids are not.
func sourceText(p profile.Profile, source string) (string, bool) {
	if source == "resume" {
		if p.Resume == nil {
			return "", false
		}
		return p.Resume.Text, true
	}
	if id, ok := strings.CutPrefix(source, "story:"); ok && id != "" {
		for _, s := range p.Stories {
			if s.ID == id {
				return s.Text, true
			}
		}
	}
	return "", false
}

// collapse folds every run of whitespace to one space and trims the ends.
func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

// numberPattern finds numbers, years, percentages, and amounts: optional
// currency symbol, digits with comma grouping, an optional decimal part, then
// an optional % or one-letter magnitude (10x, 5k, 2M, 1B) or ordinal suffix.
var numberPattern = regexp.MustCompile(`[$€£]?(\d+(?:,\d{3})*(?:\.\d+)?)(%|[xXkKmMbB]\b|(?:st|nd|rd|th)\b)?`)

// numberKeys returns the comparison keys of the numbers in s: the digits with
// commas removed plus a magnitude letter. Currency symbols and % are ignored
// so "$45" and "45%" both match a résumé "45", and ordinals are skipped.
func numberKeys(s string) []string {
	var keys []string
	for _, m := range numberPattern.FindAllStringSubmatch(s, -1) {
		suffix := m[2]
		switch strings.ToLower(suffix) {
		case "st", "nd", "rd", "th":
			continue
		case "%":
			suffix = ""
		}
		keys = append(keys, strings.ReplaceAll(m[1], ",", "")+strings.ToLower(suffix))
	}
	return keys
}

func numbersSupported(answer string, corpus []string) bool {
	have := map[string]bool{}
	for _, c := range corpus {
		for _, k := range numberKeys(c) {
			have[k] = true
		}
	}
	for _, k := range numberKeys(answer) {
		if !have[k] {
			return false
		}
	}
	return true
}

// namePattern finds runs of two or more capitalized words.
var namePattern = regexp.MustCompile(`\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)+`)

// unsupportedNames returns capitalized multi-word names in the answer that
// appear in none of the corpus texts. A name at the start of a sentence also
// passes when everything after its first word is supported (the first word
// may only be capitalized because it starts the sentence).
func unsupportedNames(answer string, corpus []string) []string {
	joined := collapse(strings.Join(corpus, " "))
	var out []string
	seen := map[string]bool{}
	for _, loc := range namePattern.FindAllStringIndex(answer, -1) {
		name := collapse(answer[loc[0]:loc[1]])
		if seen[name] || strings.Contains(joined, name) {
			continue
		}
		if startsSentence(answer, loc[0]) {
			if _, rest, ok := strings.Cut(name, " "); ok {
				if !strings.Contains(rest, " ") || strings.Contains(joined, rest) {
					continue
				}
			}
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func startsSentence(s string, i int) bool {
	t := strings.TrimRight(s[:i], " \t\r\n\"'(")
	return t == "" || strings.HasSuffix(t, ".") || strings.HasSuffix(t, "!") || strings.HasSuffix(t, "?") || strings.HasSuffix(t, ":")
}

func nameWarning(names []string) string {
	msg := "Check these names, which are not in your résumé, stories, question, or job context: " + strings.Join(names, ", ") + "."
	if utf8.RuneCountInString(msg) > maxNameWarningChars {
		msg = "Some names in the draft are not in your résumé, stories, question, or job context. Check them before using it."
	}
	return msg
}
