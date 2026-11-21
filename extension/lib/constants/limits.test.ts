import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MIN_QUESTION_CHARS,
  MAX_QUESTION_CHARS,
  MAX_JOB_CONTEXT_CHARS,
  MAX_NATIVE_REQUEST_BYTES,
  MAX_NATIVE_RESPONSE_BYTES,
  PROVIDER_TIMEOUT_SECONDS,
  TARGET_LIFETIME_SECONDS,
  MIN_MAX_WORDS,
  MAX_MAX_WORDS,
  MAX_CURRENT_DRAFT_CHARS,
  MAX_WARNING_MESSAGE_CHARS,
  MAX_STORY_CHARS,
  MAX_SAMPLE_CHARS,
  MAX_RULE_CHARS,
  MAX_RULES,
  MAX_SAMPLES,
  MAX_TITLE_CHARS,
  MAX_LABEL_CHARS,
  MAX_STORIES,
  MAX_PROFILE_BYTES,
  MAX_RESUME_CHARS,
  MAX_PROFILE_TOTAL_CHARS,
  MAX_DOCX_FILE_BYTES,
  MAX_PDF_FILE_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  PDF_EXTRACT_TIMEOUT_MS,
} from './limits';

describe('limits', () => {
  it('has the PRD values', () => {
    expect(MIN_QUESTION_CHARS).toBe(10);
    expect(MAX_QUESTION_CHARS).toBe(1000);
    expect(MAX_JOB_CONTEXT_CHARS).toBe(8000);
    expect(MAX_NATIVE_REQUEST_BYTES).toBe(262144);
    expect(MAX_NATIVE_RESPONSE_BYTES).toBe(524288);
    expect(PROVIDER_TIMEOUT_SECONDS).toBe(90);
    expect(TARGET_LIFETIME_SECONDS).toBe(600);
    expect(MIN_MAX_WORDS).toBe(20);
    expect(MAX_MAX_WORDS).toBe(400);
    expect(MAX_CURRENT_DRAFT_CHARS).toBe(4000);
    expect(MAX_WARNING_MESSAGE_CHARS).toBe(200);
    expect(MAX_STORY_CHARS).toBe(3000);
    expect(MAX_SAMPLE_CHARS).toBe(3000);
    expect(MAX_RULE_CHARS).toBe(200);
    expect(MAX_RULES).toBe(20);
    expect(MAX_SAMPLES).toBe(5);
    expect(MAX_TITLE_CHARS).toBe(100);
    expect(MAX_LABEL_CHARS).toBe(60);
    expect(MAX_STORIES).toBe(30);
    expect(MAX_PROFILE_BYTES).toBe(393216);
    expect(MAX_RESUME_CHARS).toBe(15000);
    expect(MAX_PROFILE_TOTAL_CHARS).toBe(40000);
    expect(MAX_DOCX_FILE_BYTES).toBe(194560);
  });

  it('matches the shared fixture', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(process.cwd(), 'tests/protocol-fixtures/limits.json'), 'utf8'),
    ) as Record<string, number>;
    expect(fixture).toEqual({
      minQuestionChars: MIN_QUESTION_CHARS,
      maxQuestionChars: MAX_QUESTION_CHARS,
      maxJobContextChars: MAX_JOB_CONTEXT_CHARS,
      maxNativeRequestBytes: MAX_NATIVE_REQUEST_BYTES,
      maxNativeResponseBytes: MAX_NATIVE_RESPONSE_BYTES,
      providerTimeoutSeconds: PROVIDER_TIMEOUT_SECONDS,
      targetLifetimeSeconds: TARGET_LIFETIME_SECONDS,
      minMaxWords: MIN_MAX_WORDS,
      maxMaxWords: MAX_MAX_WORDS,
      maxCurrentDraftChars: MAX_CURRENT_DRAFT_CHARS,
      maxWarningMessageChars: MAX_WARNING_MESSAGE_CHARS,
      maxStoryChars: MAX_STORY_CHARS,
      maxSampleChars: MAX_SAMPLE_CHARS,
      maxRuleChars: MAX_RULE_CHARS,
      maxRules: MAX_RULES,
      maxSamples: MAX_SAMPLES,
      maxTitleChars: MAX_TITLE_CHARS,
      maxLabelChars: MAX_LABEL_CHARS,
      maxStories: MAX_STORIES,
      maxProfileBytes: MAX_PROFILE_BYTES,
      maxResumeChars: MAX_RESUME_CHARS,
      maxProfileTotalChars: MAX_PROFILE_TOTAL_CHARS,
      maxDocxFileBytes: MAX_DOCX_FILE_BYTES,
    });
  });

  it('matches the extension-only PDF fixture (no Go mirror: the PDF never reaches the helper)', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(process.cwd(), 'tests/protocol-fixtures/extension-limits.json'), 'utf8'),
    ) as Record<string, number>;
    expect(fixture).toEqual({
      maxPdfFileBytes: MAX_PDF_FILE_BYTES,
      maxPdfPages: MAX_PDF_PAGES,
      maxPdfTextChars: MAX_PDF_TEXT_CHARS,
      pdfExtractTimeoutMs: PDF_EXTRACT_TIMEOUT_MS,
    });
    expect(MAX_PDF_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_PDF_PAGES).toBe(10);
    expect(MAX_PDF_TEXT_CHARS).toBe(60000);
    expect(PDF_EXTRACT_TIMEOUT_MS).toBe(20000);
  });
});
