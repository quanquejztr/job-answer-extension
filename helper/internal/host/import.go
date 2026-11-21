package host

import (
	"jobanswer/helper/internal/importer"
	"jobanswer/helper/internal/profile"
	"jobanswer/helper/internal/protocol"
)

// importResult is the profile.import.document result: text for the editable
// résumé box. The helper saves nothing here; saving is profile.resume.set.
type importResult struct {
	Text   string `json:"text"`
	Source string `json:"source"`
}

// importDocument extracts the text of one .docx. Every importer failure
// (encrypted, malformed, unsupported, oversized, empty) is INVALID_REQUEST so
// the extension shows the paste fallback; the catalog message is fixed, and no
// document text, name, or importer detail reaches the response or stderr. It
// reads and writes no files: the profile directory is not touched.
func importDocument(env protocol.RequestEnvelope, log *Logger) (resp protocol.ResponseEnvelope) {
	defer func() {
		if recover() != nil {
			resp = fail(env.RequestID, protocol.CodeInternalError, log)
		}
	}()
	p, err := protocol.ParseImportDocumentPayload(env.Payload)
	if err != nil {
		return fail(env.RequestID, protocol.ToAppError(err).Code, log)
	}
	text, err := importer.ExtractDOCX(p.Bytes)
	if err != nil {
		return fail(env.RequestID, protocol.CodeInvalidRequest, log)
	}
	return success(env.RequestID, importResult{Text: text, Source: string(profile.SourceDOCX)}, log)
}
