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

// FOLD-PM-4 — matter_deliverable (owner+matter-scoped to-do / ongoing-matter items)
export {
  MATTER_DELIVERABLE_STATUS_VALUES,
  MatterDeliverableRowSchema,
} from './matterDeliverables.js';
export type { MatterDeliverableStatus, MatterDeliverableRow } from './matterDeliverables.js';

// FOLD-PM-2 — document-type structured extraction (commitment/deed/survey/settlement)
export {
  DOCUMENT_TYPE_VALUES,
  ExtractedFieldSchema,
  DocumentExtractionResultSchema,
  MaterialExtractionRowSchema,
} from './documentExtraction.js';
export type {
  DocumentType,
  ExtractedField,
  DocumentExtractionResult,
  MaterialExtractionRow,
} from './documentExtraction.js';

// KB-PROVENANCE-1 — authority_source (firm/jurisdiction legal-authority registry)
export { AUTHORITY_TYPE_VALUES, AuthoritySourceRowSchema } from './authoritySource.js';
export type { AuthorityType, AuthoritySourceRow } from './authoritySource.js';
