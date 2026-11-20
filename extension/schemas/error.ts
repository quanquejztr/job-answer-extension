import { z } from 'zod';

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'MESSAGE_TOO_LARGE',
  'UNSUPPORTED_DOMAIN',
  'QUESTION_MISSING',
  'FIELD_NOT_FOUND',
  'FIELD_AMBIGUOUS',
  'FIELD_STALE',
  'FIELD_NONEMPTY',
  'FIELD_UNSUPPORTED',
  'HELPER_UNAVAILABLE',
  'PROVIDER_NOT_FOUND',
  'PROVIDER_NOT_AUTHENTICATED',
  'PROVIDER_USAGE_LIMIT',
  'PROVIDER_TIMEOUT',
  'PROVIDER_CANCELLED',
  'PROVIDER_OUTPUT_INVALID',
  'FACT_VALIDATION_FAILED',
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const AppErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  userAction: z.string().optional(),
});
export type AppError = z.infer<typeof AppErrorSchema>;

type CatalogEntry = { message: string; retryable: boolean; userAction?: string };

// Fixed messages, retryable flags, and user actions (PRD 17.3). Mirrors
// helper/internal/protocol/errors.go; both are checked against
// tests/protocol-fixtures/errors.json. No userAction means the PRD lists "None".
export const ERROR_CATALOG: Readonly<Record<ErrorCode, CatalogEntry>> = {
  INVALID_REQUEST: {
    message: 'The request was not valid.',
    retryable: false,
    userAction: 'Correct the input',
  },
  PROTOCOL_VERSION_UNSUPPORTED: {
    message: 'The protocol version is not supported.',
    retryable: false,
    userAction: 'Reinstall or update the helper',
  },
  MESSAGE_TOO_LARGE: {
    message: 'The request is too large.',
    retryable: false,
    userAction: 'Shorten the job context',
  },
  UNSUPPORTED_DOMAIN: {
    message: 'This site is not supported.',
    retryable: false,
    userAction: 'Draft elsewhere; the tool is disabled here',
  },
  QUESTION_MISSING: {
    message: 'No question was selected.',
    retryable: false,
    userAction: 'Select the full question and retry',
  },
  FIELD_NOT_FOUND: {
    message: 'No answer field was found.',
    retryable: false,
    userAction: 'Click Choose field',
  },
  FIELD_AMBIGUOUS: {
    message: 'More than one answer field is plausible.',
    retryable: false,
    userAction: 'Click Choose field',
  },
  FIELD_STALE: {
    message: 'The selected field is no longer valid.',
    retryable: false,
    userAction: 'Select the question again',
  },
  FIELD_NONEMPTY: {
    message: 'The field already has text.',
    retryable: false,
    userAction: 'Confirm replacement or cancel',
  },
  FIELD_UNSUPPORTED: {
    message: 'This editor type is not supported.',
    retryable: false,
    userAction: 'Use Copy answer',
  },
  HELPER_UNAVAILABLE: {
    message: 'The native helper is unavailable.',
    retryable: true,
    userAction: 'Run the installer, then retry',
  },
  PROVIDER_NOT_FOUND: {
    message: 'The provider command was not found.',
    retryable: false,
    userAction: 'Install the selected provider CLI',
  },
  PROVIDER_NOT_AUTHENTICATED: {
    message: 'The provider is not signed in.',
    retryable: false,
    userAction: 'Sign in with the CLI yourself',
  },
  PROVIDER_USAGE_LIMIT: {
    message: 'The provider usage limit was reached.',
    retryable: true,
    userAction: 'Wait or switch provider in settings',
  },
  PROVIDER_TIMEOUT: {
    message: 'The provider took too long to respond.',
    retryable: true,
    userAction: 'Retry',
  },
  PROVIDER_CANCELLED: { message: 'The request was cancelled.', retryable: true },
  PROVIDER_OUTPUT_INVALID: {
    message: 'The provider output was not usable.',
    retryable: true,
    userAction: 'Regenerate',
  },
  FACT_VALIDATION_FAILED: {
    message: 'The draft was not supported by your verified facts.',
    retryable: true,
    userAction: 'Regenerate or add the missing fact',
  },
  STORAGE_ERROR: {
    message: 'The profile could not be read or saved.',
    retryable: false,
    userAction: 'Export if possible, then repair or reset',
  },
  INTERNAL_ERROR: {
    message: 'An internal error occurred.',
    retryable: false,
    userAction: 'Restart Chrome; check diagnostics',
  },
};

export function appErrorFor(code: ErrorCode): AppError {
  const entry = ERROR_CATALOG[code];
  return entry.userAction === undefined
    ? { code, message: entry.message, retryable: entry.retryable }
    : {
        code,
        message: entry.message,
        retryable: entry.retryable,
        userAction: entry.userAction,
      };
}
