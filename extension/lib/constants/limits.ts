// Mirrors PRD §15.1. Go mirror: helper/internal/limits/limits.go.
export const MIN_QUESTION_CHARS = 10;
export const MAX_QUESTION_CHARS = 1000;
export const MAX_JOB_CONTEXT_CHARS = 8000;
export const MAX_NATIVE_REQUEST_BYTES = 256 * 1024;
export const MAX_NATIVE_RESPONSE_BYTES = 512 * 1024;
export const PROVIDER_TIMEOUT_SECONDS = 90;
export const TARGET_LIFETIME_SECONDS = 10 * 60;
export const MIN_MAX_WORDS = 20;
export const MAX_MAX_WORDS = 400;
export const MAX_CURRENT_DRAFT_CHARS = 4000;
export const MAX_WARNING_MESSAGE_CHARS = 200;
export const MAX_RESUME_CHARS = 15000;
export const MAX_STORY_CHARS = 3000;
export const MAX_SAMPLE_CHARS = 3000;
export const MAX_RULE_CHARS = 200;
export const MAX_RULES = 20;
export const MAX_SAMPLES = 5;
export const MAX_TITLE_CHARS = 100;
export const MAX_LABEL_CHARS = 60;
export const MAX_STORIES = 30;
export const MAX_PROFILE_TOTAL_CHARS = 40000;
export const MAX_PROFILE_BYTES = 384 * 1024;
// The largest .docx the upload transport accepts: base64 inside one native
// request (256 KiB). 190 KiB is 259,414 base64 characters plus the envelope.
export const MAX_DOCX_FILE_BYTES = 190 * 1024;

// Extension-only limits for PDF upload (ADR 0004). The PDF never travels to the
// helper (only the extracted text does), so these have no Go mirror; they are
// checked against tests/protocol-fixtures/extension-limits.json.
export const MAX_PDF_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
// Same bound as the DOCX import: extracted text above it is refused. Text between
// the 15,000 résumé cap and this bound is shown in the box so the user can trim it.
export const MAX_PDF_TEXT_CHARS = 60000;
export const PDF_EXTRACT_TIMEOUT_MS = 20000;
