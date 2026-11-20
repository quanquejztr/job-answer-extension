import { MAX_NATIVE_REQUEST_BYTES } from '../constants/limits';
import type { ErrorCode } from '../../schemas/error';

// Size is checked on the serialized bytes before any parsing, as in Go.
export function checkRequestSize(serialized: string): ErrorCode | null {
  return new TextEncoder().encode(serialized).length > MAX_NATIVE_REQUEST_BYTES
    ? 'MESSAGE_TOO_LARGE'
    : null;
}
