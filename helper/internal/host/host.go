package host

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/validate"
)

// Version is the helper version reported by helper.hello.
const Version = "0.1.0"

// Config holds what Run needs. Provider is required.
//
// Provider and Diagnoser are the adapter used when the profile's provider
// setting is "claude" (the only adapter; Codex is an unsupported stub, so a
// "codex" setting never reaches a provider). main injects the real Claude
// adapter; tests inject the fake provider or a Claude adapter over a fake
// executable.
type Config struct {
	Provider provider.Provider
	// Diagnoser answers diagnostics.run for the Claude provider. Nil makes
	// diagnostics.run answer INTERNAL_ERROR when Claude is the chosen provider.
	Diagnoser provider.Diagnoser
	Log       *Logger
	// Home is the user's home directory (injected; main passes
	// os.UserHomeDir()). The profile lives under
	// <Home>/Library/Application Support/JobAnswerDrafter. An empty or
	// relative Home makes every profile request answer STORAGE_ERROR.
	Home string
	// ProfileTimeout bounds one profile request (and the profile load of a
	// draft request); zero means the 5 s default.
	ProfileTimeout time.Duration

	// loadProfile replaces the default Store.Load in draft.generate. Tests
	// use it to simulate a store that outlives the deadline.
	loadProfile func(*profile.Store) (any, error)
}

// ErrFraming reports a stream failure that ends the process (truncated,
// oversize, or unreadable frame). It carries no frame content.
var ErrFraming = errors.New("native message framing failure")

// ErrWrite reports that a response frame could not be written.
var ErrWrite = errors.New("write response failure")

type frame struct {
	body []byte
	err  error
}

// Run serves requests from in until a clean EOF (returns nil) or a framing or
// write failure (returns an error). Recoverable request errors get an error
// response and the loop continues.
//
// A reader goroutine keeps reading while a request is handled. When stdin
// closes (Chrome disconnected the port, which is how the extension cancels),
// the context given to handlers is cancelled so provider work can stop. The
// response is still written; if Chrome is gone the write fails and the process
// ends.
func Run(parent context.Context, in io.Reader, out io.Writer, cfg Config) error {
	log := cfg.Log
	if log == nil {
		log = NewLogger(nil)
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan struct{})
	defer close(done)

	frames := make(chan frame)
	go func() {
		defer close(frames)
		for {
			body, err := protocol.ReadMessage(in, limits.MaxNativeRequestBytes)
			if errors.Is(err, protocol.ErrEmptyMessage) {
				// Framing is intact (prefix consumed, no body): recoverable.
				select {
				case frames <- frame{err: err}:
					continue
				case <-done:
					return
				}
			}
			if err != nil {
				cancel() // stdin closed or broken: stop in-flight work
				select {
				case frames <- frame{err: err}:
				case <-done:
				}
				return
			}
			select {
			case frames <- frame{body: body}:
			case <-done:
				return
			}
		}
	}()

	log.Event(EventStart)
	defer log.Event(EventStop)
	for {
		var f frame
		select {
		case got, ok := <-frames:
			if !ok {
				return nil
			}
			f = got
		case <-parent.Done():
			return parent.Err()
		}
		switch {
		case f.err == nil:
			resp := handle(ctx, cfg, f.body, log)
			if err := writeResponse(out, resp, log); err != nil {
				return err
			}
		case errors.Is(f.err, protocol.ErrEmptyMessage):
			log.EventCode(EventRequestFailed, protocol.CodeInvalidRequest)
			resp := protocol.BuildErrorResponse("", f.err)
			if err := writeResponse(out, resp, log); err != nil {
				return err
			}
		case errors.Is(f.err, protocol.ErrEndOfStream):
			return nil
		case errors.Is(f.err, protocol.ErrMessageTooLarge):
			// The body was not consumed, so the stream cannot be resynchronized.
			// Tell the caller why (best effort), then end the process.
			log.EventCode(EventFrameFailed, protocol.CodeMessageTooLarge)
			_ = writeResponse(out, protocol.BuildErrorResponse("", f.err), log)
			return ErrFraming
		default:
			log.EventCode(EventFrameFailed, protocol.CodeInternalError)
			return ErrFraming
		}
	}
}

// writeResponse marshals and writes one frame. A response over the limit is
// replaced by INTERNAL_ERROR (PRD 17.3; MESSAGE_TOO_LARGE is for requests).
func writeResponse(out io.Writer, resp protocol.ResponseEnvelope, log *Logger) error {
	body, err := protocol.MarshalResponse(resp)
	if err != nil {
		body, err = json.Marshal(protocol.BuildCodeErrorResponse(resp.RequestID, protocol.CodeInternalError))
		if err != nil {
			return ErrWrite
		}
	}
	err = protocol.WriteMessage(out, body, limits.MaxNativeResponseBytes)
	if errors.Is(err, protocol.ErrMessageTooLarge) {
		log.EventCode(EventRequestFailed, protocol.CodeInternalError)
		small, merr := json.Marshal(protocol.BuildCodeErrorResponse(resp.RequestID, protocol.CodeInternalError))
		if merr != nil {
			return ErrWrite
		}
		err = protocol.WriteMessage(out, small, limits.MaxNativeResponseBytes)
	}
	if err != nil {
		log.Event(EventWriteFailed)
		return ErrWrite
	}
	return nil
}

// helloResult is the helper.hello result.
type helloResult struct {
	HelperVersion   string `json:"helperVersion"`
	ProtocolVersion int    `json:"protocolVersion"`
}

// cancelResult is the draft.cancel result.
type cancelResult struct {
	Cancelled bool `json:"cancelled"`
}

// handle parses and dispatches one request body into one response.
func handle(ctx context.Context, cfg Config, body []byte, log *Logger) protocol.ResponseEnvelope {
	env, err := protocol.ParseRequest(body)
	if err != nil {
		// ParseRequest sets RequestID only when it was valid; otherwise "".
		code := protocol.ToAppError(err).Code
		log.EventCode(EventRequestFailed, code)
		return protocol.BuildErrorResponse(env.RequestID, err)
	}
	switch env.Type {
	case protocol.TypeHelperHello:
		return success(env.RequestID, helloResult{HelperVersion: Version, ProtocolVersion: protocol.ProtocolVersion}, log)
	case protocol.TypeDraftGenerate:
		return generate(ctx, cfg, env, log)
	case protocol.TypeProfileGet, protocol.TypeProfileItemUpsert, protocol.TypeProfileItemDelete,
		protocol.TypeProfileResumeSet, protocol.TypeProfileExport, protocol.TypeProfileDeleteAll:
		return handleProfile(cfg, env, log)
	case protocol.TypeSettingsSetProvider, protocol.TypeSettingsAcceptDisclosure:
		return handleProfile(cfg, env, log)
	case protocol.TypeProfileImportDocument:
		return importDocument(env, log)
	case protocol.TypeDiagnosticsRun:
		return diagnose(ctx, cfg, env, log)
	case protocol.TypeDraftCancel:
		// Each request uses its own port and process, so with the fake provider
		// nothing is ever in flight to cancel. Real cancellation is closing the
		// port (stdin EOF), which cancels the context given to the provider.
		return success(env.RequestID, cancelResult{Cancelled: false}, log)
	default:
		// Unreachable: ParseRequest rejects unregistered types.
		return fail(env.RequestID, protocol.CodeInternalError, log)
	}
}

// generate runs one draft. It loads the profile from the same data directory
// as the profile handlers (same deadline, STORAGE_ERROR on store failure),
// requires a saved résumé and a profile within the content cap (both
// INVALID_REQUEST, no provider call), and hands the whole profile to the
// provider. The provider's output is validated before anything is returned.
func generate(ctx context.Context, cfg Config, env protocol.RequestEnvelope, log *Logger) protocol.ResponseEnvelope {
	req, err := protocol.ParseDraftRequest(env.Payload)
	if err != nil {
		return fail(env.RequestID, protocol.ToAppError(err).Code, log)
	}
	load := cfg.loadProfile
	if load == nil {
		load = func(s *profile.Store) (any, error) { return s.Load() }
	}
	loaded, err := withStore(cfg, load)
	if err != nil {
		if errors.Is(err, errDeadline) {
			log.Event(EventProfileTimeout)
		}
		return fail(env.RequestID, profileErrorCode(err), log)
	}
	p, ok := loaded.(*profile.Profile)
	if !ok || p == nil {
		return fail(env.RequestID, protocol.CodeInternalError, log)
	}
	if p.Resume == nil || strings.TrimSpace(p.Resume.Text) == "" {
		log.Event(EventNoResume)
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	// FR-005: no provider chosen, or the first-use disclosure not accepted,
	// means no draft and no provider call, whatever the panel showed.
	if p.Settings.Provider == "" {
		log.Event(EventNoProvider)
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	if p.Settings.DisclosureAcceptedAt == "" {
		log.Event(EventNoDisclosure)
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	chosen, ok := cfg.providerFor(p.Settings.Provider)
	if !ok {
		log.Event(EventProviderUnsupported)
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	if p.ContentChars() > limits.MaxProfileTotalChars {
		log.Event(EventProfileOverCap)
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	resp, err := callProvider(ctx, chosen, provider.Input{Request: req, Profile: *p})
	if err != nil {
		return fail(env.RequestID, provider.CodeFor(err), log)
	}
	checked, err := validate.DraftResponse(req, *p, resp)
	if err != nil {
		return fail(env.RequestID, validate.CodeFor(err), log)
	}
	return success(env.RequestID, checked, log)
}

// providerFor returns the adapter for a provider setting. Only Claude has one.
// A nil adapter for Claude is a wiring bug and surfaces as INTERNAL_ERROR in
// callProvider.
func (c Config) providerFor(name string) (provider.Provider, bool) {
	if name == profile.ProviderClaude {
		return c.Provider, true
	}
	return nil, false
}

// callProvider contains a provider panic so it becomes INTERNAL_ERROR rather
// than ending the process.
func callProvider(ctx context.Context, p provider.Provider, in provider.Input) (resp protocol.DraftResponse, err error) {
	if p == nil {
		return resp, errors.New("no provider")
	}
	defer func() {
		if r := recover(); r != nil {
			resp, err = protocol.DraftResponse{}, errors.New("provider panic")
		}
	}()
	return p.Draft(ctx, in)
}

func success(requestID string, result any, log *Logger) protocol.ResponseEnvelope {
	resp, err := protocol.BuildSuccessResponse(requestID, result)
	if err != nil {
		return fail(requestID, protocol.CodeInternalError, log)
	}
	return resp
}

func fail(requestID string, code protocol.ErrorCode, log *Logger) protocol.ResponseEnvelope {
	log.EventCode(EventRequestFailed, code)
	return protocol.BuildCodeErrorResponse(requestID, code)
}
