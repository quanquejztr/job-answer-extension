package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

const prefixSize = 4

// ReadMessage reads one native-messaging frame: a 4-byte length in native byte
// order followed by that many bytes. The length is checked against max before
// the body is allocated. A clean EOF before any prefix byte returns
// ErrEndOfStream; EOF inside the prefix or body returns ErrTruncatedPrefix or
// ErrTruncatedBody. A zero length returns ErrEmptyMessage.
func ReadMessage(r io.Reader, max int) ([]byte, error) {
	var prefix [prefixSize]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		switch {
		case errors.Is(err, io.EOF):
			return nil, ErrEndOfStream
		case errors.Is(err, io.ErrUnexpectedEOF):
			return nil, ErrTruncatedPrefix
		default:
			return nil, fmt.Errorf("read length prefix: %w", err)
		}
	}
	n := binary.NativeEndian.Uint32(prefix[:])
	if n == 0 {
		return nil, ErrEmptyMessage
	}
	if max < 0 || uint64(n) > uint64(max) {
		return nil, ErrMessageTooLarge
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, ErrTruncatedBody
		}
		return nil, fmt.Errorf("read message body: %w", err)
	}
	return body, nil
}

// WriteMessage writes one frame. It rejects an empty body or one over max
// before writing anything, and keeps writing until the whole frame is out.
func WriteMessage(w io.Writer, body []byte, max int) error {
	if len(body) == 0 {
		return ErrEmptyMessage
	}
	if max < 0 || len(body) > max || uint64(len(body)) > uint64(^uint32(0)) {
		return ErrMessageTooLarge
	}
	frame := make([]byte, prefixSize+len(body))
	binary.NativeEndian.PutUint32(frame, uint32(len(body)))
	copy(frame[prefixSize:], body)
	for len(frame) > 0 {
		n, err := w.Write(frame)
		if n > 0 {
			frame = frame[n:]
		}
		if err != nil {
			return fmt.Errorf("write message: %w", err)
		}
		if n == 0 {
			return fmt.Errorf("write message: %w", io.ErrShortWrite)
		}
	}
	return nil
}
