package importer

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"jobanswer/helper/internal/limits"
)

// Typed failures. None carries document text or any name from the document.
var (
	// ErrEmpty: no input, or the document has no text.
	ErrEmpty = errors.New("document is empty")
	// ErrOversized: the file, an archive resource, or the extracted text is over a limit.
	ErrOversized = errors.New("document is too large")
	// ErrEncrypted: a password-protected file. Word stores an encrypted .docx
	// in an OLE container (the same container as a legacy .doc, which is
	// refused the same way) and an archive entry may carry the encryption flag.
	ErrEncrypted = errors.New("document is encrypted or in an old format")
	// ErrMalformed: not a readable zip archive or not well-formed Word XML.
	ErrMalformed = errors.New("document is malformed")
	// ErrUnsupported: a readable file that is not a .docx (for example a PDF or
	// a zip without Word content).
	ErrUnsupported = errors.New("document type is not supported")
)

// Resource limits for one document. The file-size limit is shared with the
// extension (limits.MaxDocxFileBytes); the rest are helper-only.
const (
	// MaxArchiveEntries bounds the zip directory (a real résumé has about 15).
	MaxArchiveEntries = 1000
	// MaxDocumentXMLBytes bounds the decompressed word/document.xml, which is
	// the only archive entry ever read.
	MaxDocumentXMLBytes = 8 << 20
	// MaxTextChars bounds the extracted text in code points, four times the
	// résumé limit so a long document can still be shortened in the editor.
	MaxTextChars = 4 * limits.MaxResumeChars
)

const (
	documentPart     = "word/document.xml"
	contentTypesPart = "[Content_Types].xml"
	nsWord           = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsMarkupCompat   = "http://schemas.openxmlformats.org/markup-compatibility/2006"
)

// ExtractDOCX returns the plain text of a .docx file held in data. It checks
// the file's magic number rather than any name, bounds every resource, reads
// only word/document.xml, and uses archive entry names only to compare against
// that one fixed part name, never as a path.
func ExtractDOCX(data []byte) (string, error) {
	if len(data) == 0 {
		return "", ErrEmpty
	}
	if len(data) > limits.MaxDocxFileBytes {
		return "", ErrOversized
	}
	switch {
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
	case bytes.HasPrefix(data, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}):
		return "", ErrEncrypted
	default:
		return "", ErrUnsupported
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", ErrMalformed
	}
	if len(zr.File) > MaxArchiveEntries {
		return "", ErrOversized
	}
	var doc *zip.File
	hasTypes := false
	for _, f := range zr.File {
		switch f.Name {
		case contentTypesPart:
			hasTypes = true
		case documentPart:
			if doc != nil {
				return "", ErrMalformed
			}
			doc = f
		}
	}
	if doc == nil || !hasTypes {
		return "", ErrUnsupported
	}
	if doc.Flags&0x1 != 0 {
		return "", ErrEncrypted
	}
	if doc.UncompressedSize64 > MaxDocumentXMLBytes {
		return "", ErrOversized
	}
	rc, err := doc.Open()
	if err != nil {
		return "", ErrMalformed
	}
	defer rc.Close()
	// The declared size can lie, so the read itself is capped too.
	lr := &io.LimitedReader{R: rc, N: MaxDocumentXMLBytes + 1}
	text, err := extractText(lr)
	if lr.N <= 0 {
		return "", ErrOversized
	}
	if err != nil {
		return "", err
	}
	if utf8.RuneCountInString(text) > MaxTextChars {
		return "", ErrOversized
	}
	if text == "" {
		return "", ErrEmpty
	}
	return text, nil
}

// paragraph is one w:p being built.
type paragraph struct {
	b    strings.Builder
	list bool
}

// extractText walks the WordprocessingML token stream. Paragraphs become lines,
// w:tab a tab, w:br and w:cr a line break, and list paragraphs (w:numPr) start
// with "- ". mc:Fallback is skipped because it repeats mc:Choice content. The
// XML decoder is strict and never expands entities or fetches anything.
func extractText(r io.Reader) (string, error) {
	dec := xml.NewDecoder(r)
	dec.Strict = true
	var (
		lines    []string
		stack    []*paragraph
		inText   bool
		fallback int
		total    int
	)
	top := func() *paragraph {
		if len(stack) == 0 {
			return nil
		}
		return stack[len(stack)-1]
	}
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			// Includes the read cap being hit; the caller checks that first.
			return "", fmt.Errorf("%w: read document xml", ErrMalformed)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Space == nsMarkupCompat && t.Name.Local == "Fallback" {
				fallback++
				continue
			}
			if fallback > 0 || t.Name.Space != nsWord {
				continue
			}
			p := top()
			switch t.Name.Local {
			case "p":
				stack = append(stack, &paragraph{})
			case "numPr":
				if p != nil {
					p.list = true
				}
			case "numId":
				// numId 0 removes numbering from a paragraph.
				if p != nil {
					for _, a := range t.Attr {
						if a.Name.Space == nsWord && a.Name.Local == "val" && a.Value == "0" {
							p.list = false
						}
					}
				}
			case "t":
				inText = true
			case "tab":
				if p != nil {
					p.b.WriteByte('\t')
				}
			case "br", "cr":
				if p != nil {
					p.b.WriteByte('\n')
				}
			case "noBreakHyphen":
				if p != nil {
					p.b.WriteByte('-')
				}
			}
		case xml.EndElement:
			if t.Name.Space == nsMarkupCompat && t.Name.Local == "Fallback" {
				if fallback > 0 {
					fallback--
				}
				continue
			}
			if fallback > 0 || t.Name.Space != nsWord {
				continue
			}
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				if len(stack) == 0 {
					continue
				}
				p := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				line := strings.TrimRight(p.b.String(), " \t\n")
				if p.list && strings.TrimSpace(line) != "" {
					line = "- " + strings.TrimLeft(line, " \t")
				}
				lines = append(lines, line)
			}
		case xml.CharData:
			if p := top(); inText && fallback == 0 && p != nil {
				p.b.Write(t)
				total += len(t)
				if total > 4*MaxTextChars {
					return "", ErrOversized
				}
			}
		}
	}
	return tidy(lines), nil
}

// tidy trims each line's trailing space, drops other control characters,
// collapses runs of blank lines to one, and trims the whole text.
func tidy(lines []string) string {
	var out []string
	blank := true
	for _, l := range lines {
		for _, sub := range strings.Split(l, "\n") {
			sub = strings.Map(func(r rune) rune {
				if r == '\t' || r >= 0x20 && r != 0x7f {
					return r
				}
				return -1
			}, sub)
			sub = strings.TrimRight(sub, " \t")
			if strings.TrimSpace(sub) == "" {
				if blank {
					continue
				}
				blank = true
				out = append(out, "")
				continue
			}
			blank = false
			out = append(out, sub)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
