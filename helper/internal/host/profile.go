package host

import (
	"errors"
	"path/filepath"
	"time"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

const (
	// DataDirName is the application-owned directory under Application Support.
	DataDirName = "JobAnswerDrafter"
	// DefaultProfileTimeout is the overall deadline for one profile request.
	DefaultProfileTimeout = 5 * time.Second
)

// DataDir returns the helper's data directory for a home directory.
func DataDir(home string) string {
	return filepath.Join(home, "Library", "Application Support", DataDirName)
}

type itemResult struct {
	Item any `json:"item"`
}

type exportResult struct {
	File *profile.Profile `json:"file"`
}

type resumeResult struct {
	Resume profile.Resume `json:"resume"`
}

type providerResult struct {
	Provider string `json:"provider"`
}

type disclosureResult struct {
	DisclosureAcceptedAt string `json:"disclosureAcceptedAt"`
}

type deletedResult struct {
	Deleted bool `json:"deleted"`
}

// handleProfile runs one profile request. Each request builds its own Store
// over the data directory and runs it in a goroutine so that a store call
// blocked on the file lock (which waits without a timeout) cannot hold the
// response past the deadline. The request context is deliberately not used:
// Run cancels it when stdin reaches EOF, and a mutation already started must
// finish (the write is atomic) rather than be abandoned half way.
func handleProfile(cfg Config, env protocol.RequestEnvelope, log *Logger) protocol.ResponseEnvelope {
	op, code := profileOp(env)
	if op == nil {
		return fail(env.RequestID, code, log)
	}
	res, err := withStore(cfg, op)
	event := wholeProfileEvent(env.Type)
	if err != nil {
		code := profileErrorCode(err)
		if errors.Is(err, errDeadline) {
			log.Event(EventProfileTimeout)
		}
		if event != "" {
			log.EventCode(event, code)
		}
		return fail(env.RequestID, code, log)
	}
	if event != "" {
		log.Event(event)
	}
	return success(env.RequestID, res, log)
}

// errDeadline reports that a store call outlived its deadline.
var errDeadline = errors.New("profile deadline exceeded")

// withStore builds a Store over the data directory and runs op on it in a
// goroutine, bounded by the profile timeout (default 5 s). It is shared by the
// profile handlers and draft.generate so both use the same directory, deadline
// and error mapping. A late finisher never blocks: the result channel is
// buffered.
func withStore(cfg Config, op func(*profile.Store) (any, error)) (any, error) {
	timeout := cfg.ProfileTimeout
	if timeout <= 0 {
		timeout = DefaultProfileTimeout
	}
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		defer func() {
			if recover() != nil {
				done <- outcome{err: errPanic}
			}
		}()
		if cfg.Home == "" || !filepath.IsAbs(cfg.Home) {
			done <- outcome{err: profile.ErrUnsafePath}
			return
		}
		store, err := profile.NewStore(DataDir(cfg.Home), nil, nil)
		if err != nil {
			done <- outcome{err: err}
			return
		}
		res, err := op(store)
		done <- outcome{result: res, err: err}
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case o := <-done:
		return o.result, o.err
	case <-timer.C:
		return nil, errDeadline
	}
}

// wholeProfileEvent names the stderr event for export and delete-all, which
// are logged on success as well as on failure; other types have none.
func wholeProfileEvent(typ string) string {
	switch typ {
	case protocol.TypeProfileExport:
		return EventProfileExport
	case protocol.TypeProfileDeleteAll:
		return EventProfileDeleteAll
	}
	return ""
}

var errPanic = errors.New("profile handler panic")

// profileErrorCode maps store errors to catalog codes (PRD 16.1).
func profileErrorCode(err error) protocol.ErrorCode {
	switch {
	case errors.Is(err, profile.ErrInvalidItem),
		errors.Is(err, profile.ErrLimitExceeded),
		errors.Is(err, profile.ErrNotFound):
		return protocol.CodeInvalidRequest
	case errors.Is(err, errDeadline),
		errors.Is(err, profile.ErrStorage),
		errors.Is(err, profile.ErrCorrupt),
		errors.Is(err, profile.ErrUnsupportedVersion),
		errors.Is(err, profile.ErrTooLarge),
		errors.Is(err, profile.ErrUnsafePath):
		return protocol.CodeStorageError
	default:
		return protocol.CodeInternalError
	}
}

// profileOp decodes the already validated payload into a store operation.
func profileOp(env protocol.RequestEnvelope) (func(*profile.Store) (any, error), protocol.ErrorCode) {
	switch env.Type {
	case protocol.TypeProfileGet:
		return func(s *profile.Store) (any, error) { return s.Load() }, ""
	case protocol.TypeProfileExport:
		// The full versioned profile exactly as stored: Export is a copy of
		// Load and writes nothing. No drafts, questions, or job context exist
		// in the profile, so none can appear here.
		return func(s *profile.Store) (any, error) {
			p, err := s.Export()
			if err != nil {
				return nil, err
			}
			return exportResult{File: p}, nil
		}, ""
	case protocol.TypeProfileDeleteAll:
		return func(s *profile.Store) (any, error) {
			if err := s.DeleteAll(); err != nil {
				return nil, err
			}
			return deletedResult{Deleted: true}, nil
		}, ""
	case protocol.TypeSettingsSetProvider:
		p, err := protocol.ParseSetProviderPayload(env.Payload)
		if err != nil {
			return nil, protocol.ToAppError(err).Code
		}
		return func(s *profile.Store) (any, error) {
			if err := s.SetProvider(p.Provider); err != nil {
				return nil, err
			}
			return providerResult{Provider: p.Provider}, nil
		}, ""
	case protocol.TypeSettingsAcceptDisclosure:
		return func(s *profile.Store) (any, error) {
			if err := s.AcceptDisclosure(); err != nil {
				return nil, err
			}
			p, err := s.Load()
			if err != nil {
				return nil, err
			}
			return disclosureResult{DisclosureAcceptedAt: p.Settings.DisclosureAcceptedAt}, nil
		}, ""
	case protocol.TypeProfileItemUpsert:
		p, err := protocol.ParseItemUpsertPayload(env.Payload)
		if err != nil {
			return nil, protocol.ToAppError(err).Code
		}
		return func(s *profile.Store) (any, error) { return upsert(s, p) }, ""
	case protocol.TypeProfileResumeSet:
		p, err := protocol.ParseResumeSetPayload(env.Payload)
		if err != nil {
			return nil, protocol.ToAppError(err).Code
		}
		return func(s *profile.Store) (any, error) {
			r, err := s.SetResume(profile.ResumeInput{Text: p.Text, Source: p.Source})
			if err != nil {
				return nil, err
			}
			return resumeResult{Resume: r}, nil
		}, ""
	case protocol.TypeProfileItemDelete:
		p, err := protocol.ParseItemDeletePayload(env.Payload)
		if err != nil {
			return nil, protocol.ToAppError(err).Code
		}
		return func(s *profile.Store) (any, error) {
			if err := s.Delete(profile.ItemKind(p.Kind), p.ID); err != nil {
				return nil, err
			}
			return deletedResult{Deleted: true}, nil
		}, ""
	}
	return nil, protocol.CodeInternalError
}

func upsert(s *profile.Store, p protocol.ItemUpsertPayload) (any, error) {
	switch {
	case p.Story != nil:
		st, err := s.UpsertStory(profile.StoryInput{ID: p.Story.ID, Title: p.Story.Title, Text: p.Story.Text})
		return itemResult{Item: st}, err
	case p.Sample != nil:
		w, err := s.UpsertSample(profile.SampleInput{ID: p.Sample.ID, Label: p.Sample.Label, Text: p.Sample.Text})
		return itemResult{Item: w}, err
	case p.Rule != nil:
		r, err := s.UpsertRule(profile.RuleInput{ID: p.Rule.ID, Kind: p.Rule.Kind, Text: p.Rule.Text, Enabled: p.Rule.Enabled})
		return itemResult{Item: r}, err
	}
	return nil, errPanic
}
