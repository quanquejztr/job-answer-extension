// Command fakeclaude is a stand-in for the claude CLI used only by tests of
// the host (Go tests and the browser tests). Unlike the one in the claude
// package it understands the real prompt: it reads the résumé and first story
// out of the stdin prompt and builds a draft that the host's validator accepts,
// or one of several deliberately bad outputs.
//
// The mode comes from FAKE_CLAUDE_MODE, or, when that is unset (the production
// runner passes only HOME, PATH, and USER), from the first line of the file
// $HOME/fake-claude-mode, default "ok". Each run appends one word ("auth",
// "draft") to $HOME/fake-claude-calls.log so a test can prove this fake and
// nothing else ran, and the pid of a hanging run goes to $HOME/fake-claude-pid.
// It logs and records no prompt, question, or profile content. It reads no real
// configuration and makes no network call.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const snippetChars = 120

func main() {
	mode := modeName()
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "auth" {
		note("auth")
		if mode == "not-authenticated" {
			fmt.Println(`{"loggedIn":false}`)
			os.Exit(1)
		}
		fmt.Println(`{"loggedIn":true,"authMethod":"claude.ai"}`)
		return
	}
	note("draft")
	in, _ := io.ReadAll(os.Stdin)
	prompt := string(in)
	switch mode {
	case "not-authenticated":
		fmt.Println(`{"is_error":true,"result":"Not logged in · Please run /login","terminal_reason":"api_error"}`)
		os.Exit(1)
	case "usage-limit":
		fmt.Println(`{"is_error":true,"result":"Claude usage limit reached.","terminal_reason":"api_error"}`)
		os.Exit(1)
	case "other-error":
		fmt.Println(`{"is_error":true,"result":"SECRET-PROVIDER-TEXT something else"}`)
		os.Exit(1)
	case "malformed":
		fmt.Println("this is not json SECRET-PROVIDER-TEXT")
	case "no-structured":
		fmt.Println(`{"is_error":false,"result":"text only"}`)
	case "extra-key":
		emit(map[string]any{"answer": "a", "evidence": []any{}, "warnings": []any{}, "extra": 1})
	case "bad-warning-code":
		emit(map[string]any{"answer": "a", "evidence": []any{}, "warnings": []any{map[string]any{"code": "OTHER", "severity": "info", "message": "m"}}})
	case "big":
		fmt.Print(strings.Repeat("a", 600*1024))
	case "hang":
		if home := os.Getenv("HOME"); home != "" {
			_ = os.WriteFile(filepath.Join(home, "fake-claude-pid"), []byte(strconv.Itoa(os.Getpid())), 0o600)
		}
		time.Sleep(2 * time.Minute)
	case "refusal":
		emit(map[string]any{"answer": "", "evidence": []any{}, "warnings": []any{
			map[string]any{"code": "MODEL_NOTE", "severity": "warn", "message": "I cannot answer this from the profile."}}})
	default:
		answerFor(mode, prompt)
	}
}

func modeName() string {
	if m := os.Getenv("FAKE_CLAUDE_MODE"); m != "" {
		return m
	}
	home := os.Getenv("HOME")
	if home == "" {
		return "ok"
	}
	b, err := os.ReadFile(filepath.Join(home, "fake-claude-mode"))
	if err != nil {
		return "ok"
	}
	if m := strings.TrimSpace(string(b)); m != "" {
		return m
	}
	return "ok"
}

func note(word string) {
	home := os.Getenv("HOME")
	if home == "" {
		return
	}
	f, err := os.OpenFile(filepath.Join(home, "fake-claude-calls.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(word + "\n")
}

// emit prints a successful `claude -p --output-format json` result.
func emit(structured any) {
	out := map[string]any{"is_error": false, "result": "{}", "structured_output": structured}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		os.Exit(3)
	}
}

var begin = regexp.MustCompile(`^\[\[([0-9a-f]+) BEGIN (.+)\]\]$`)

// blocks returns the prompt's bounded blocks by name, in order.
func blocks(prompt string) (names []string, bodies map[string]string) {
	bodies = map[string]string{}
	var cur, token string
	var lines []string
	for _, line := range strings.Split(prompt, "\n") {
		if cur == "" {
			if m := begin.FindStringSubmatch(line); m != nil {
				token, cur, lines = m[1], m[2], nil
			}
			continue
		}
		if line == "[["+token+" END "+cur+"]]" {
			names = append(names, cur)
			bodies[cur] = strings.Join(lines, "\n")
			cur = ""
			continue
		}
		lines = append(lines, line)
	}
	return names, bodies
}

func snippetOf(text string) string {
	ws := strings.Fields(text)
	var b strings.Builder
	n := 0
	for _, w := range ws {
		add := utf8.RuneCountInString(w)
		if n > 0 {
			add++
		}
		if n+add > snippetChars {
			break
		}
		if n > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(w)
		n += add
	}
	if n == 0 && len(ws) > 0 {
		return string([]rune(ws[0])[:snippetChars])
	}
	return b.String()
}

func answerFor(mode, prompt string) {
	names, bodies := blocks(prompt)
	resume := ""
	story, storyID := "", ""
	for _, n := range names {
		switch {
		case strings.HasPrefix(n, "resume "):
			resume = bodies[n]
		case strings.HasPrefix(n, "story:") && story == "":
			storyID = strings.TrimPrefix(strings.SplitN(n, " ", 2)[0], "story:")
			// The body is "Title: <title>\n<text>".
			if _, text, ok := strings.Cut(bodies[n], "\n"); ok {
				story = text
			}
		}
	}
	snippet := snippetOf(resume)
	if ws := strings.Fields(snippet); len(ws) > 0 {
		last := ws[len(ws)-1]
		if !strings.HasSuffix(last, ".") && !strings.HasSuffix(last, "!") && !strings.HasSuffix(last, "?") {
			ws[len(ws)-1] = last + "."
		}
		snippet = strings.Join(ws, " ")
	}
	answer := "Deterministic sample draft based on your saved resume: " + snippet +
		" Please review and rewrite this sample wording in your own words before using it."
	evidence := []map[string]string{{"source": "resume", "quote": snippetOf(resume)}}
	if q := snippetOf(story); utf8.RuneCountInString(q) >= 12 {
		evidence = append(evidence, map[string]string{"source": "story:" + storyID, "quote": q})
	}
	warnings := []map[string]string{}
	switch mode {
	case "ok":
	case "ok-warnings":
		answer += " I once visited the Zorblax Industries fair."
		warnings = append(warnings, map[string]string{"code": "MODEL_NOTE", "severity": "info", "message": "Check every detail yourself."})
	case "bad-quote":
		evidence = []map[string]string{{"source": "resume", "quote": "A sentence the resume never contained."}}
	case "bad-source":
		evidence = []map[string]string{{"source": "story:s_999", "quote": snippetOf(resume)}}
	case "no-evidence":
		evidence = []map[string]string{}
	case "bad-number":
		answer += " It grew revenue by 87%."
	case "empty-answer":
		answer = "  "
	case "over-limit":
		answer += strings.Repeat(" word", 500)
	default:
		os.Exit(99)
	}
	emit(map[string]any{"answer": answer, "evidence": evidence, "warnings": warnings})
}
