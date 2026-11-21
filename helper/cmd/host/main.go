// Command host is the native-messaging host Chrome starts. It stays thin:
// behavior lives in internal/host.
package main

import (
	"context"
	"io"
	"os"
	"os/user"

	"jobanswer/helper/internal/host"
	"jobanswer/helper/internal/identity"
	"jobanswer/helper/internal/provider/claude"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, in io.Reader, out, errw io.Writer) int {
	log := host.NewLogger(errw)
	// Chrome passes the caller origin as the first argument. Check it before
	// reading anything from stdin.
	if err := host.CheckCaller(args, identity.Origin()); err != nil {
		log.Event(host.EventCallerRejected)
		return 2
	}
	// An unresolvable home makes profile requests answer STORAGE_ERROR.
	home, _ := os.UserHomeDir()
	// Drafting and diagnostics use the real Claude Code CLI when the owner
	// chose Claude in settings (Codex is not supported yet: its adapter is a
	// stub). The executable is found only through PATH and the usual install
	// directories; there is no override variable.
	user := userName()
	err := host.Run(context.Background(), in, out, host.Config{
		Provider:  claude.NewProvider(home, os.Getenv("PATH"), user),
		Diagnoser: claude.New(home, os.Getenv("PATH"), user),
		Log:       log,
		Home:      home,
	})
	if err != nil {
		return 1
	}
	return 0
}

// userName returns USER, which the Claude CLI needs for its sign-in lookup.
func userName() string {
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return ""
}
