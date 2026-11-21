package claude

import (
	"context"
	"errors"
	"strings"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/prompt"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
)

// DraftTimeout bounds one `claude -p` run (PRD 15.1: 90 seconds).
const DraftTimeout = time.Duration(limits.ProviderTimeoutSeconds) * time.Second

// printArgs are the confirmed invocation flags (ADR 0002). The prompt goes on
// stdin; the schema is the only variable argument and is a fixed constant.
// There is no --bare and no permission-bypass flag.
func printArgs() []string {
	return []string{
		"-p", "--safe-mode", "--tools", "", "--no-session-persistence",
		"--disable-slash-commands", "--output-format", "json",
		"--json-schema", prompt.Schema,
	}
}

// Provider drafts through the Claude Code CLI. Locate and Runner are injected
// so tests use fake executables. It implements provider.Provider.
type Provider struct {
	Locate  func() (string, error)
	Runner  Runner
	Timeout time.Duration // zero means DraftTimeout
	Prompt  prompt.Builder
}

var _ provider.Provider = Provider{}

// NewProvider builds the production Provider from process environment values
// the caller passes (main reads them; this package does not). The runner keeps
// at most the 512 KiB response cap of stdout.
func NewProvider(home, pathEnv, user string) Provider {
	dirs := SearchPath(home, pathEnv)
	return Provider{
		Locate: func() (string, error) { return Locate(dirs) },
		Runner: ExecRunner{
			Env:       ChildEnv(home, strings.Join(dirs, ":"), user),
			MaxStdout: limits.MaxNativeResponseBytes,
		},
	}
}

// Draft implements provider.Provider. Errors are typed provider errors only;
// they never carry prompt, profile, answer, or provider text.
func (p Provider) Draft(ctx context.Context, in provider.Input) (protocol.DraftResponse, error) {
	text, err := p.Prompt.Build(in.Request, in.Profile)
	if err != nil {
		return protocol.DraftResponse{}, provider.ErrInvalidInput
	}
	if len(text) > limits.MaxNativeRequestBytes {
		return protocol.DraftResponse{}, provider.ErrInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return protocol.DraftResponse{}, classifyRun(err)
	}
	path, err := p.Locate()
	if err != nil {
		if errors.Is(err, provider.ErrNotFound) {
			return protocol.DraftResponse{}, provider.ErrNotFound
		}
		return protocol.DraftResponse{}, provider.ErrOutputInvalid
	}

	timeout := p.Timeout
	if timeout <= 0 {
		timeout = DraftTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, runErr := p.Runner.Run(runCtx, Command{Path: path, Args: printArgs(), Stdin: []byte(text)})
	if len(res.Stdout) > limits.MaxNativeResponseBytes {
		res.Truncated = true
	}
	structured, err := ClassifyPrint(res, runErr)
	if err != nil {
		return protocol.DraftResponse{}, err
	}
	out, err := protocol.ParseDraftResponse(structured)
	if err != nil {
		return protocol.DraftResponse{}, provider.ErrOutputInvalid
	}
	return out, nil
}
