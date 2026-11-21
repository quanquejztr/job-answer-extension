package profile

import "errors"

// Sentinel errors. Messages are fixed and never contain user content.
var (
	ErrInvalidItem        = errors.New("profile: invalid item")
	ErrLimitExceeded      = errors.New("profile: limit exceeded")
	ErrNotFound           = errors.New("profile: item not found")
	ErrUnsafePath         = errors.New("profile: unsafe storage path")
	ErrTooLarge           = errors.New("profile: profile file too large")
	ErrCorrupt            = errors.New("profile: profile file is corrupt")
	ErrUnsupportedVersion = errors.New("profile: unsupported schema version")
	ErrStorage            = errors.New("profile: storage failure")
)
