/**
 * Zod schema for the document_party join table — DOC-CLIENT-TARGET-1.
 *
 * Ch 35.1 Zod Wall: every read of document_party parses through this. A binding row associates a
 * document instance with a matter party in a declared ROLE. The role LABEL is NOT stored here — it
 * derives from the document-type config (src/shared/docTypes/docTypeConfig.ts); provenance comes from
 * the config-version snapshot at finalize. userId + matterId are denormalized for owner-scoping /
 * matter-scoped reads (every table in this repo is owner-scoped via userId). The disposition's logical
 * key (documentId, partyId, roleKey) is enforced by a UNIQUE index; the table keeps the repo's `id` PK.
 *
 * Governing record: _brand/DOC-CLIENT-TARGET-1_consolidated_disposition_2026-06-09.md §3.1 (LOCKED).
 */

import { z } from 'zod';

export const DocumentPartyRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  partyId: z.string().uuid(),
  // roleKey: a string validated at WRITE against the document type's declared roles (no DB enum, so a
  // new role needs no migration). A read just carries whatever was stored.
  roleKey: z.string(),
  sortOrder: z.number().int(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
});
export type DocumentPartyRow = z.infer<typeof DocumentPartyRowSchema>;
