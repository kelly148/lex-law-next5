/**
 * authority_source schemas (Zod Wall) — KB-PROVENANCE-1.
 *
 * A DURABLE firm/jurisdiction-level legal-authority (citation) registry, generalizing the
 * embedded practice_memos.lawReliedOn (LawReliedOnEntry) structure into a first-class row.
 *
 * NOT to be confused with the existing matter-scoped `source_authority` table (artifact
 * tiering, mutable, purged with the matter). authority_source is owner/firm-level (no
 * matterId), survives matter closure, and is the recheck/currency registry for the KB.
 *
 * Constitution (WHEREAS_KB_CONSTITUTION §2/§8) invariants this row SHAPE carries:
 *   - A citation registry row is meaningless without its citation -> citationText is NOT NULL.
 *   - The §2 promotion gate (an L2-promoted authority must carry a pinned pinpoint + a checker
 *     signature) is enforced at the app-layer PROMOTION boundary, NOT as a column constraint —
 *     an additive migration on a populated table cannot add NOT NULL without a forbidden backfill.
 *   - supersedes/superseded-by is DEFERRED (§8) to the first real correction event and will be
 *     generalized from the deadline-rule revision design; no back-pointer column is added now.
 *
 * This is the single source of the authority-type vocabulary — schema.ts imports
 * AUTHORITY_TYPE_VALUES from here for the mysqlEnum column.
 */

import { z } from 'zod';

// Legal-authority taxonomy (distinct from source_authority's authorityOrigin artifact-tier enum).
export const AUTHORITY_TYPE_VALUES = [
  'statute',
  'regulation',
  'case',
  'constitutional',
  'secondary',
  'other',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPE_VALUES)[number];

// date-only ('YYYY-MM-DD') strings via date('col', { mode: 'string' }).
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const AuthoritySourceRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jurisdiction: z.string(),
  authorityType: z.enum(AUTHORITY_TYPE_VALUES),
  citationText: z.string(), // the pinned citation — never null (a registry row is its citation)
  pinpoint: z.string().nullable(),
  sourceUrlOrLocation: z.string().nullable(),
  sourceSnapshotHash: z.string().nullable(),
  effectiveDate: DATE.nullable(),
  lastCheckedDate: DATE.nullable(),
  reviewByDate: DATE.nullable(),
  checkedBy: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AuthoritySourceRow = z.infer<typeof AuthoritySourceRowSchema>;
