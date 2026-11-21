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

	// Profile limits (lengths in Unicode code points).
	MaxResumeChars       = 15000
	MaxStoryChars        = 3000
	MaxSampleChars       = 3000
	MaxRuleChars         = 200
	MaxRules             = 20
	MaxSamples           = 5
	MaxTitleChars        = 100
	MaxLabelChars        = 60
	MaxStories           = 30
	MaxProfileTotalChars = 40000
	MaxProfileBytes      = 384 * 1024

	// MaxDocxFileBytes is the largest .docx the upload transport accepts. The
	// file travels base64 inside one native request (256 KiB): 190 KiB becomes
	// 259,414 base64 characters, which with the JSON envelope stays under 262,144.
	MaxDocxFileBytes = 190 * 1024
)
