package host

import "errors"

// ErrCallerRejected means the first argument was missing or not the allowed
// origin. It carries no argument text.
var ErrCallerRejected = errors.New("caller origin rejected")

// CheckCaller verifies the caller origin Chrome passes as the first argument
// (`chrome-extension://<id>/`). args excludes the program name. Extra
// arguments after the origin (Chrome may append a parent-window value) are
// ignored. It must run before any message is read.
func CheckCaller(args []string, allowedOrigin string) error {
	if len(args) < 1 || allowedOrigin == "" || args[0] != allowedOrigin {
		return ErrCallerRejected
	}
	return nil
}
