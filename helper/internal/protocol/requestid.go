package protocol

// requestId rule: 1-64 characters from [A-Za-z0-9_-].
//
// When a request is unparseable or has no valid requestId, the error response
// uses requestId "" (empty). ParseRequest returns the requestId in the partial
// envelope whenever it was present and valid, even if parsing later fails.

const maxRequestIDLen = 64

// ValidRequestID reports whether s satisfies the requestId rule.
func ValidRequestID(s string) bool {
	if len(s) < 1 || len(s) > maxRequestIDLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}
