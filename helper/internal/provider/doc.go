// Package provider defines the narrow Provider interface; implementations live
// in subpackages (fake, claude, codex). A provider turns a validated
// DraftRequest into a DraftResponse. It never writes to fields, controls
// Chrome, or decides what reaches the UI: the host validates its output.
package provider
