package importer

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"jobanswer/helper/internal/limits"
)

const (
	wNS       = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	mcNS      = `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`
	sentinel  = "ZQXDOCXSENTINELZQX"
	typesXML  = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`
	xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
)

// docx builds a synthetic .docx from a document body (the inside of w:body).
func docx(t *testing.T, body string) []byte {
	t.Helper()
	return zipOf(t, map[string]string{
		"[Content_Types].xml": typesXML,
		"word/document.xml":   xmlHeader + `<w:document ` + wNS + ` ` + mcNS + `><w:body>` + body + `</w:body></w:document>`,
	}, zip.Deflate)
}

func zipOf(t *testing.T, files map[string]string, method uint16) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// Stable order: content types first.
	for _, name := range []string{"[Content_Types].xml", "word/document.xml", "word/other.xml"} {
		content, ok := files[name]
		if !ok {
			continue
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func para(text string) string {
	return `<w:p><w:r><w:t xml:space="preserve">` + text + `</w:t></w:r></w:p>`
}

func TestExtractDOCXText(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"single paragraph", para("Made-up Person"), "Made-up Person"},
		{"paragraphs become lines", para("Summary") + para("Built things.") + para("Shipped them."), "Summary\nBuilt things.\nShipped them."},
		{"runs join without separators", `<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo </w:t></w:r><w:r><w:t>there</w:t></w:r></w:p>`, "Hello there"},
		{"tab and breaks", `<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:cr/><w:t>D</w:t></w:r></w:p>`, "A\tB\nC\nD"},
		{"bullets", `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>First point</w:t></w:r></w:p>` +
			`<w:p><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Second point</w:t></w:r></w:p>` + para("After the list"),
			"- First point\n- Second point\nAfter the list"},
		{"numId zero is not a list", `<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Plain</w:t></w:r></w:p>`, "Plain"},
		{"empty list paragraph has no marker", `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:p>` + para("Text"), "Text"},
		{"blank paragraphs collapse", para("A") + `<w:p/><w:p/><w:p/>` + para("B"), "A\n\nB"},
		{"deleted text and instructions ignored", `<w:p><w:r><w:t>keep</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:instrText>HYPERLINK</w:instrText></w:r></w:p>`, "keep"},
		{"table cells are paragraphs", `<w:tbl><w:tr><w:tc>` + para("Cell one") + `</w:tc><w:tc>` + para("Cell two") + `</w:tc></w:tr></w:tbl>`, "Cell one\nCell two"},
		{"fallback duplicate skipped", `<w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t>Shape</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Shape</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>`, "Shape"},
		{"entities decode", para("R&amp;D &lt;team&gt; &#233;"), "R&D <team> é"},
		{"unicode", para("Résumé — 東京大学 😀 Zoë Ñandú"), "Résumé — 東京大学 😀 Zoë Ñandú"},
		{"non-breaking hyphen", `<w:p><w:r><w:t>e</w:t><w:noBreakHyphen/><w:t>mail</w:t></w:r></w:p>`, "e-mail"},
		{"trailing spaces trimmed", para("line   ") + para("next"), "line\nnext"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ExtractDOCX(docx(t, tc.body))
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestExtractDOCXStoredAndDeflated(t *testing.T) {
	files := map[string]string{
		"[Content_Types].xml": typesXML,
		"word/document.xml":   xmlHeader + `<w:document ` + wNS + `><w:body>` + para("Stored") + `</w:body></w:document>`,
	}
	got, err := ExtractDOCX(zipOf(t, files, zip.Store))
	if err != nil || got != "Stored" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestExtractDOCXReadsOnlyDocumentXML(t *testing.T) {
	// A huge unrelated entry and a path-traversal name are never read or used.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	add("[Content_Types].xml", typesXML)
	add("../../etc/evil", sentinel)
	add("word/other.xml", strings.Repeat("A", 20<<20))
	add("word/document.xml", xmlHeader+`<w:document `+wNS+`><w:body>`+para("Only this")+`</w:body></w:document>`)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := ExtractDOCX(buf.Bytes())
	if err != nil || got != "Only this" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestExtractDOCXErrors(t *testing.T) {
	pdf := append([]byte("%PDF-1.7\n"), make([]byte, 100)...)
	ole := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 100)...)
	noDoc := zipOf(t, map[string]string{"[Content_Types].xml": typesXML, "word/other.xml": "<x/>"}, zip.Deflate)
	noTypes := zipOf(t, map[string]string{"word/document.xml": "<x/>"}, zip.Deflate)
	badXML := zipOf(t, map[string]string{"[Content_Types].xml": typesXML, "word/document.xml": `<w:document ` + wNS + `><w:body><w:p>`}, zip.Deflate)
	bomb := docx(t, para(strings.Repeat(" ", MaxDocumentXMLBytes+10)))
	longText := docx(t, para(strings.Repeat("a", MaxTextChars+1)))
	tooBig := append([]byte("PK\x03\x04"), make([]byte, limits.MaxDocxFileBytes)...)
	truncated := docx(t, para("x"))
	truncated = truncated[:len(truncated)/2]
	tests := []struct {
		name string
		data []byte
		want error
	}{
		{"nil", nil, ErrEmpty},
		{"empty bytes", []byte{}, ErrEmpty},
		{"no text", docx(t, `<w:p/><w:p><w:r><w:t>   </w:t></w:r></w:p>`), ErrEmpty},
		{"plain text file", []byte("just some text"), ErrUnsupported},
		{"pdf", pdf, ErrUnsupported},
		{"png-like", []byte("\x89PNG\r\n\x1a\n0000"), ErrUnsupported},
		{"ole container (encrypted or .doc)", ole, ErrEncrypted},
		{"zip magic but garbage", []byte("PK\x03\x04 not a real archive at all"), ErrMalformed},
		{"truncated archive", truncated, ErrMalformed},
		{"missing document.xml", noDoc, ErrUnsupported},
		{"missing content types", noTypes, ErrUnsupported},
		{"malformed xml", badXML, ErrMalformed},
		{"zip bomb", bomb, ErrOversized},
		{"too much text", longText, ErrOversized},
		{"file over the size cap", tooBig, ErrOversized},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ExtractDOCX(tc.data)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if got != "" {
				t.Fatalf("returned text with an error: %q", got)
			}
		})
	}
}

func TestExtractDOCXBombIsSmallOnTheWire(t *testing.T) {
	bomb := docx(t, para(strings.Repeat(" ", MaxDocumentXMLBytes+10)))
	if len(bomb) > limits.MaxDocxFileBytes {
		t.Fatalf("test bomb is %d bytes, so it would hit the file cap instead of the resource cap", len(bomb))
	}
}

func TestExtractDOCXManyEntries(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for i := 0; i <= MaxArchiveEntries; i++ {
		if _, err := zw.CreateHeader(&zip.FileHeader{Name: "f" + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + string(rune('a'+i/26%26)) + string(rune('a'+i/676)), Method: zip.Store}); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if buf.Len() > limits.MaxDocxFileBytes {
		t.Skip("archive directory larger than the file cap")
	}
	if _, err := ExtractDOCX(buf.Bytes()); !errors.Is(err, ErrOversized) {
		t.Fatalf("err = %v", err)
	}
}

func TestExtractDOCXErrorsCarryNoContent(t *testing.T) {
	bad := zipOf(t, map[string]string{"[Content_Types].xml": typesXML, "word/document.xml": `<w:document ` + wNS + `><w:body><w:p><w:r><w:t>` + sentinel + `</w:t></w:r></w:body>`}, zip.Deflate)
	_, err := ExtractDOCX(bad)
	if !errors.Is(err, ErrMalformed) {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), sentinel) {
		t.Fatal("error text carries document content")
	}
}
