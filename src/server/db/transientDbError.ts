/**
 * isTransientDbError — connection-level transient error classifier
 *
 * S3 (MR-DEPLOY-1): Used by the dispatcher poll loop to distinguish
 * connection-level transient errors (retryable with backoff) from
 * non-transient errors (schema mismatches, programmer errors, Zod parse
 * failures) that should surface immediately without retry.
 *
 * Classification is by err.code paired with connection-loss context.
 * The mysql2 `fatal: true` flag alone is insufficient — some fatal errors
 * are configuration errors (ER_ACCESS_DENIED_ERROR) that must not be retried.
 *
 * Clearly transient (retry with backoff; console.info retry log):
 *   ECONNRESET, ETIMEDOUT, PROTOCOL_CONNECTION_LOST
 *
 * Conditionally retried (retry with backoff; console.warn retry log):
 *   ECONNREFUSED, EHOSTUNREACH — may also indicate misconfiguration or
 *   hard-down conditions; sustained occurrences should escalate to process exit.
 *
 * Non-transient (no retry; surface immediately):
 *   ER_ACCESS_DENIED_ERROR, ER_BAD_DB_ERROR, ER_BAD_FIELD_ERROR,
 *   ZodError, unknown/unrecognized codes (default false).
 */

import { ZodError } from 'zod';

/** Codes that are clearly transient (TCP-level connection reset/timeout). */
const CLEARLY_TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
]);

/** Codes that are conditionally retried (may indicate misconfiguration). */
const CONDITIONALLY_RETRIED_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
]);

/**
 * Returns true if the error is a connection-level transient error that
 * should be retried with backoff. Returns false for all other errors.
 *
 * @param err - Any thrown value (unknown type; narrowed internally).
 */
export function isTransientDbError(err: unknown): boolean {
  // ZodError is never transient — it indicates a data integrity issue.
  if (err instanceof ZodError) {
    return false;
  }

  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') {
      return CLEARLY_TRANSIENT_CODES.has(code) || CONDITIONALLY_RETRIED_CODES.has(code);
    }
  }

  // Unknown or unrecognized code — default false (non-transient).
  return false;
}

/**
 * Returns true if the error code is in the "conditionally retried" set
 * (ECONNREFUSED, EHOSTUNREACH). Used by the dispatcher to determine whether
 * to log at console.warn instead of console.info.
 */
export function isConditionallyRetriedCode(err: unknown): boolean {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') {
      return CONDITIONALLY_RETRIED_CODES.has(code);
    }
  }
  return false;
}
