/**
 * Zod schemas for the jobs table (Ch 4.6, Ch 35.1).
 *
 * These schemas are the Zod Wall for the jobs table. Every read of a jobs row
 * passes through server/db/queries/jobs.ts which calls these schemas.
 *
 * JobInputSchema and JobOutputSchema validate the JSON columns.
 * JobRowSchema validates the full row shape returned by Drizzle.
 *
 * Per Ch 35.1: raw Drizzle results are never consumed directly by business logic.
 * All reads go through the wrapper in server/db/queries/jobs.ts.
 */

import { z } from 'zod';
// Job status, type, and error class values — duplicated here from schema.ts
// to keep the shared/schemas layer free of server-side imports.
// These must be kept in sync with schema.ts (enforced by the schema-consistency
// test in the Zod Wall test suite).
const JOB_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
] as const;

const JOB_TYPE_VALUES = [
  'data_extraction',
  'draft_generation',
  'review',
  'regeneration',
  'formatting',
  'information_request_generation',
  'outline_generation',
  'reviewer_feedback',
  'evaluator',
  'context_summary_generation',
] as const;

const JOB_ERROR_CLASS_VALUES = [
  'timeout',
  'api_error',
  'parse_error',
  'revert_failed',
  'other',
] as const;

// ============================================================
// Job input JSON schema (Ch 4.6)
// The input column captures the full composed prompt and materials manifest.
// This is a flexible envelope — the exact shape depends on job type.
// The base schema validates the required fields; role-specific schemas
// in server/llm/schemas/ validate the role-specific portions.
// ============================================================
export const JobInputSchema = z.object({
  // The system prompt rendered for this job (from the prompt asset)
  // Optional for legacy rows stored as input:{} before prompt capture was implemented
  systemPrompt: z.string().min(1).optional(),
  // The user-side prompt rendered from the context template
  // Optional for legacy rows stored as input:{} before prompt capture was implemented
  userPrompt: z.string().min(1).optional(),
  // Materials manifest: which materials were included in context
  materialsManifest: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        contentHash: z.string(),
        tokenCount: z.number().int().nonnegative(),
        tier: z.enum(['tier1', 'tier2', 'tier3']),
      }),
    )
    .optional()
    .default([]),
  // Role-specific metadata (e.g., templateId for draft_generation, reviewSessionId for review)
  roleMetadata: z.record(z.unknown()).optional().default({}),
});

export type JobInput = z.infer<typeof JobInputSchema>;

// ============================================================
// Job output JSON schema (Ch 4.6)
// The output column captures the structured response where applicable.
// Free-form drafter output is stored as a string; structured outputs
// (reviewer, evaluator, extractor, outline, matrix) are stored as objects.
// ============================================================
export const JobOutputSchema = z
  .union([
    // Drafter-family roles (draft_generation, regeneration, formatting): free-form text
    z.object({
      type: z.literal('text'),
      content: z.string(),
      tokensPrompt: z.number().int().nonnegative(),
      tokensCompletion: z.number().int().nonnegative(),
    }),
    // Structured output roles: parsed object from provider
    z.object({
      type: z.literal('structured'),
      content: z.record(z.unknown()),
      tokensPrompt: z.number().int().nonnegative(),
      tokensCompletion: z.number().int().nonnegative(),
    }),
    // Legacy rows: output stored as a raw string before typed envelope was introduced
    z.string(),
  ])
  .nullable();

export type JobOutput = z.infer<typeof JobOutputSchema>;

// ============================================================
// Full job row schema — validates the complete row returned by Drizzle
// ============================================================
export const JobRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  jobType: z.enum(JOB_TYPE_VALUES),
  providerId: z.string().min(1).max(32),
  modelId: z.string().min(1).max(64),
  // promptVersion: immutable after insert (R11 / Ch 22.8)
  promptVersion: z.string().min(1).max(32),
  status: z.enum(JOB_STATUS_VALUES),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  lastHeartbeatAt: z.date().nullable(),
  // JSON columns: validated separately
  input: JobInputSchema,
  output: JobOutputSchema,
  errorClass: z.enum(JOB_ERROR_CLASS_VALUES).nullable(),
  errorMessage: z.string().nullable(),
  tokensPrompt: z.number().int().nonnegative().nullable(),
  tokensCompletion: z.number().int().nonnegative().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type JobRow = z.infer<typeof JobRowSchema>;

// ============================================================
// Public job shape — safe to send to the client
// Excludes the full input/output content (potentially large); includes
// status, metadata, and error information for UI display.
// ============================================================
export const PublicJobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  jobType: z.enum(JOB_TYPE_VALUES),
  providerId: z.string(),
  modelId: z.string(),
  promptVersion: z.string(),
  status: z.enum(JOB_STATUS_VALUES),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  lastHeartbeatAt: z.date().nullable(),
  errorClass: z.enum(JOB_ERROR_CLASS_VALUES).nullable(),
  errorMessage: z.string().nullable(),
  tokensPrompt: z.number().int().nonnegative().nullable(),
  tokensCompletion: z.number().int().nonnegative().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PublicJob = z.infer<typeof PublicJobSchema>;
