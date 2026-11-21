package profile

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"jobanswer/helper/internal/limits"
)

// Errors are built from fixed reason strings only; never pass user content.
func invalid(reason string) error { return fmt.Errorf("%w: %s", ErrInvalidItem, reason) }
func exceeded(what string) error  { return fmt.Errorf("%w: %s", ErrLimitExceeded, what) }

// cleanText trims, requires non-empty valid UTF-8 without control characters
// other than newline and tab, and enforces a length in Unicode code points.
func cleanText(s string, max int, field string) (string, error) {
	if !utf8.ValidString(s) {
		return "", invalid(field + " is not valid UTF-8")
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return "", invalid(field + " is empty")
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return "", invalid(field + " has a control character")
		}
	}
	if utf8.RuneCountInString(s) > max {
		return "", exceeded(field + " is too long")
	}
	return s, nil
}

func parseID(id, prefix string) (int, bool) {
	rest, ok := strings.CutPrefix(id, prefix)
	if !ok || rest == "" || rest[0] == '0' || len(rest) > 9 {
		return 0, false
	}
	for _, c := range rest {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(rest)
	return n, err == nil && n > 0
}

func validProvider(p string) bool { return p == ProviderClaude || p == ProviderCodex }

func validSource(s string) bool {
	return s == SourcePasted || s == SourcePDF || s == SourceDOCX
}

func cleanResume(in ResumeInput) (text, source string, err error) {
	if !validSource(in.Source) {
		return "", "", invalid("resume source")
	}
	if text, err = cleanText(in.Text, limits.MaxResumeChars, "resume text"); err != nil {
		return "", "", err
	}
	return text, in.Source, nil
}

func checkTotal(p *Profile) error {
	if p.ContentChars() > limits.MaxProfileTotalChars {
		return exceeded("total profile content is over the 40000 character limit")
	}
	return nil
}

// validateProfile checks structural invariants of a whole profile. Used on
// load (failures become ErrCorrupt) and before every write.
func validateProfile(p *Profile) error {
	if p.SchemaVersion != SchemaVersion {
		return ErrUnsupportedVersion
	}
	if p.NextID < 1 {
		return invalid("nextId")
	}
	if p.Settings.Provider != "" && !validProvider(p.Settings.Provider) {
		return invalid("provider")
	}
	if p.Settings.DisclosureAcceptedAt != "" {
		if _, err := time.Parse(time.RFC3339, p.Settings.DisclosureAcceptedAt); err != nil {
			return invalid("disclosure timestamp")
		}
	}
	if len(p.Stories) > limits.MaxStories ||
		len(p.Samples) > limits.MaxSamples || len(p.Rules) > limits.MaxRules {
		return exceeded("collection size")
	}
	ids := map[string]bool{}
	claim := func(id, prefix string) error {
		n, ok := parseID(id, prefix)
		if !ok || n >= p.NextID || ids[id] {
			return invalid("id")
		}
		ids[id] = true
		return nil
	}
	ts := func(s string) error {
		if _, err := time.Parse(time.RFC3339, s); err != nil {
			return invalid("timestamp")
		}
		return nil
	}
	if p.Resume != nil {
		if !validSource(p.Resume.Source) {
			return invalid("resume source")
		}
		if _, err := cleanText(p.Resume.Text, limits.MaxResumeChars, "resume text"); err != nil {
			return err
		}
		if err := ts(p.Resume.UpdatedAt); err != nil {
			return err
		}
	}
	for _, s := range p.Stories {
		if err := claim(s.ID, "s_"); err != nil {
			return err
		}
		if _, err := cleanText(s.Title, limits.MaxTitleChars, "story title"); err != nil {
			return err
		}
		if _, err := cleanText(s.Text, limits.MaxStoryChars, "story text"); err != nil {
			return err
		}
		if err := firstErr(ts(s.CreatedAt), ts(s.UpdatedAt)); err != nil {
			return err
		}
	}
	for _, w := range p.Samples {
		if err := claim(w.ID, "w_"); err != nil {
			return err
		}
		if _, err := cleanText(w.Label, limits.MaxLabelChars, "sample label"); err != nil {
			return err
		}
		if _, err := cleanText(w.Text, limits.MaxSampleChars, "sample text"); err != nil {
			return err
		}
		if err := ts(w.CreatedAt); err != nil {
			return err
		}
	}
	for _, r := range p.Rules {
		if err := claim(r.ID, "r_"); err != nil {
			return err
		}
		if !validRuleKind(r.Kind) {
			return invalid("rule kind")
		}
		if _, err := cleanText(r.Text, limits.MaxRuleChars, "rule text"); err != nil {
			return err
		}
	}
	return nil
}

func validRuleKind(k string) bool {
	return k == KindLength || k == KindTone || k == KindStyle || k == KindAvoid
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
