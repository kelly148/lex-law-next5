/**
 * Zod schema for the closure_package_item table — FOLD-DRAFT-1 / package (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: every read of closure_package_item parses through this schema.
 *
 * The "closing package": per matter, the artifacts (documents / materials / sources) plus checklist
 * items gathered into a named, self-contained bundle for hand-off / closure — each marked required
 * vs optional and present / missing / not-applicable. A "package" is the set of rows sharing
 * (matterId, packageName). DEFAULT-SAFE / ADVISORY: this records + surfaces what the package
 * contains and (a later increment) computes a completeness check; it NEVER finalizes, sends, or
 * locks anything (sending is FOLD-SEND-1). The attorney is the decision-maker. `recordedBy`
 * distinguishes an attorney entry from a system one. Enum literals are inlined here (repo
 * convention); the Drizzle column enums live in schema.ts (CLOSURE_PACKAGE_*_VALUES). The
 * itemType<->refId invariant is enforced at record time by a later increment, not by this schema.
 */

import { z } from 'zod';

export const ClosurePackageItemRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  // Groups items into a named package (the package is the set of rows sharing matterId+packageName).
  packageName: z.string(),
  // What kind of thing this item is.
  itemType: z.enum(['document', 'material', 'source', 'checklist']),
  // The document/material/source id (NULL for a free-form checklist item). Not constrained to UUID.
  refId: z.string().nullable(),
  label: z.string(),
  // Whether this item is required for the package to be considered complete.
  requirement: z.enum(['required', 'optional']),
  // The attorney/system assessment of whether the item is in hand.
  status: z.enum(['present', 'missing', 'not_applicable']),
  notes: z.string().nullable(),
  // Attorney attribution vs a system one (default-safe; never an auto-assertion of completeness).
  recordedBy: z.enum(['attorney', 'system']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ClosurePackageItemRow = z.infer<typeof ClosurePackageItemRowSchema>;
export type ClosurePackageItemType = ClosurePackageItemRow['itemType'];
export type ClosurePackageRequirement = ClosurePackageItemRow['requirement'];
export type ClosurePackageItemStatus = ClosurePackageItemRow['status'];
export type ClosurePackageRecordedBy = ClosurePackageItemRow['recordedBy'];
