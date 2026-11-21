// Command fakeclaude is a stand-in for the claude CLI used only by tests. The
// behavior comes from FAKE_CLAUDE_MODE. It reads no real configuration.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"
)

func main() {
	mode := os.Getenv("FAKE_CLAUDE_MODE")
	args := os.Args[1:]
	switch mode {
	case "hang":
		time.Sleep(time.Minute)
	case "probe":
		in, _ := io.ReadAll(os.Stdin)
		entries, _ := os.ReadDir(".")
		var env []string
		for _, kv := range os.Environ() {
			env = append(env, strings.SplitN(kv, "=", 2)[0])
		}
		sort.Strings(env)
		wd, _ := os.Getwd()
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"args": args, "env": env, "stdinLen": len(in), "dirEntries": len(entries), "wd": wd,
		})
	case "big":
		fmt.Print(strings.Repeat("a", 200000))
	case "exit2":
		fmt.Fprintln(os.Stderr, "SECRET-STDERR")
		os.Exit(2)
	case "garbage":
		fmt.Println("oops")
	case "signedin":
		fmt.Println(`{"loggedIn":true,"authMethod":"claude.ai"}`)
	case "signedin-exit1":
		fmt.Println(`{"loggedIn":true}`)
		os.Exit(1)
	case "signedout":
		fmt.Println(`{"loggedIn":false}`)
		os.Exit(1)
	case "noflag":
		fmt.Println(`{"authMethod":"none"}`)
	case "draft-ok", "draft-record", "hang-record":
		in, _ := io.ReadAll(os.Stdin)
		if path := os.Getenv("FAKE_CLAUDE_RECORD"); path != "" {
			var env []string
			for _, kv := range os.Environ() {
				env = append(env, strings.SplitN(kv, "=", 2)[0])
			}
			sort.Strings(env)
			wd, _ := os.Getwd()
			entries, _ := os.ReadDir(".")
			rec, _ := json.Marshal(map[string]any{
				"args": args, "env": env, "stdin": string(in), "wd": wd,
				"dirEntries": len(entries), "pid": os.Getpid(),
				"home": os.Getenv("HOME"),
			})
			_ = os.WriteFile(path, rec, 0o600)
		}
		if mode == "hang-record" {
			time.Sleep(time.Minute)
		}
		fmt.Println(`{"is_error":false,"result":"{}","structured_output":{"answer":"I built a budgeting tool.","evidence":[{"source":"resume","quote":"Built a budgeting tool in Go."}],"warnings":[{"code":"MODEL_NOTE","severity":"info","message":"check dates"}]}}`)
	case "draft-structured-string":
		fmt.Println(`{"is_error":false,"result":"x","structured_output":"not an object"}`)
	case "draft-extra-key":
		fmt.Println(`{"is_error":false,"structured_output":{"answer":"a","evidence":[],"warnings":[],"extra":1}}`)
	case "draft-bad-warning":
		fmt.Println(`{"is_error":false,"structured_output":{"answer":"a","evidence":[],"warnings":[{"code":"OTHER","severity":"info","message":"m"}]}}`)
	case "draft-empty-answer":
		fmt.Println(`{"is_error":false,"structured_output":{"answer":"","evidence":[],"warnings":[]}}`)
	case "huge":
		fmt.Print(strings.Repeat("a", 600*1024))
	case "print-ok":
		fmt.Println(`{"is_error":false,"result":"{}","structured_output":{"answer":"x"}}`)
	case "print-notloggedin":
		fmt.Println(`{"is_error":true,"result":"Not logged in · Please run /login","terminal_reason":"api_error"}`)
		os.Exit(1)
	case "print-usagelimit":
		fmt.Println(`{"is_error":true,"result":"Claude usage limit reached.","terminal_reason":"api_error"}`)
		os.Exit(1)
	case "print-other-error":
		fmt.Println(`{"is_error":true,"result":"SECRET-PROVIDER-TEXT something else"}`)
		os.Exit(1)
	case "print-nostructured":
		fmt.Println(`{"is_error":false,"result":"text only"}`)
	default:
		os.Exit(99)
	}
}
