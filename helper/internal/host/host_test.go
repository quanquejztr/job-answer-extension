package host

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
	"jobanswer/helper/internal/provider"
	"jobanswer/helper/internal/provider/fake"
)

const sentinel = "SENTINEL-PAYLOAD-TEXT-9d41"

func frameOf(t *testing.T, body string) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := protocol.WriteMessage(&b, []byte(body), 1<<30); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func generateBody(id, question string, maxWords int, extra string) string {
	return `{"protocolVersion":1,"requestId":"` + id + `","type":"draft.generate","payload":{"question":"` + question +
		`","constraints":{"maxWords":` + itoa(maxWords) + extra + `},"requestedAt":"2026-11-19T15:04:05Z"}}`
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

type result struct {
	frames []protocol.ResponseEnvelope
	stderr string
	err    error
}

func run(t *testing.T, input []byte, p provider.Provider) result {
	t.Helper()
	var out, errBuf bytes.Buffer
	err := Run(context.Background(), bytes.NewReader(input), &out, Config{Provider: p, Log: NewLogger(&errBuf), Home: seedHome(t)})
	var frames []protocol.ResponseEnvelope
	for {
		body, rerr := protocol.ReadMessage(&out, limits.MaxNativeResponseBytes)
		if errors.Is(rerr, protocol.ErrEndOfStream) {
			break
		}
		if rerr != nil {
			t.Fatalf("read response frame: %v", rerr)
		}
		env, perr := protocol.ParseResponse(body)
		if perr != nil {
			t.Fatalf("response is not a valid envelope: %v", perr)
		}
		frames = append(frames, env)
	}
	return result{frames: frames, stderr: errBuf.String(), err: err}
}

func TestHello(t *testing.T) {
	r := run(t, frameOf(t, `{"protocolVersion":1,"requestId":"h1","type":"helper.hello","payload":{"extensionVersion":"0.0.0"}}`), fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 1 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	f := r.frames[0]
	if !f.OK || f.RequestID != "h1" {
		t.Fatalf("bad envelope: %+v", f)
	}
	var got map[string]any
	if err := json.Unmarshal(f.Result, &got); err != nil {
		t.Fatal(err)
	}
	if got["helperVersion"] != Version || got["protocolVersion"] != float64(1) || len(got) != 2 {
		t.Fatalf("bad hello result: %v", got)
	}
}

func TestGenerateReturnsDraftFromTheWholeProfile(t *testing.T) {
	r := run(t, frameOf(t, generateBody("g1", "Why do you want this role?", 150, "")), fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 1 || !r.frames[0].OK {
		t.Fatalf("err=%v frames=%+v", r.err, r.frames)
	}
	d, err := protocol.ParseDraftResponse(r.frames[0].Result)
	if err != nil {
		t.Fatal(err)
	}
	want := goodResponse()
	if d.Answer != want.Answer || !strings.Contains(d.Answer, seedResumeText) ||
		len(d.Evidence) != 2 || d.Evidence[0] != (protocol.EvidenceQuote{Source: "resume", Quote: seedResumeText}) ||
		d.Evidence[1].Source != "story:s_1" || len(d.Warnings) != 0 {
		t.Fatalf("unexpected draft: %+v", d)
	}
}

func TestCancelReportsNothingInFlight(t *testing.T) {
	r := run(t, frameOf(t, `{"protocolVersion":1,"requestId":"c1","type":"draft.cancel","payload":{"targetRequestId":"g1"}}`), fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 1 || !r.frames[0].OK {
		t.Fatalf("err=%v frames=%+v", r.err, r.frames)
	}
	if string(r.frames[0].Result) != `{"cancelled":false}` {
		t.Fatalf("result = %s", r.frames[0].Result)
	}
}

func TestMultipleRequestsOneResponseEach(t *testing.T) {
	in := append(frameOf(t, `{"protocolVersion":1,"requestId":"a","type":"helper.hello","payload":{"extensionVersion":"1"}}`),
		frameOf(t, `{"protocolVersion":1,"requestId":"b","type":"helper.hello","payload":{"extensionVersion":"1"}}`)...)
	r := run(t, in, fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 2 || r.frames[0].RequestID != "a" || r.frames[1].RequestID != "b" {
		t.Fatalf("err=%v frames=%+v", r.err, r.frames)
	}
}

func TestRecoverableErrorsContinue(t *testing.T) {
	tests := []struct {
		name string
		body string
		id   string
		code protocol.ErrorCode
	}{
		{"unknown type", `{"protocolVersion":1,"requestId":"u1","type":"profile.import.text","payload":{}}`, "u1", protocol.CodeInvalidRequest},
		{"wrong version echoes valid id", `{"protocolVersion":2,"requestId":"v1","type":"helper.hello","payload":{"extensionVersion":"1"}}`, "v1", protocol.CodeProtocolVersionUnsupported},
		{"wrong version, invalid id", `{"protocolVersion":2,"requestId":"bad id!","type":"helper.hello","payload":{"extensionVersion":"1"}}`, "", protocol.CodeProtocolVersionUnsupported},
		{"invalid id", `{"protocolVersion":1,"requestId":"bad id!","type":"helper.hello","payload":{"extensionVersion":"1"}}`, "", protocol.CodeInvalidRequest},
		{"missing id", `{"protocolVersion":1,"type":"helper.hello","payload":{"extensionVersion":"1"}}`, "", protocol.CodeInvalidRequest},
		{"not json", `not json`, "", protocol.CodeInvalidRequest},
		{"short question echoes id", generateBody("q1", "too short", 150, ""), "q1", protocol.CodeInvalidRequest},
		{"unknown payload field", `{"protocolVersion":1,"requestId":"p1","type":"helper.hello","payload":{"extensionVersion":"1","x":1}}`, "p1", protocol.CodeInvalidRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := append(frameOf(t, tt.body), frameOf(t, `{"protocolVersion":1,"requestId":"after","type":"helper.hello","payload":{"extensionVersion":"1"}}`)...)
			r := run(t, in, fake.FakeProvider{})
			if r.err != nil || len(r.frames) != 2 {
				t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
			}
			f := r.frames[0]
			if f.OK || f.Error == nil || f.Error.Code != tt.code || f.RequestID != tt.id {
				t.Fatalf("got %+v, want code %s id %q", f, tt.code, tt.id)
			}
			if !r.frames[1].OK || r.frames[1].RequestID != "after" {
				t.Fatalf("loop did not continue: %+v", r.frames[1])
			}
		})
	}
}

func TestEmptyFrameIsRecoverable(t *testing.T) {
	in := append(make([]byte, 4), frameOf(t, `{"protocolVersion":1,"requestId":"after","type":"helper.hello","payload":{"extensionVersion":"1"}}`)...)
	r := run(t, in, fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 2 || r.frames[0].Error == nil || r.frames[0].Error.Code != protocol.CodeInvalidRequest || r.frames[0].RequestID != "" || !r.frames[1].OK {
		t.Fatalf("err=%v frames=%+v", r.err, r.frames)
	}
}

func TestOversizeFrameEndsProcessWithTypedError(t *testing.T) {
	var prefix [4]byte
	binary.NativeEndian.PutUint32(prefix[:], uint32(limits.MaxNativeRequestBytes+1))
	r := run(t, prefix[:], fake.FakeProvider{})
	if !errors.Is(r.err, ErrFraming) {
		t.Fatalf("err = %v, want ErrFraming", r.err)
	}
	if len(r.frames) != 1 || r.frames[0].Error == nil || r.frames[0].Error.Code != protocol.CodeMessageTooLarge || r.frames[0].RequestID != "" {
		t.Fatalf("frames = %+v", r.frames)
	}
}

func TestTruncatedFramesEndProcessWithoutResponse(t *testing.T) {
	good := frameOf(t, `{"protocolVersion":1,"requestId":"a","type":"helper.hello","payload":{"extensionVersion":"1"}}`)
	for name, in := range map[string][]byte{
		"truncated prefix": {1, 0},
		"truncated body":   good[:len(good)-3],
	} {
		t.Run(name, func(t *testing.T) {
			r := run(t, in, fake.FakeProvider{})
			if !errors.Is(r.err, ErrFraming) || len(r.frames) != 0 {
				t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
			}
		})
	}
}

func TestCleanEOFExitsNil(t *testing.T) {
	r := run(t, nil, fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 0 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	if !strings.Contains(r.stderr, "event="+EventStart) || !strings.Contains(r.stderr, "event="+EventStop) {
		t.Fatalf("stderr = %q", r.stderr)
	}
}

// bigProvider returns an answer whose response frame exceeds 512 KiB.
type bigProvider struct{}

func (bigProvider) Draft(context.Context, provider.Input) (protocol.DraftResponse, error) {
	return protocol.DraftResponse{
		Answer:   strings.Repeat("x", limits.MaxNativeResponseBytes), // one "word"
		Evidence: []protocol.EvidenceQuote{{Source: "resume", Quote: seedResumeText}},
	}, nil
}

func TestResponseTooLargeBecomesInternalError(t *testing.T) {
	r := run(t, frameOf(t, generateBody("big1", "Why do you want this role?", 150, "")), bigProvider{})
	if r.err != nil || len(r.frames) != 1 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	f := r.frames[0]
	if f.OK || f.Error == nil || f.Error.Code != protocol.CodeInternalError || f.RequestID != "big1" {
		t.Fatalf("got %+v", f)
	}
}

type stubProvider struct {
	resp protocol.DraftResponse
	err  error
}

func (s stubProvider) Draft(context.Context, provider.Input) (protocol.DraftResponse, error) {
	return s.resp, s.err
}

type panicProvider struct{}

func (panicProvider) Draft(context.Context, provider.Input) (protocol.DraftResponse, error) {
	panic(sentinel)
}

func goodResponse() protocol.DraftResponse {
	r, _ := fake.FakeProvider{}.Draft(context.Background(), provider.Input{
		Request: protocol.DraftRequest{Constraints: protocol.DraftConstraints{MaxWords: 150}},
		Profile: profile.Profile{Resume: &profile.Resume{Text: seedResumeText, Source: profile.SourcePasted}},
	})
	return r
}

func TestProviderFailuresMapWithoutLeakingText(t *testing.T) {
	tests := []struct {
		name string
		p    provider.Provider
		code protocol.ErrorCode
	}{
		{"not found", stubProvider{err: provider.ErrNotFound}, protocol.CodeProviderNotFound},
		{"wrapped not authenticated", stubProvider{err: errors.Join(errors.New(sentinel), provider.ErrNotAuthenticated)}, protocol.CodeProviderNotAuthenticated},
		{"usage limit", stubProvider{err: provider.ErrUsageLimit}, protocol.CodeProviderUsageLimit},
		{"timeout", stubProvider{err: provider.ErrTimeout}, protocol.CodeProviderTimeout},
		{"deadline", stubProvider{err: context.DeadlineExceeded}, protocol.CodeProviderTimeout},
		{"cancelled", stubProvider{err: provider.ErrCancelled}, protocol.CodeProviderCancelled},
		{"context cancelled", stubProvider{err: context.Canceled}, protocol.CodeProviderCancelled},
		{"output invalid", stubProvider{err: provider.ErrOutputInvalid}, protocol.CodeProviderOutputInvalid},
		{"unknown error", stubProvider{err: errors.New(sentinel)}, protocol.CodeInternalError},
		{"panic", panicProvider{}, protocol.CodeInternalError},
		{"nil provider", nil, protocol.CodeInternalError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := run(t, frameOf(t, generateBody("e1", "Why do you want "+sentinel+"?", 150, "")), tt.p)
			if r.err != nil || len(r.frames) != 1 {
				t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
			}
			f := r.frames[0]
			if f.OK || f.Error == nil || f.Error.Code != tt.code || f.RequestID != "e1" {
				t.Fatalf("got %+v, want %s", f, tt.code)
			}
			if want := protocol.NewAppError(tt.code); *f.Error != want {
				t.Fatalf("error is not the fixed catalog entry: %+v", *f.Error)
			}
			body, _ := json.Marshal(f)
			if strings.Contains(string(body), sentinel) || strings.Contains(r.stderr, sentinel) {
				t.Fatal("sentinel leaked into response or stderr")
			}
		})
	}
}

func TestProviderResponseValidation(t *testing.T) {
	with := func(mod func(*protocol.DraftResponse)) provider.Provider {
		r := goodResponse()
		mod(&r)
		return stubProvider{resp: r}
	}
	tests := []struct {
		name  string
		p     provider.Provider
		extra string
		words int
		code  protocol.ErrorCode
	}{
		{"empty answer", with(func(r *protocol.DraftResponse) { r.Answer = "   " }), "", 150, protocol.CodeProviderOutputInvalid},
		{"quote is not an excerpt", with(func(r *protocol.DraftResponse) {
			r.Evidence = []protocol.EvidenceQuote{{Source: "resume", Quote: "not in the resume at all"}}
		}), "", 150, protocol.CodeFactValidationFailed},
		{"no evidence", with(func(r *protocol.DraftResponse) { r.Evidence = []protocol.EvidenceQuote{} }), "", 150, protocol.CodeFactValidationFailed},
		{"over maxWords", with(func(r *protocol.DraftResponse) { r.Answer = strings.Repeat("word ", 21) }), "", 20, protocol.CodeProviderOutputInvalid},
		{"over maxChars", with(func(r *protocol.DraftResponse) {}), `,"maxChars":40`, 150, protocol.CodeProviderOutputInvalid},
		{"bad warning code", with(func(r *protocol.DraftResponse) {
			r.Warnings = []protocol.DraftWarning{{Code: "NOPE", Severity: "info", Message: "x"}}
		}), "", 150, protocol.CodeProviderOutputInvalid},
		{"warning too long", with(func(r *protocol.DraftResponse) {
			r.Warnings = []protocol.DraftWarning{{Code: "MODEL_NOTE", Severity: "info", Message: strings.Repeat("x", 201)}}
		}), "", 150, protocol.CodeProviderOutputInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := run(t, frameOf(t, generateBody("v1", "Why do you want this role?", tt.words, tt.extra)), tt.p)
			if r.err != nil || len(r.frames) != 1 || r.frames[0].OK || r.frames[0].Error.Code != tt.code {
				t.Fatalf("err=%v frames=%+v want %s", r.err, r.frames, tt.code)
			}
		})
	}
	// Exactly at the character limit is accepted; the word limit's floor is 20.
	words := max(20, len(strings.Fields(goodResponse().Answer)))
	chars := len([]rune(goodResponse().Answer))
	r := run(t, frameOf(t, generateBody("ok", "Why do you want this role?", words, `,"maxChars":`+itoa(chars))), fake.FakeProvider{})
	if len(r.frames) != 1 || !r.frames[0].OK {
		t.Fatalf("exact limits rejected: %+v", r.frames)
	}
}

func TestNoPayloadTextInStderrOrErrors(t *testing.T) {
	in := bytes.Join([][]byte{
		frameOf(t, generateBody("s1", "Why "+sentinel+" this role?", 150, "")),
		frameOf(t, `{"protocolVersion":1,"requestId":"s2","type":"nope.`+sentinel+`","payload":{}}`),
		frameOf(t, `{"protocolVersion":1,"requestId":"`+sentinel+`!","type":"helper.hello","payload":{}}`),
		frameOf(t, `{`+sentinel),
	}, nil)
	r := run(t, in, fake.FakeProvider{})
	if r.err != nil || len(r.frames) != 4 {
		t.Fatalf("err=%v frames=%d", r.err, len(r.frames))
	}
	if strings.Contains(r.stderr, sentinel) {
		t.Fatalf("stderr contains payload text: %q", r.stderr)
	}
	for _, line := range strings.Split(strings.TrimSpace(r.stderr), "\n") {
		if !strings.HasPrefix(line, "event=") {
			t.Fatalf("stderr line is not an event: %q", line)
		}
	}
	for _, f := range r.frames[1:] {
		body, _ := json.Marshal(f)
		if strings.Contains(string(body), sentinel) {
			t.Fatal("error response contains payload text")
		}
	}
}

// blockingProvider waits for cancellation and reports it.
type blockingProvider struct{ started chan struct{} }

func (b blockingProvider) Draft(ctx context.Context, _ provider.Input) (protocol.DraftResponse, error) {
	close(b.started)
	<-ctx.Done()
	return protocol.DraftResponse{}, ctx.Err()
}

func TestStdinEOFCancelsInFlightProvider(t *testing.T) {
	pr, pw := io.Pipe()
	var out bytes.Buffer
	b := blockingProvider{started: make(chan struct{})}
	finished := make(chan error, 1)
	go func() {
		finished <- Run(context.Background(), pr, &out, Config{Provider: b, Log: NewLogger(io.Discard), Home: seedHome(t)})
	}()
	if _, err := pw.Write(frameOf(t, generateBody("x1", "Why do you want this role?", 150, ""))); err != nil {
		t.Fatal(err)
	}
	<-b.started
	_ = pw.Close() // Chrome disconnects the port
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("Run err = %v, want nil on clean EOF", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not exit after stdin closed")
	}
	body, err := protocol.ReadMessage(&out, limits.MaxNativeResponseBytes)
	if err != nil {
		t.Fatal(err)
	}
	env, err := protocol.ParseResponse(body)
	if err != nil || env.OK || env.Error.Code != protocol.CodeProviderCancelled || env.RequestID != "x1" {
		t.Fatalf("env=%+v err=%v", env, err)
	}
}

func TestParentContextCancellationReachesProvider(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	defer pw.Close()
	var out bytes.Buffer
	b := blockingProvider{started: make(chan struct{})}
	finished := make(chan error, 1)
	go func() {
		finished <- Run(ctx, pr, &out, Config{Provider: b, Log: NewLogger(io.Discard), Home: seedHome(t)})
	}()
	_, _ = pw.Write(frameOf(t, generateBody("x2", "Why do you want this role?", 150, "")))
	<-b.started
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after parent cancel")
	}
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New(sentinel) }

func TestWriteFailureEndsProcess(t *testing.T) {
	var errBuf bytes.Buffer
	err := Run(context.Background(), bytes.NewReader(frameOf(t, `{"protocolVersion":1,"requestId":"a","type":"helper.hello","payload":{"extensionVersion":"1"}}`)), failWriter{}, Config{Provider: fake.FakeProvider{}, Log: NewLogger(&errBuf), Home: seedHome(t)})
	if !errors.Is(err, ErrWrite) || strings.Contains(err.Error(), sentinel) || strings.Contains(errBuf.String(), sentinel) {
		t.Fatalf("err=%v stderr=%q", err, errBuf.String())
	}
}

const seedResumeText = "Built routing software for small teams and learned systems design."

// seedHome returns a temporary home whose profile holds a saved résumé and one
// story, so draft.generate has the profile it requires.
func seedHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	s, err := profile.NewStore(DataDir(home), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetResume(profile.ResumeInput{Text: seedResumeText, Source: profile.SourcePasted}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertStory(profile.StoryInput{Title: "Orchestra", Text: "Played cello in a community orchestra."}); err != nil {
		t.Fatal(err)
	}
	chooseClaudeAndAccept(t, s)
	return home
}
