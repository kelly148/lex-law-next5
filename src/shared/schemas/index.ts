/**
 * Shared schemas index — Lex Law Next v1
 *
 * Re-exports all Zod schemas for convenient importing.
 */

// Phase 1 — user schemas
export {
  UserRowSchema,
  PublicUserSchema,
  SessionDataSchema,
} from './users.js';
export type { UserRow, PublicUser, SessionData } from './users.js';

// Phase 2 — job schemas
export {
  JobInputSchema,
  JobOutputSchema,
  JobRowSchema,
  PublicJobSchema,
} from './jobs.js';
export type { JobInput, JobOutput, JobRow, PublicJob } from './jobs.js';
