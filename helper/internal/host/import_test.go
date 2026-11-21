package host

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
	"jobanswer/helper/internal/protocol"
)

const importSentinel = "ZQXIMPORTSENTINELZQX"

func importZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "word/document.xml"} {
		c, ok := files[name]
		if !ok {
			continue
		}
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(c))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const wordNS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`

func importDocx(t *testing.T, paragraphs ...string) []byte {
	t.Helper()
	var b strings.Builder
	for _, p := range paragraphs {
		b.WriteString(`<w:p><w:r><w:t>` + p + `</w:t></w:r></w:p>`)
	}
	return importZip(t, map[string]string{
		"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
		"word/document.xml":   `<w:document ` + wordNS + `><w:body>` + b.String() + `</w:body></w:document>`,
	})
}

func importBody(id string, data []byte) string {
	return body(id, protocol.TypeProfileImportDocument, map[string]any{"bytesBase64": base64.StdEncoding.EncodeToString(data)})
}

func TestImportDocumentReturnsTextAndSavesNothing(t *testing.T) {
	home := t.TempDir()
	r := runProfile(t, home, 0, importBody("i1", importDocx(t, "Made-up Person", "Résumé 東京 😀")))
	if r.err != nil || len(r.frames) != 1 || !r.frames[0].OK {
		t.Fatalf("err=%v frames=%+v", r.err, r.frames)
	}
	var got struct {
		Text   string `json:"text"`
		Source string `json:"source"`
	}
	if err := strictDecode(r.frames[0].Result, &got); err != nil {
		t.Fatalf("result shape: %v", err)
	}
	if got.Text != "Made-up Person\nRésumé 東京 😀" || got.Source != "docx" {
		t.Fatalf("got %+v", got)
	}
	// Import is not a save: the data directory is never created.
	if _, err := os.Lstat(DataDir(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("import created the data directory")
	}
	// Even with a profile already saved, import leaves it unchanged.
	r = runProfile(t, home, 0,
		resumeBody("r1", "Saved résumé text.", "pasted"),
		importBody("i2", importDocx(t, "Different text")),
		getBody("g1"),
	)
	p := decodeProfileResult(t, r.frames[2])
	if p.Resume == nil || p.Resume.Text != "Saved résumé text." || p.Resume.Source != "pasted" {
		t.Fatalf("import changed the saved résumé: %+v", p.Resume)
	}
}

func TestImportDocumentFailuresAreInvalidRequestWithNoLeaks(t *testing.T) {
	home := t.TempDir()
	bomb := importDocx(t, strings.Repeat(" ", 9<<20))
	cases := map[string][]byte{
		"empty document":   importDocx(t, " "),
		"plain text":       []byte(importSentinel),
		"pdf":              append([]byte("%PDF-1.7 "), importSentinel...),
		"ole":              append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, importSentinel...),
		"garbage zip":      append([]byte("PK\x03\x04"), importSentinel...),
		"missing document": importZip(t, map[string]string{"[Content_Types].xml": "<x/>"}),
		"malformed xml": importZip(t, map[string]string{
			"[Content_Types].xml": "<x/>",
			"word/document.xml":   `<w:document ` + wordNS + `><w:body><w:p><w:r><w:t>` + importSentinel + `</w:t></w:r></w:body>`,
		}),
		"zip bomb": bomb,
	}
	i := 0
	for name, data := range cases {
		i++
		id := "f" + string(rune('a'+i))
		r := runProfile(t, home, 0, importBody(id, data))
		if len(r.frames) != 1 || r.frames[0].OK || r.frames[0].Error == nil || r.frames[0].Error.Code != protocol.CodeInvalidRequest {
			t.Fatalf("%s: frames=%+v", name, r.frames)
		}
		if *r.frames[0].Error != protocol.NewAppError(protocol.CodeInvalidRequest) {
			t.Fatalf("%s: not the fixed catalog entry: %+v", name, r.frames[0].Error)
		}
		if bytes.Contains(r.stdout, []byte(importSentinel)) || strings.Contains(r.stderr, importSentinel) {
			t.Fatalf("%s: document content reached stdout or stderr", name)
		}
		for _, line := range strings.Split(strings.TrimSpace(r.stderr), "\n") {
			if !strings.HasPrefix(line, "event=") {
				t.Fatalf("%s: stderr line is not an event: %q", name, line)
			}
		}
	}
	if _, err := os.Lstat(DataDir(home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a failed import created the data directory")
	}
}

func TestImportDocumentRejectsBadPayloadsAndOversizeFiles(t *testing.T) {
	over := make([]byte, limits.MaxDocxFileBytes+1)
	r := runProfile(t, t.TempDir(), 0,
		importBody("o1", over),
		body("o2", protocol.TypeProfileImportDocument, map[string]any{"bytesBase64": "UEsDBA==", "filename": "a.docx"}),
		body("o3", protocol.TypeProfileImportDocument, map[string]any{"bytesBase64": ""}),
		body("o4", protocol.TypeProfileImportDocument, map[string]any{}),
	)
	if len(r.frames) != 4 {
		t.Fatalf("frames = %d", len(r.frames))
	}
	for i, f := range r.frames {
		if f.OK || f.Error == nil || f.Error.Code != protocol.CodeInvalidRequest {
			t.Fatalf("frame %d: %+v", i, f)
		}
	}
}

func TestImportDocumentFileAtCapFitsOneRequest(t *testing.T) {
	// A valid document padded (inside a stored extra entry is not read) up to
	// the cap must pass transport and extract.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, content string) {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	add("[Content_Types].xml", "<x/>")
	add("word/document.xml", `<w:document `+wordNS+`><w:body><w:p><w:r><w:t>At the cap</w:t></w:r></w:p></w:body></w:document>`)
	hdr := &zip.FileHeader{Name: "word/media/pad.bin", Method: zip.Store}
	w, _ := zw.CreateHeader(hdr)
	pad := make([]byte, limits.MaxDocxFileBytes-buf.Len()-600)
	for i := range pad {
		pad[i] = byte(i*131 + i/7)
	}
	_, _ = w.Write(pad)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	if len(data) > limits.MaxDocxFileBytes || len(data) < limits.MaxDocxFileBytes-2000 {
		t.Fatalf("test file is %d bytes", len(data))
	}
	raw := importBody("c1", data)
	if len(raw) >= limits.MaxNativeRequestBytes {
		t.Fatalf("request is %d bytes, over the native cap", len(raw))
	}
	r := runProfile(t, t.TempDir(), 0, raw)
	if len(r.frames) != 1 || !r.frames[0].OK {
		t.Fatalf("frames = %+v", r.frames)
	}
	var out struct{ Text string }
	_ = json.Unmarshal(r.frames[0].Result, &out)
	if out.Text != "At the cap" {
		t.Fatalf("text = %q", out.Text)
	}
}
