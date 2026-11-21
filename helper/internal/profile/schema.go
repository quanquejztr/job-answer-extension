// Package profile holds the profile schema (PRD 16.1) and the atomic local
// store. It does no logging; errors carry fixed messages only.
package profile

import "unicode/utf8"

// SchemaVersion is the only supported profile schema version.
const SchemaVersion = 2

const (
	FileName     = "profile.json"
	LockFileName = ".profile.lock"
	tempPrefix   = ".profile.json.tmp-"
)

// Résumé sources.
const (
	SourcePasted = "pasted"
	SourcePDF    = "pdf"
	SourceDOCX   = "docx"
)

// Rule kinds.
const (
	KindLength = "length"
	KindTone   = "tone"
	KindStyle  = "style"
	KindAvoid  = "avoid"
)

// Providers.
const (
	ProviderClaude = "claude"
	ProviderCodex  = "codex"
)

// ItemKind selects a collection for Delete.
type ItemKind string

const (
	ItemStory  ItemKind = "story"
	ItemSample ItemKind = "sample"
	ItemRule   ItemKind = "rule"
)

type Settings struct {
	Provider             string `json:"provider,omitempty"`
	DisclosureAcceptedAt string `json:"disclosureAcceptedAt,omitempty"`
}

// Resume is the single saved résumé text (no ID).
type Resume struct {
	Text      string `json:"text"`
	Source    string `json:"source"`
	UpdatedAt string `json:"updatedAt"`
}

type Story struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type WritingSample struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
}

type WritingRule struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Text    string `json:"text"`
	Enabled bool   `json:"enabled"`
}

type Profile struct {
	SchemaVersion int             `json:"schemaVersion"`
	NextID        int             `json:"nextId"`
	Settings      Settings        `json:"settings"`
	Resume        *Resume         `json:"resume"`
	Stories       []Story         `json:"stories"`
	Samples       []WritingSample `json:"samples"`
	Rules         []WritingRule   `json:"rules"`
}

// Inputs for Upsert*. An empty ID creates; a nonempty ID updates.
type StoryInput struct {
	ID    string
	Title string
	Text  string
}

// ResumeInput is the reviewed résumé text and where it came from.
type ResumeInput struct {
	Text   string
	Source string
}

type SampleInput struct {
	ID    string
	Label string
	Text  string
}

// RuleInput.Enabled nil means true on create and unchanged on update.
type RuleInput struct {
	ID      string
	Kind    string
	Text    string
	Enabled *bool
}

func emptyProfile() *Profile {
	p := &Profile{SchemaVersion: SchemaVersion, NextID: 1}
	p.normalizeNil()
	return p
}

func (p *Profile) normalizeNil() {
	if p.Stories == nil {
		p.Stories = []Story{}
	}
	if p.Samples == nil {
		p.Samples = []WritingSample{}
	}
	if p.Rules == nil {
		p.Rules = []WritingRule{}
	}
}

func (p *Profile) clone() *Profile {
	c := *p
	if p.Resume != nil {
		r := *p.Resume
		c.Resume = &r
	}
	c.Stories = append([]Story{}, p.Stories...)
	c.Samples = append([]WritingSample{}, p.Samples...)
	c.Rules = append([]WritingRule{}, p.Rules...)
	return &c
}

// ContentChars returns the profile content size in code points: résumé text,
// story titles and texts, sample texts, and rule texts (sample labels are not
// counted). Every rule counts, enabled or not, because the cap bounds what may
// be stored.
func (p *Profile) ContentChars() int {
	n := 0
	if p.Resume != nil {
		n += utf8.RuneCountInString(p.Resume.Text)
	}
	for _, s := range p.Stories {
		n += utf8.RuneCountInString(s.Title) + utf8.RuneCountInString(s.Text)
	}
	for _, w := range p.Samples {
		n += utf8.RuneCountInString(w.Text)
	}
	for _, r := range p.Rules {
		n += utf8.RuneCountInString(r.Text)
	}
	return n
}
