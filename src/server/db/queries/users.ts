/**
 * users query wrapper — Lex Law Next v1
 *
 * Ch 35.1 — The Zod Wall: This is the ONLY code path that reads from the users table.
 * Every read passes through UserRowSchema.parse() before returning to any caller.
 * Direct Drizzle reads of the users table outside this module are forbidden.
 *
 * Pattern (established in Phase 1, replicated by all later phases):
 *   1. Execute the Drizzle query.
 *   2. Parse each row through the Zod schema.
 *   3. On parse failure: emit zod_parse_failed telemetry, then re-throw the ZodError.
 *   4. Return the parsed, type-safe result.
 *
 * Ch 35.2 — userId is never a procedure input. Callers pass userId from ctx.userId.
 *
 * Ch 25.10 — No Silent Failures: parse failures emit zod_parse_failed before re-throwing.
 */

import { eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { users } from '../schema.js';
import { UserRowSchema, PublicUserSchema } from '../../../shared/schemas/users.js';
import type { PublicUser } from '../../../shared/schemas/users.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

// ============================================================
// Internal: parse a raw row through the Zod schema
// Emits zod_parse_failed on failure, then re-throws.
// ============================================================
function parseUserRow(raw: unknown, context: { userId: string }): ReturnType<typeof UserRowSchema.parse> {
  try {
    return UserRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      // Ch 25.9 / Ch 35.1: emit zod_parse_failed before re-throwing
      emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'UserRowSchema',
          tableName: 'users',
          columnName: undefined,
          errorPath: err.errors.map(e => e.path.join('.')).join(', '),
          errorMessage: err.message,
        },
        { userId: context.userId }
      );
    }
    throw err;
  }
}

// ============================================================
// users.get — fetch a single user by ID
// ============================================================
/**
 * Fetch a user by ID.
 * Returns the public user shape (passwordHash excluded).
 * Returns null if the user does not exist.
 *
 * @param userId  The user's UUID. Must come from ctx.userId (Ch 35.2).
 */
export async function getUser(userId: string): Promise<PublicUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  // Parse through Zod Wall — validates the full row shape
  const parsed = parseUserRow(rows[0], { userId });

  // Return the public shape (passwordHash excluded)
  return PublicUserSchema.parse(parsed);
}

// ============================================================
// users.getByUsername — used by the login procedure only
// ============================================================
/**
 * Fetch a user by username for authentication.
 * Returns the FULL row including passwordHash — only for use in the login procedure.
 * Do not use this function outside of authentication flows.
 *
 * @param username  The username to look up.
 */
export async function getUserByUsername(
  username: string
): Promise<ReturnType<typeof UserRowSchema.parse> | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  // Parse through Zod Wall — validates the full row shape including passwordHash
  // Use a system userId for telemetry context since we don't have one yet
  return parseUserRow(rows[0], { userId: 'system' });
}

// ============================================================
// users.updatePassword — used by the settings page
// ============================================================
/**
 * Update the attorney's password hash.
 * Called only after verifying the current password in the procedure layer.
 *
 * @param userId       The user's UUID. Must come from ctx.userId (Ch 35.2).
 * @param newPasswordHash  The new bcrypt hash.
 */
export async function updateUserPassword(
  userId: string,
  newPasswordHash: string
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: newPasswordHash })
    .where(eq(users.id, userId));
}
