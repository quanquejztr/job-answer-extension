package protocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"runtime"
	"testing"
	"testing/iotest"

	"jobanswer/helper/internal/limits"
)

func frame(n uint32, body []byte) []byte {
	b := make([]byte, 4, 4+len(body))
	binary.NativeEndian.PutUint32(b, n)
	return append(b, body...)
}

func TestFramingRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	body := []byte(`{"a":1}`)
	if err := WriteMessage(&buf, body, limits.MaxNativeResponseBytes); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes()[:4], frame(uint32(len(body)), nil)) {
		t.Fatal("prefix is not native-endian length")
	}
	got, err := ReadMessage(&buf, limits.MaxNativeRequestBytes)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := ReadMessage(&buf, 10); !errors.Is(err, ErrEndOfStream) {
		t.Fatalf("want ErrEndOfStream, got %v", err)
	}
}

func TestReadMessageErrors(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		max   int
		want  error
	}{
		{"empty stream", nil, 100, ErrEndOfStream},
		{"truncated prefix", []byte{1, 2}, 100, ErrTruncatedPrefix},
		{"zero length", frame(0, nil), 100, ErrEmptyMessage},
		{"truncated body", frame(10, []byte("abc")), 100, ErrTruncatedBody},
		{"prefix only", frame(5, nil), 100, ErrTruncatedBody},
		{"limit plus one", frame(11, bytes.Repeat([]byte("a"), 11)), 10, ErrMessageTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ReadMessage(bytes.NewReader(tt.input), tt.max)
			if !errors.Is(err, tt.want) {
				t.Fatalf("got %v, want %v", err, tt.want)
			}
		})
	}
}

func TestReadMessageExactLimitAndOneByteReader(t *testing.T) {
	body := bytes.Repeat([]byte("a"), 1000)
	got, err := ReadMessage(iotest.OneByteReader(bytes.NewReader(frame(1000, body))), 1000)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("exact limit with partial reads failed: %v", err)
	}
	got, err = ReadMessage(iotest.DataErrReader(bytes.NewReader(frame(3, []byte("abc")))), 10)
	if err != nil || string(got) != "abc" {
		t.Fatalf("data+EOF reader failed: %v", err)
	}
}

type prefixOnlyReader struct {
	prefix []byte
	t      *testing.T
}

func (r *prefixOnlyReader) Read(p []byte) (int, error) {
	if len(r.prefix) == 0 {
		r.t.Error("read beyond the length prefix")
		return 0, errors.New("read beyond prefix")
	}
	n := copy(p, r.prefix)
	r.prefix = r.prefix[n:]
	return n, nil
}

func TestOverLimitPrefixRejectedBeforeAllocation(t *testing.T) {
	r := &prefixOnlyReader{prefix: frame(0xFFFFFFFF, nil), t: t}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_, err := ReadMessage(r, limits.MaxNativeRequestBytes)
	runtime.ReadMemStats(&after)
	if !errors.Is(err, ErrMessageTooLarge) {
		t.Fatalf("got %v", err)
	}
	if after.TotalAlloc-before.TotalAlloc > 1<<20 {
		t.Fatalf("allocated %d bytes", after.TotalAlloc-before.TotalAlloc)
	}
}

type chunkWriter struct {
	buf   bytes.Buffer
	chunk int
}

func (w *chunkWriter) Write(p []byte) (int, error) {
	if len(p) > w.chunk {
		p = p[:w.chunk]
	}
	return w.buf.Write(p) // short write, nil error
}

type zeroWriter struct{}

func (zeroWriter) Write([]byte) (int, error) { return 0, nil }

func TestWriteMessage(t *testing.T) {
	body := bytes.Repeat([]byte("a"), 100)
	w := &chunkWriter{chunk: 3}
	if err := WriteMessage(w, body, 100); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(w.buf.Bytes(), frame(100, body)) {
		t.Fatal("short writes corrupted the frame")
	}
	var out bytes.Buffer
	if err := WriteMessage(&out, bytes.Repeat([]byte("a"), 101), 100); !errors.Is(err, ErrMessageTooLarge) || out.Len() != 0 {
		t.Fatalf("over limit: %v, wrote %d", err, out.Len())
	}
	if err := WriteMessage(&out, nil, 100); !errors.Is(err, ErrEmptyMessage) {
		t.Fatalf("empty: %v", err)
	}
	if err := WriteMessage(zeroWriter{}, body, 100); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("zero write: %v", err)
	}
	if err := WriteMessage(errWriter{}, body, 100); err == nil {
		t.Fatal("want writer error")
	}
}

type errWriter struct{}

func (errWriter) Write([]byte) (int, error) { return 1, errors.New("boom") }
