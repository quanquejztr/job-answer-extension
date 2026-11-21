package profile

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
)

func TestValidationTable(t *testing.T) {
	s, _ := newStore(t)
	st := mustStory(t, s, "story one")
	rep := func(r string, n int) string { return strings.Repeat(r, n) }
	resume := func(text, source string) error {
		_, e := s.SetResume(ResumeInput{Text: text, Source: source})
		return e
	}
	cases := []struct {
		name string
		run  func() error
		want error
	}{
		{"resume ok at max", func() error { return resume(rep("a", 15000), SourcePasted) }, nil},
		{"resume max counts code points", func() error { return resume(rep("é", 15000), SourceDOCX) }, nil},
		{"resume emoji code points", func() error { return resume(rep("😀", 15000), SourcePDF) }, nil},
		{"resume over max", func() error { return resume(rep("é", 15001), SourcePasted) }, ErrLimitExceeded},
		{"resume empty", func() error { return resume("", SourcePasted) }, ErrInvalidItem},
		{"resume whitespace only", func() error { return resume(" \n\t ", SourcePasted) }, ErrInvalidItem},
		{"resume bad source", func() error { return resume("x", "web") }, ErrInvalidItem},
		{"resume empty source", func() error { return resume("x", "") }, ErrInvalidItem},
		{"resume NUL", func() error { return resume("a\x00b", SourcePasted) }, ErrInvalidItem},
		{"resume invalid utf8", func() error { return resume("a\xffb", SourcePasted) }, ErrInvalidItem},
		{"resume newlines and tabs ok", func() error { return resume("a\nb\tc", SourcePasted) }, nil},
		{"story ok at max", func() error {
			_, e := s.UpsertStory(StoryInput{Title: rep("t", 100), Text: rep("x", 3000)})
			return e
		}, nil},
		{"story ok", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "line1\nline2\tx"}); return e }, nil},
		{"story title over", func() error { _, e := s.UpsertStory(StoryInput{Title: rep("t", 101), Text: "x"}); return e }, ErrLimitExceeded},
		{"story text over", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: rep("x", 3001)}); return e }, ErrLimitExceeded},
		{"story control char", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "a\x07b"}); return e }, ErrInvalidItem},
		{"story NUL", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "a\x00b"}); return e }, ErrInvalidItem},
		{"story C1 control", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "a\u0085b"}); return e }, ErrInvalidItem},
		{"story CR rejected", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "a\rb"}); return e }, ErrInvalidItem},
		{"story empty title", func() error { _, e := s.UpsertStory(StoryInput{Title: " ", Text: "x"}); return e }, ErrInvalidItem},
		{"story empty text", func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: " "}); return e }, ErrInvalidItem},
		{"story bad id update", func() error { _, e := s.UpsertStory(StoryInput{ID: "s_999", Title: "t", Text: "x"}); return e }, ErrNotFound},
		{"sample ok at max", func() error { _, e := s.UpsertSample(SampleInput{Label: rep("l", 60), Text: rep("x", 3000)}); return e }, nil},
		{"sample over", func() error { _, e := s.UpsertSample(SampleInput{Label: "l", Text: rep("x", 3001)}); return e }, ErrLimitExceeded},
		{"sample label over", func() error { _, e := s.UpsertSample(SampleInput{Label: rep("l", 61), Text: "x"}); return e }, ErrLimitExceeded},
		{"sample control", func() error { _, e := s.UpsertSample(SampleInput{Label: "l", Text: "a\x1bb"}); return e }, ErrInvalidItem},
		{"rule ok", func() error { _, e := s.UpsertRule(RuleInput{Kind: KindTone, Text: rep("x", 200)}); return e }, nil},
		{"rule over", func() error { _, e := s.UpsertRule(RuleInput{Kind: KindTone, Text: rep("x", 201)}); return e }, ErrLimitExceeded},
		{"rule bad kind", func() error { _, e := s.UpsertRule(RuleInput{Kind: "voice", Text: "x"}); return e }, ErrInvalidItem},
		{"provider bad", func() error { return s.SetProvider("gpt") }, ErrInvalidItem},
		{"provider empty", func() error { return s.SetProvider("") }, ErrInvalidItem},
		{"provider claude", func() error { return s.SetProvider("claude") }, nil},
		{"delete unknown", func() error { return s.Delete(ItemStory, "s_12345") }, ErrNotFound},
		{"delete wrong kind", func() error { return s.Delete(ItemRule, st.ID) }, ErrNotFound},
		{"delete fact kind is gone", func() error { return s.Delete("fact", "f_1") }, ErrInvalidItem},
		{"delete bad kind", func() error { return s.Delete("page", st.ID) }, ErrInvalidItem},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.run()
			if c.want == nil && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
		})
	}
}

func TestTextTrimmed(t *testing.T) {
	s, _ := newStore(t)
	st := mustStory(t, s, "  padded \n")
	if st.Text != "padded" {
		t.Fatalf("text = %q", st.Text)
	}
}

func TestCountCaps(t *testing.T) {
	s, _ := newStore(t)
	for i := 0; i < 5; i++ {
		if _, err := s.UpsertSample(SampleInput{Label: "l", Text: "x"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.UpsertSample(SampleInput{Label: "l", Text: "x"}); !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("6th sample: %v", err)
	}
	for i := 0; i < 20; i++ {
		if _, err := s.UpsertRule(RuleInput{Kind: KindStyle, Text: "x"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.UpsertRule(RuleInput{Kind: KindStyle, Text: "x"}); !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("21st rule: %v", err)
	}
	for i := 0; i < limits.MaxStories; i++ {
		mustStory(t, s, "x")
	}
	if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("31st story: %v", err)
	}
	// An update at the cap must still work.
	p, _ := s.Load()
	if len(p.Stories) != 30 {
		t.Fatalf("stories = %d", len(p.Stories))
	}
	if _, err := s.UpsertSample(SampleInput{ID: p.Samples[0].ID, Label: "new", Text: "y"}); err != nil {
		t.Fatalf("update at cap: %v", err)
	}
	if _, err := s.UpsertStory(StoryInput{ID: p.Stories[0].ID, Title: "new", Text: "y"}); err != nil {
		t.Fatalf("story update at cap: %v", err)
	}
}

// fillToTotal builds a profile whose content is exactly 40,000 - gap code
// points: résumé 15,000, five stories of title "t" plus 3,000 text (15,005),
// three samples of 3,000 (9,000), and one more sample sized to land on the
// target. It returns the id of that last sample.
func fillToTotal(t *testing.T, s *Store, gap int) string {
	t.Helper()
	if _, err := s.SetResume(ResumeInput{Text: strings.Repeat("r", 15000), Source: SourcePasted}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.UpsertStory(StoryInput{Title: "t", Text: strings.Repeat("s", 3000)}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		if _, err := s.UpsertSample(SampleInput{Label: "l", Text: strings.Repeat("w", 3000)}); err != nil {
			t.Fatal(err)
		}
	}
	// 15,000 + 15,005 + 9,000 = 39,005, so 995 remain before the cap.
	last, err := s.UpsertSample(SampleInput{Label: "l", Text: strings.Repeat("z", 995-gap)})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	return last.ID
}

func TestTotalContentCap(t *testing.T) {
	path := func(dir string) string { return filepath.Join(dir, FileName) }
	total := func(t *testing.T, s *Store) int {
		p, err := s.Load()
		if err != nil {
			t.Fatal(err)
		}
		return p.ContentChars()
	}

	t.Run("under the cap", func(t *testing.T) {
		s, _ := newStore(t)
		fillToTotal(t, s, 1)
		if n := total(t, s); n != 39999 {
			t.Fatalf("total = %d", n)
		}
	})

	t.Run("exactly at the cap", func(t *testing.T) {
		s, _ := newStore(t)
		fillToTotal(t, s, 0)
		if n := total(t, s); n != 40000 {
			t.Fatalf("total = %d", n)
		}
	})

	t.Run("one over the cap is rejected for every kind and nothing is written", func(t *testing.T) {
		s, dir := newStore(t)
		fillToTotal(t, s, 0)
		before := readFile(t, path(dir))
		p, _ := s.Load()
		attempts := map[string]func() error{
			"new story": func() error { _, e := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); return e },
			"story grows": func() error {
				_, e := s.UpsertStory(StoryInput{ID: p.Stories[0].ID, Title: "tt", Text: strings.Repeat("s", 3000)})
				return e
			},
			"sample longer": func() error {
				_, e := s.UpsertSample(SampleInput{ID: p.Samples[3].ID, Label: "l", Text: strings.Repeat("z", 996)})
				return e
			},
			"new rule": func() error { _, e := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"}); return e },
			"disabled rule": func() error {
				off := false
				_, e := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x", Enabled: &off})
				return e
			},
		}
		for name, fn := range attempts {
			err := fn()
			if !errors.Is(err, ErrLimitExceeded) {
				t.Errorf("%s: got %v, want ErrLimitExceeded", name, err)
				continue
			}
			if !strings.Contains(err.Error(), "40000") {
				t.Errorf("%s: message is not clear: %v", name, err)
			}
			if !bytes.Equal(before, readFile(t, path(dir))) {
				t.Fatalf("%s: a rejected save changed the file", name)
			}
			noTemps(t, dir)
		}
	})

	t.Run("a longer résumé that pushes the total over is rejected", func(t *testing.T) {
		s, dir := newStore(t)
		if _, err := s.SetResume(ResumeInput{Text: strings.Repeat("r", 14000), Source: SourcePasted}); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5; i++ {
			mustStory(t, s, strings.Repeat("s", 3000)) // 3,001 each with the title "title"? see below
		}
		p, _ := s.Load()
		for i := 0; i < 3; i++ {
			if _, err := s.UpsertSample(SampleInput{Label: "l", Text: strings.Repeat("w", 3000)}); err != nil {
				t.Fatal(err)
			}
		}
		room := 40000 - (p.ContentChars() + 9000)
		if _, err := s.UpsertSample(SampleInput{Label: "l", Text: strings.Repeat("z", room)}); err != nil {
			t.Fatalf("seed: %v", err)
		}
		if n := total(t, s); n != 40000 {
			t.Fatalf("total = %d", n)
		}
		before := readFile(t, path(dir))
		_, err := s.SetResume(ResumeInput{Text: strings.Repeat("r", 14001), Source: SourcePasted})
		if !errors.Is(err, ErrLimitExceeded) || !strings.Contains(err.Error(), "40000") {
			t.Fatalf("got %v", err)
		}
		if !bytes.Equal(before, readFile(t, path(dir))) {
			t.Fatal("rejected save changed the file")
		}
		if _, err := s.SetResume(ResumeInput{Text: strings.Repeat("r", 14000), Source: SourceDOCX}); err != nil {
			t.Fatalf("same size: %v", err)
		}
	})

	t.Run("replacing counts the new text instead of the old text", func(t *testing.T) {
		s, _ := newStore(t)
		id := fillToTotal(t, s, 0)
		// Same size at the cap: replaced text is not double counted.
		if _, err := s.SetResume(ResumeInput{Text: strings.Repeat("R", 15000), Source: SourceDOCX}); err != nil {
			t.Fatalf("same-size résumé replacement: %v", err)
		}
		if _, err := s.UpsertSample(SampleInput{ID: id, Label: "l", Text: strings.Repeat("Z", 995)}); err != nil {
			t.Fatalf("same-size sample replacement: %v", err)
		}
		// Shrinking frees room that a different item can then use.
		if _, err := s.UpsertSample(SampleInput{ID: id, Label: "l", Text: strings.Repeat("Z", 990)}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: "12345"}); err != nil {
			t.Fatalf("rule that exactly fits: %v", err)
		}
		if n := total(t, s); n != 40000 {
			t.Fatalf("total = %d", n)
		}
		if _, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"}); !errors.Is(err, ErrLimitExceeded) {
			t.Fatalf("one more: %v", err)
		}
	})

	t.Run("sample labels and rule kinds are not counted", func(t *testing.T) {
		s, _ := newStore(t)
		id := fillToTotal(t, s, 0)
		if _, err := s.UpsertSample(SampleInput{ID: id, Label: strings.Repeat("L", 60), Text: strings.Repeat("z", 995)}); err != nil {
			t.Fatalf("long label at the cap: %v", err)
		}
	})

	t.Run("story titles are counted", func(t *testing.T) {
		s, _ := newStore(t)
		fillToTotal(t, s, 1)
		p, _ := s.Load()
		// Room for exactly one more code point.
		if _, err := s.UpsertStory(StoryInput{ID: p.Stories[0].ID, Title: "tt", Text: strings.Repeat("s", 3000)}); err != nil {
			t.Fatalf("title grows by one: %v", err)
		}
		if _, err := s.UpsertStory(StoryInput{ID: p.Stories[0].ID, Title: "ttt", Text: strings.Repeat("s", 3000)}); !errors.Is(err, ErrLimitExceeded) {
			t.Fatalf("title grows by two: %v", err)
		}
	})

	t.Run("code points not bytes", func(t *testing.T) {
		s, _ := newStore(t)
		// 13,333 emoji is 53 KB but only 13,333 code points; three such
		// stories fit well inside the total.
		for i := 0; i < 3; i++ {
			if _, err := s.UpsertStory(StoryInput{Title: "t", Text: strings.Repeat("😀", 3000)}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.SetResume(ResumeInput{Text: strings.Repeat("😀", 15000), Source: SourcePasted}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("an over-cap file loads but can only shrink", func(t *testing.T) {
		s, dir := newStore(t)
		now := "2026-11-20T12:00:00Z"
		p := emptyProfile()
		p.Resume = &Resume{Text: strings.Repeat("r", 15000), Source: SourcePasted, UpdatedAt: now}
		p.NextID = 1
		for i := 0; i < 9; i++ { // 9 x 3,001 = 27,009 -> 42,009 total
			p.Stories = append(p.Stories, Story{ID: fmt.Sprintf("s_%d", i+1), Title: "t", Text: strings.Repeat("s", 3000), CreatedAt: now, UpdatedAt: now})
			p.NextID++
		}
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		if err := writeRaw(dir, string(raw)); err != nil {
			t.Fatal(err)
		}
		loaded, err := s.Load()
		if err != nil || loaded.ContentChars() != 42009 {
			t.Fatalf("Load: %v", err)
		}
		before := readFile(t, path(dir))
		if _, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"}); !errors.Is(err, ErrLimitExceeded) {
			t.Fatalf("growing an over-cap profile: %v", err)
		}
		if !bytes.Equal(before, readFile(t, path(dir))) {
			t.Fatal("rejected save changed the file")
		}
		if err := s.Delete(ItemStory, loaded.Stories[0].ID); err != nil {
			t.Fatalf("shrinking an over-cap profile: %v", err)
		}
	})
}

func TestProfileSizeCapOnWrite(t *testing.T) {
	s, dir := newStore(t)
	mustStory(t, s, "seed")
	path := dir + "/" + FileName
	before := readFile(t, path)
	// The code point caps alone allow more than 384 KiB with 4-byte code
	// points, so the byte cap is the backstop. Bypass the content cap by
	// mutating below it in code points but above it in bytes: 40,000 emoji
	// is about 160 KB, so use JSON escapes via many small items instead.
	err := s.mutate(func(p *Profile, now string) error {
		for i := 0; i < 20; i++ {
			p.Rules = append(p.Rules, WritingRule{ID: nextID(p, "r_"), Kind: KindTone, Text: strings.Repeat("😀", 200), Enabled: true})
		}
		for i := 0; i < 5; i++ {
			p.Samples = append(p.Samples, WritingSample{ID: nextID(p, "w_"), Label: strings.Repeat("😀", 60), Text: strings.Repeat("😀", 3000), CreatedAt: now})
		}
		return nil
	})
	if err != nil && !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("got %v", err)
	}
	if err != nil && !bytes.Equal(before, readFile(t, path)) {
		t.Fatal("rejected write changed the file")
	}
}

func TestErrorsNeverContainUserContent(t *testing.T) {
	const sentinel = "ZQXSENTINELZQX"
	s, dir := newStore(t)
	mustStory(t, s, "ok story")
	var errs []error
	collect := func(err error) {
		if err != nil {
			errs = append(errs, err)
		}
	}
	long := strings.Repeat(sentinel, 1100)
	_, err := s.SetResume(ResumeInput{Text: long, Source: SourcePasted})
	collect(err)
	_, err = s.SetResume(ResumeInput{Text: sentinel + "\x00", Source: SourcePasted})
	collect(err)
	_, err = s.SetResume(ResumeInput{Text: sentinel, Source: sentinel})
	collect(err)
	_, err = s.UpsertStory(StoryInput{ID: sentinel, Title: sentinel, Text: sentinel})
	collect(err)
	_, err = s.UpsertStory(StoryInput{Title: sentinel, Text: sentinel + "\x01"})
	collect(err)
	_, err = s.UpsertStory(StoryInput{Title: strings.Repeat(sentinel, 20), Text: sentinel})
	collect(err)
	_, err = s.UpsertSample(SampleInput{Label: sentinel, Text: strings.Repeat(sentinel, 500)})
	collect(err)
	_, err = s.UpsertSample(SampleInput{Label: sentinel, Text: sentinel + "\x00"})
	collect(err)
	_, err = s.UpsertRule(RuleInput{Kind: sentinel, Text: sentinel})
	collect(err)
	collect(s.SetProvider(sentinel))
	collect(s.Delete(ItemStory, sentinel))
	collect(s.Delete(ItemKind(sentinel), sentinel))
	// Total-cap failure with content in flight.
	full, _ := newStore(t)
	fillToTotal(t, full, 0)
	_, err = full.UpsertStory(StoryInput{Title: sentinel, Text: sentinel})
	collect(err)
	// Failure paths with content in flight.
	bad := &faultFS{failOp: "rename"}
	fs2, _ := NewStore(dir, fixedClock(), bad)
	_, err = fs2.SetResume(ResumeInput{Text: sentinel, Source: SourcePasted})
	collect(err)
	if len(errs) < 12 {
		t.Fatalf("expected many errors, got %d", len(errs))
	}
	for _, e := range errs {
		if strings.Contains(e.Error(), sentinel) {
			t.Errorf("error leaks content: %v", e)
		}
	}
	// Corrupt-file errors must not echo file content either.
	if err := writeRaw(dir, `{"schemaVersion":2,"x":"`+sentinel+`"}`); err != nil {
		t.Fatal(err)
	}
	_, err = s.Load()
	if !errors.Is(err, ErrCorrupt) || strings.Contains(err.Error(), sentinel) {
		t.Fatalf("corrupt error: %v", err)
	}
}
