// Package claude holds the Claude Code adapter's process handling and error
// classification. It never reads credentials, never starts a login, and never
// writes to a field or controls Chrome.
package claude

import (
	"context"
	"time"

	"jobanswer/helper/internal/provider"
)

// DiagnoseTimeout bounds the sign-in check.
const DiagnoseTimeout = 15 * time.Second

// Diagnoser checks the Claude Code CLI. Locate and Runner are injected so
// tests use fake executables.
type Diagnoser struct {
	Locate  func() (string, error)
	Runner  Runner
	Timeout time.Duration // zero means DiagnoseTimeout
}

// New builds the production Diagnoser from the process environment values the
// caller passes (main reads them; this package does not).
func New(home, pathEnv, user string) Diagnoser {
	dirs := SearchPath(home, pathEnv)
	childPath := ""
	for i, d := range dirs {
		if i > 0 {
			childPath += ":"
		}
		childPath += d
	}
	return Diagnoser{
		Locate: func() (string, error) { return Locate(dirs) },
		Runner: ExecRunner{Env: ChildEnv(home, childPath, user), MaxStdout: 4 * 1024},
	}
}

// Diagnose reports the executable check, then (only if the executable exists)
// the sign-in check from `claude auth status`.
func (d Diagnoser) Diagnose(ctx context.Context) []provider.Check {
	path, err := d.Locate()
	exec := provider.CheckFor(provider.CheckProviderExecutable, err)
	if err != nil {
		return []provider.Check{exec}
	}
	timeout := d.Timeout
	if timeout <= 0 {
		timeout = DiagnoseTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, runErr := d.Runner.Run(ctx, Command{Path: path, Args: []string{"auth", "status"}})
	return []provider.Check{exec, provider.CheckFor(provider.CheckProviderSignIn, ClassifyAuthStatus(res, runErr))}
}
