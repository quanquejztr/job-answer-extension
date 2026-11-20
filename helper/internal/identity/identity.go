// Package identity holds the pinned extension identity: the one place in Go
// that knows the extension ID. TypeScript mirror: extension/lib/constants/extension-key.ts.
// Both are checked against tests/protocol-fixtures/extension.json.
package identity

// ExtensionID is derived from the public manifest key (see extension-key.ts).
const ExtensionID = "fofmklpoecdileojcljpmemhcefmhbfc"

// NativeHostName is the native-messaging host name registered with Chrome.
const NativeHostName = "com.jobanswerdrafter.host"

// Origin returns the single origin Chrome passes to the host and the host
// manifest allows.
func Origin() string {
	return "chrome-extension://" + ExtensionID + "/"
}
