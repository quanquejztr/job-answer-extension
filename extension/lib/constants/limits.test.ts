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
    });
  });
});
