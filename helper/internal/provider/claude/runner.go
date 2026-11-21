package claude

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"jobanswer/helper/internal/provider"
)

// Executable is the command name looked up.
const Executable = "claude"

// DefaultMaxStdout is the most output a run keeps (PRD 15.1: 64 KiB). More is
// discarded and reported as Result.Truncated.
const DefaultMaxStdout = 64 * 1024

// Command is one process invocation: no shell, explicit arguments, stdin bytes.
type Command struct {
	Path  string
	Args  []string
	Stdin []byte
}

// Result is what a finished process left: bounded stdout and the exit code.
// stderr is never captured, so provider text cannot reach logs or errors.
type Result struct {
	Stdout    []byte
	ExitCode  int
	Truncated bool
}

// Runner starts one process. Production uses ExecRunner; tests may substitute
// any implementation, or run ExecRunner against a fake executable.
//
// Contract: a process that ran and exited (any code) returns a Result and a
// nil error; a context that ended first returns the context's error; any other
// failure to start returns an error wrapping ErrStart.
type Runner interface {
	Run(ctx context.Context, c Command) (Result, error)
}

// ErrStart means the process could not be started or waited on.
var ErrStart = errors.New("provider process could not start")

// ExecRunner runs commands with os/exec in a fresh private empty directory,
// with exactly the environment in Env (nothing is inherited), stdin always
// supplied, and stdout bounded.
type ExecRunner struct {
	Env       []string
	MaxStdout int // zero means DefaultMaxStdout
}

// boundedBuffer keeps at most max bytes and keeps accepting writes after that
// so the process never blocks on a full pipe.
type boundedBuffer struct {
	buf       bytes.Buffer
	max       int
	truncated bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	room := b.max - b.buf.Len()
	if room > 0 {
		n := min(room, len(p))
		b.buf.Write(p[:n])
	}
	if len(p) > room {
		b.truncated = true
	}
	return len(p), nil
}

// Run implements Runner.
func (r ExecRunner) Run(ctx context.Context, c Command) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	dir, err := os.MkdirTemp("", "jobanswer-provider-")
	if err != nil {
		return Result{}, fmt.Errorf("make working dir: %w", ErrStart)
	}
	defer os.RemoveAll(dir)

	limit := r.MaxStdout
	if limit <= 0 {
		limit = DefaultMaxStdout
	}
	out := &boundedBuffer{max: limit}
	cmd := exec.CommandContext(ctx, c.Path, c.Args...)
	cmd.Dir = dir
	cmd.Env = append([]string{}, r.Env...)
	cmd.Stdin = bytes.NewReader(c.Stdin)
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 2 * time.Second

	err = cmd.Run()
	if cerr := ctx.Err(); cerr != nil {
		return Result{}, cerr
	}
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return Result{Stdout: out.buf.Bytes(), Truncated: out.truncated}, nil
	case errors.As(err, &exitErr):
		return Result{Stdout: out.buf.Bytes(), ExitCode: exitErr.ExitCode(), Truncated: out.truncated}, nil
	default:
		return Result{}, fmt.Errorf("run: %w", ErrStart)
	}
}

// extraDirs are searched after PATH. Chrome starts native hosts with a minimal
// PATH, which would otherwise hide a normal install.
func extraDirs(home string) []string {
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin"}
	if filepath.IsAbs(home) {
		dirs = append(dirs, filepath.Join(home, ".local", "bin"), filepath.Join(home, ".npm-global", "bin"))
	}
	return dirs
}

// SearchPath returns the directories used to find the executable: the
// absolute entries of pathEnv, then the usual install locations.
func SearchPath(home, pathEnv string) []string {
	var dirs []string
	seen := map[string]bool{}
	add := func(d string) {
		if filepath.IsAbs(d) && !seen[d] {
			seen[d] = true
			dirs = append(dirs, d)
		}
	}
	for _, d := range filepath.SplitList(pathEnv) {
		add(d)
	}
	for _, d := range extraDirs(home) {
		add(d)
	}
	return dirs
}

// Locate finds the executable in dirs (exec.LookPath on each full path: no
// shell, no relative entries). It reads no file contents.
func Locate(dirs []string) (string, error) {
	for _, d := range dirs {
		if p, err := exec.LookPath(filepath.Join(d, Executable)); err == nil {
			return p, nil
		}
	}
	return "", provider.ErrNotFound
}

// ChildEnv is the whole environment the CLI gets: HOME, PATH, and USER only
// (confirmed sufficient in ADR 0002; USER is needed for the sign-in lookup).
func ChildEnv(home, path, user string) []string {
	return []string{"HOME=" + home, "PATH=" + path, "USER=" + user}
}
