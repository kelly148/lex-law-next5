/**
 * authBypass.ts — MR-AUTH-BYPASS-1
 *
 * Temporary environment-gated authentication bypass.
 *
 * When AUTH_BYPASS_ENABLED=true, protected routes and tRPC procedures
 * proceed without requiring a logged-in session.
 *
 * Reactivate full auth by setting AUTH_BYPASS_ENABLED=false or removing it.
 *
 * IMPORTANT: This module must ONLY affect behavior when AUTH_BYPASS_ENABLED=true.
 * All existing auth logic is preserved and active when the flag is absent or false.
 *
 * User identity resolution order (§2 of dispatch):
 *   1. AUTH_BYPASS_USER_ID  — look up existing DB user by UUID.
 *   2. AUTH_BYPASS_USER_EMAIL — look up existing DB user by email (not implemented;
 *      the users table does not have an email column accessible without schema change).
 *   3. Synthetic in-memory bypass user — used only when AUTH_BYPASS_ENABLED=true
 *      and no AUTH_BYPASS_USER_ID is set. Safe only for stateless endpoints
 *      (e.g. Upload & Format) where userId is not used as a DB foreign key.
 *
 * The synthetic bypass user UUID is a fixed, clearly labeled constant.
 * It is never written to the database.
 */

/**
 * Returns true if the temporary auth bypass is enabled.
 * Only true when AUTH_BYPASS_ENABLED is exactly the string "true".
 */
export function isAuthBypassEnabled(): boolean {
  return process.env['AUTH_BYPASS_ENABLED'] === 'true';
}

/**
 * The bypass user ID to inject into ctx.userId when AUTH_BYPASS_ENABLED=true.
 *
 * Resolution order:
 *   1. AUTH_BYPASS_USER_ID env var (existing DB user UUID — preferred for DB-touching routes).
 *   2. Synthetic fallback UUID (safe only for stateless routes; DB queries will fail
 *      if this UUID does not exist in the users table).
 *
 * Operators performing DB-touching workflows (Matters, Finalize, etc.) MUST set
 * AUTH_BYPASS_USER_ID to their existing user UUID. Upload & Format is stateless
 * and works with either value.
 */
export const BYPASS_SYNTHETIC_USER_ID = '00000000-0000-0000-0000-000000000000';

export function getBypassUserId(): string {
  const envId = process.env['AUTH_BYPASS_USER_ID'];
  if (envId && envId.trim().length > 0) {
    return envId.trim();
  }
  // Synthetic fallback — labeled clearly; safe only for stateless endpoints.
  // See carryforward facts in Phase A close-out.
  return BYPASS_SYNTHETIC_USER_ID;
}
