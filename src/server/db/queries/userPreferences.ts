/**
 * Zod Wall query wrapper for the user_preferences table (Ch 35.1 / Phase 3).
 *
 * One row per user (PK = userId). The preferences JSON column is Zod-validated
 * on every read. Upsert pattern used because the row may not exist for legacy
 * users (created before Phase 3 migration).
 */

import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { userPreferences, type UserPreferences } from '../schema.js';
import {
  UserPreferencesRowSchema,
  UserPreferencesDataSchema,
  DEFAULT_USER_PREFERENCES,
  type UserPreferencesRow,
  type UserPreferencesData,
  type ReviewerEnablement,
} from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';

function parsePreferencesRow(
  raw: UserPreferences,
  ctx: { userId: string },
): UserPreferencesRow {
  try {
    return UserPreferencesRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'UserPreferencesRowSchema',
          tableName: 'user_preferences',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

/**
 * Get user preferences, creating a default row if none exists.
 * This is the SOLE read path for user_preferences.
 */
export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesRow> {
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (rows.length > 0) {
    return parsePreferencesRow(rows[0]!, { userId });
  }

  // Create default row for user (upsert pattern)
  await db
    .insert(userPreferences)
    .values({
      userId,
      preferences: DEFAULT_USER_PREFERENCES,
    })
    .onDuplicateKeyUpdate({
      set: { userId }, // no-op update to handle race condition
    });

  const newRows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (newRows.length === 0) {
    throw new Error(
      `getUserPreferences: row not found after upsert (userId=${userId})`,
    );
  }
  return parsePreferencesRow(newRows[0]!, { userId });
}

/**
 * Update reviewer enablement for a user.
 * Merges the new enablement into the existing preferences JSON.
 */
export async function updateReviewerEnablement(
  userId: string,
  reviewerEnablement: ReviewerEnablement,
): Promise<UserPreferencesRow> {
  const current = await getUserPreferences(userId);
  const updated: UserPreferencesData = {
    ...current.preferences,
    reviewerEnablement,
  };
  // Validate the merged preferences before writing
  const validated = UserPreferencesDataSchema.parse(updated);
  await db
    .update(userPreferences)
    .set({ preferences: validated })
    .where(eq(userPreferences.userId, userId));
  return getUserPreferences(userId);
}

/**
 * Update voice input preferences for a user.
 */
export async function updateVoiceInputPreferences(
  userId: string,
  voiceInput: UserPreferencesData['voiceInput'],
): Promise<UserPreferencesRow> {
  const current = await getUserPreferences(userId);
  const updated: UserPreferencesData = {
    ...current.preferences,
    voiceInput,
  };
  const validated = UserPreferencesDataSchema.parse(updated);
  await db
    .update(userPreferences)
    .set({ preferences: validated })
    .where(eq(userPreferences.userId, userId));
  return getUserPreferences(userId);
}
