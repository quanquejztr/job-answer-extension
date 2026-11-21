package host

import (
	"context"
	"errors"

	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
)

// diagnosticRow is one diagnostics row on the wire (PRD 17.2). Code and
// UserAction are omitted when the check passed; for a failure they come from
// the fixed catalog, never from provider output. A code whose catalog entry has
// no user action (cancelled) omits it.
type diagnosticRow struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	Code       string `json:"code,omitempty"`
	UserAction string `json:"userAction,omitempty"`
}

type diagnosticsResult struct {
	Checks []diagnosticRow `json:"checks"`
}

// diagnose answers diagnostics.run: the helper check (always ok, since this
// code is running) followed by the checks of the provider the user chose in
// settings. With no provider chosen only the helper row is returned; Codex has
// no adapter, so a "codex" setting reports its executable as not found. It
// reads no credentials and starts no login.
func diagnose(ctx context.Context, cfg Config, env protocol.RequestEnvelope, log *Logger) protocol.ResponseEnvelope {
	loaded, err := withStore(cfg, func(s *profile.Store) (any, error) { return s.Load() })
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
	checks := []diagnosticRow{{Name: provider.CheckHelper, OK: true}}
	var provided []provider.Check
	switch p.Settings.Provider {
	case "":
		// Nothing to check yet: the settings page asks the user to choose.
	case profile.ProviderClaude:
		if cfg.Diagnoser == nil {
			return fail(env.RequestID, protocol.CodeInternalError, log)
		}
		provided = callDiagnoser(ctx, cfg.Diagnoser)
	default:
		provided = []provider.Check{{Name: provider.CheckProviderExecutable, Code: protocol.CodeProviderNotFound}}
	}
	for _, c := range provided {
		row := diagnosticRow{Name: c.Name, OK: c.OK}
		if !c.OK {
			app := protocol.NewAppError(c.Code)
			row.Code = string(app.Code)
			row.UserAction = app.UserAction
			log.EventCode(EventDiagnosticFailed, app.Code)
		}
		checks = append(checks, row)
	}
	return success(env.RequestID, diagnosticsResult{Checks: checks}, log)
}

// callDiagnoser contains a diagnoser panic so it becomes one failing row.
func callDiagnoser(ctx context.Context, d provider.Diagnoser) (checks []provider.Check) {
	defer func() {
		if r := recover(); r != nil {
			checks = []provider.Check{{Name: provider.CheckProviderExecutable, Code: protocol.CodeInternalError}}
		}
	}()
	return d.Diagnose(ctx)
}
