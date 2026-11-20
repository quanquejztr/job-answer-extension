package host

import (
	"context"
	"encoding/json"
	"errors"
	"io"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/validate"
)

// Version is the helper version reported by helper.hello.
const Version = "0.1.0"

// Config holds what Run needs. Provider is required.
type Config struct {
	Provider provider.Provider
	Log      *Logger
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
			resp := handle(ctx, cfg.Provider, f.body, log)
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
	body, err := json.Marshal(resp)
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
func handle(ctx context.Context, p provider.Provider, body []byte, log *Logger) protocol.ResponseEnvelope {
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
		return generate(ctx, p, env, log)
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

func generate(ctx context.Context, p provider.Provider, env protocol.RequestEnvelope, log *Logger) protocol.ResponseEnvelope {
	req, err := protocol.ParseDraftRequest(env.Payload)
	if err != nil {
		return fail(env.RequestID, protocol.ToAppError(err).Code, log)
	}
	resp, err := callProvider(ctx, p, req)
	if err != nil {
		return fail(env.RequestID, provider.CodeFor(err), log)
	}
	if err := validate.DraftResponse(req, resp); err != nil {
		return fail(env.RequestID, validate.CodeFor(err), log)
	}
	return success(env.RequestID, resp, log)
}

// callProvider contains a provider panic so it becomes INTERNAL_ERROR rather
// than ending the process.
func callProvider(ctx context.Context, p provider.Provider, req protocol.DraftRequest) (resp protocol.DraftResponse, err error) {
	if p == nil {
		return resp, errors.New("no provider")
	}
	defer func() {
		if r := recover(); r != nil {
			resp, err = protocol.DraftResponse{}, errors.New("provider panic")
		}
	}()
	return p.Draft(ctx, req)
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
