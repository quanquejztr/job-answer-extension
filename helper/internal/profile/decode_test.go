package profile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
)

func writeRaw(dir, content string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, FileName), []byte(content), 0o600)
}

const goodEmpty = `{"schemaVersion":2,"nextId":1,"settings":{},"resume":null,"stories":[],"samples":[],"rules":[]}`

// v1Profile is a valid schemaVersion 1 (facts) file from Slices 2.1 to 2.4.
const v1Profile = `{"schemaVersion":1,"nextId":3,"settings":{},` +
	`"facts":[{"id":"f_1","text":"a","source":"user","verified":true,"tags":["x"],"createdAt":"2026-11-20T12:00:00Z","updatedAt":"2026-11-20T12:00:00Z"}],` +
	`"stories":[{"id":"s_2","title":"t","text":"b","tags":[],"factIds":["f_1"],"createdAt":"2026-11-20T12:00:00Z","updatedAt":"2026-11-20T12:00:00Z"}],` +
	`"samples":[],"rules":[]}`

func TestDecodeTable(t *testing.T) {
	good := `{"schemaVersion":2,"nextId":4,"settings":{"provider":"codex","disclosureAcceptedAt":"2026-11-20T12:00:00Z"},` +
		`"resume":{"text":"my resume","source":"docx","updatedAt":"2026-11-20T12:00:00Z"},` +
		`"stories":[{"id":"s_2","title":"t","text":"b","createdAt":"2026-11-20T12:00:00Z","updatedAt":"2026-11-20T12:00:00Z"}],` +
		`"samples":[{"id":"w_1","label":"l","text":"x","createdAt":"2026-11-20T12:00:00Z"}],` +
		`"rules":[{"id":"r_3","kind":"tone","text":"plain","enabled":true}]}`
	cases := []struct {
		name string
		in   string
		want error
	}{
		{"empty ok", goodEmpty, nil},
		{"populated ok", good, nil},
		{"version 1 rejected", v1Profile, ErrUnsupportedVersion},
		{"version 1 empty rejected", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":1`, 1), ErrUnsupportedVersion},
		{"version 0", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":0`, 1), ErrUnsupportedVersion},
		{"version 3", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":3`, 1), ErrUnsupportedVersion},
		{"version missing", `{"nextId":1,"settings":{},"resume":null,"stories":[],"samples":[],"rules":[]}`, ErrUnsupportedVersion},
		{"version string", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":"2"`, 1), ErrUnsupportedVersion},
		{"version float", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":2.0`, 1), ErrUnsupportedVersion},
		{"version null", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":null`, 1), ErrUnsupportedVersion},
		{"version negative", strings.Replace(goodEmpty, `"schemaVersion":2`, `"schemaVersion":-1`, 1), ErrUnsupportedVersion},
		{"unknown top field", strings.Replace(goodEmpty, `"rules":[]`, `"rules":[],"extra":1`, 1), ErrCorrupt},
		{"facts field is unknown in v2", strings.Replace(goodEmpty, `"rules":[]`, `"rules":[],"facts":[]`, 1), ErrCorrupt},
		{"unknown nested field", strings.Replace(good, `"source":"docx"`, `"source":"docx","x":1`, 1), ErrCorrupt},
		{"story with factIds", strings.Replace(good, `"title":"t"`, `"title":"t","factIds":[]`, 1), ErrCorrupt},
		{"story with tags", strings.Replace(good, `"title":"t"`, `"title":"t","tags":[]`, 1), ErrCorrupt},
		{"trailing data", goodEmpty + `{}`, ErrCorrupt},
		{"trailing garbage", goodEmpty + ` x`, ErrCorrupt},
		{"duplicate top key", `{"schemaVersion":2,"schemaVersion":2,"nextId":1,"settings":{},"resume":null,"stories":[],"samples":[],"rules":[]}`, ErrCorrupt},
		{"duplicate nested key", strings.Replace(good, `"id":"s_2"`, `"id":"s_2","id":"s_9"`, 1), ErrCorrupt},
		{"not json", `hello`, ErrCorrupt},
		{"empty file", ``, ErrCorrupt},
		{"array", `[]`, ErrCorrupt},
		{"truncated", goodEmpty[:30], ErrCorrupt},
		{"nextId too low", strings.Replace(good, `"nextId":4`, `"nextId":3`, 1), ErrCorrupt},
		{"nextId zero", strings.Replace(goodEmpty, `"nextId":1`, `"nextId":0`, 1), ErrCorrupt},
		{"duplicate id", strings.Replace(good, `"id":"w_1"`, `"id":"s_2"`, 1), ErrCorrupt},
		{"bad id format", strings.Replace(good, `"s_2"`, `"s_02"`, 1), ErrCorrupt},
		{"fact id prefix", strings.Replace(good, `"s_2"`, `"f_2"`, 1), ErrCorrupt},
		{"bad resume source", strings.Replace(good, `"source":"docx"`, `"source":"web"`, 1), ErrCorrupt},
		{"empty resume text", strings.Replace(good, `"my resume"`, `"  "`, 1), ErrCorrupt},
		{"resume without source", strings.Replace(good, `,"source":"docx"`, ``, 1), ErrCorrupt},
		{"resume bad timestamp", strings.Replace(good, `"updatedAt":"2026-11-20T12:00:00Z"},"stories"`, `"updatedAt":"x"},"stories"`, 1), ErrCorrupt},
		{"resume wrong type", strings.Replace(good, `"resume":{"text":"my resume","source":"docx","updatedAt":"2026-11-20T12:00:00Z"}`, `"resume":"text"`, 1), ErrCorrupt},
		{"bad provider", strings.Replace(good, `"codex"`, `"gpt"`, 1), ErrCorrupt},
		{"bad timestamp", strings.Replace(good, `"createdAt":"2026-11-20T12:00:00Z","updatedAt"`, `"createdAt":"yesterday","updatedAt"`, 1), ErrCorrupt},
		{"wrong type", strings.Replace(goodEmpty, `"stories":[]`, `"stories":{}`, 1), ErrCorrupt},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := decodeProfile([]byte(c.in))
			if c.want == nil {
				if err != nil || p == nil {
					t.Fatalf("err = %v", err)
				}
				if p.Stories == nil || p.Samples == nil || p.Rules == nil {
					t.Fatal("slices must be non-nil")
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
		})
	}
}

func TestMigrateOnlySupportsV2(t *testing.T) {
	for _, v := range []int{-1, 0, 1, 3, 99} {
		if _, err := migrate(v, []byte(goodEmpty)); !errors.Is(err, ErrUnsupportedVersion) {
			t.Errorf("migrate(%d) = %v", v, err)
		}
	}
	if p, err := migrate(2, []byte(goodEmpty)); err != nil || p.SchemaVersion != 2 || p.Resume != nil {
		t.Fatalf("migrate(2): %v", err)
	}
}

// A version 1 file is unsupported: Load and every mutation fail with
// ErrUnsupportedVersion and the file stays byte-identical (no migration, no
// rewrite). Delete-all still clears it.
func TestVersion1FileRejectedAndUntouched(t *testing.T) {
	s, dir := newStore(t)
	if err := writeRaw(dir, v1Profile); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, FileName)
	if _, err := s.Load(); !errors.Is(err, ErrUnsupportedVersion) {
		t.Fatalf("Load: %v", err)
	}
	if _, err := s.Export(); !errors.Is(err, ErrUnsupportedVersion) {
		t.Fatalf("Export: %v", err)
	}
	mutations := map[string]func() error{
		"resume":   func() error { _, err := s.SetResume(ResumeInput{Text: "r", Source: SourcePasted}); return err },
		"story":    func() error { _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); return err },
		"sample":   func() error { _, err := s.UpsertSample(SampleInput{Label: "l", Text: "x"}); return err },
		"rule":     func() error { _, err := s.UpsertRule(RuleInput{Kind: KindTone, Text: "x"}); return err },
		"delete":   func() error { return s.Delete(ItemStory, "s_2") },
		"provider": func() error { return s.SetProvider("claude") },
		"accept":   func() error { return s.AcceptDisclosure() },
	}
	for name, fn := range mutations {
		if err := fn(); !errors.Is(err, ErrUnsupportedVersion) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if got := string(readFile(t, path)); got != v1Profile {
		t.Fatal("version 1 file was modified")
	}
	noTemps(t, dir)
	if err := s.DeleteAll(); err != nil {
		t.Fatalf("DeleteAll: %v", err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("DeleteAll left the version 1 file")
	}
	if p, err := s.Load(); err != nil || p.SchemaVersion != 2 {
		t.Fatalf("Load after DeleteAll: %v", err)
	}
}

func TestOversizedFileRejectedBeforeParse(t *testing.T) {
	s, dir := newStore(t)
	// Valid JSON prefix padded beyond the cap: if parsed it would succeed.
	pad := strings.Repeat(" ", limits.MaxProfileBytes)
	if err := writeRaw(dir, goodEmpty+pad); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("got %v, want ErrTooLarge", err)
	}
	// Exactly at the cap is read (and parsed).
	if err := writeRaw(dir, goodEmpty+strings.Repeat(" ", limits.MaxProfileBytes-len(goodEmpty))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); err != nil {
		t.Fatalf("file at cap: %v", err)
	}
	// A mutation also refuses it.
	if err := writeRaw(dir, goodEmpty+pad); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("mutate on oversized: %v", err)
	}
}

func TestCorruptFileUntouched(t *testing.T) {
	for _, content := range []string{`{not json`, `{"schemaVersion":3}`, goodEmpty + "x"} {
		s, dir := newStore(t)
		if err := writeRaw(dir, content); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Load(); err == nil {
			t.Fatal("expected load error")
		}
		if _, err := s.UpsertStory(StoryInput{Title: "t", Text: "x"}); err == nil {
			t.Fatal("expected mutate error")
		}
		if err := s.SetProvider("claude"); err == nil {
			t.Fatal("expected mutate error")
		}
		if got := string(readFile(t, filepath.Join(dir, FileName))); got != content {
			t.Fatalf("corrupt file modified")
		}
		noTemps(t, dir)
	}
}
