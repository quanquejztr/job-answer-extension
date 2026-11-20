// Package limits mirrors PRD §15.1. TypeScript mirror: extension/lib/constants/limits.ts.
package limits

const (
	MinQuestionChars       = 10
	MaxQuestionChars       = 1000
	MaxJobContextChars     = 8000
	MaxNativeRequestBytes  = 256 * 1024
	MaxNativeResponseBytes = 512 * 1024
	ProviderTimeoutSeconds = 90
	TargetLifetimeSeconds  = 10 * 60
	MinMaxWords            = 20
	MaxMaxWords            = 400
	MaxCurrentDraftChars   = 4000
	MaxWarningMessageChars = 200
)
