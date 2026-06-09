/**
 * DOC-CLIENT-TARGET-1 Inc 2 — per-client document instances for a type (DB composition).
 *
 * For a matter + document type, returns one entry per CLIENT party: their existing document of that
 * type (bound to them as `subject`), or null if they don't have one yet. This single read powers both
 * the pair affordance (which other clients LACK a matching instance -> offer to create; which HAVE one
 * -> the duplicate guard) and the sticky drafting header ("Open the other client's version"). Composes
 * the documents + documentParty query modules above the query layer (no cross-import in either).
 */

import { listDocumentsForMatter } from '../db/queries/documents.js';
import { listDocumentParties } from '../db/queries/documentParty.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';

export interface TypeInstance {
  partyId: string;
  displayName: string;
  /** The client's existing (non-archived) document of this type, or null. */
  documentId: string | null;
  /** The existing document's workflowState (per-instance status; reuses the state engine), or null. */
  workflowState: string | null;
}

export async function getInstancesForType(
  matterId: string,
  documentType: string,
  userId: string,
): Promise<TypeInstance[]> {
  const clients = (await listPartiesForMatter(matterId, userId)).filter((p) => p.role === 'client');
  const docs = (await listDocumentsForMatter(matterId, userId, { includeArchived: false })).filter(
    (d) => d.documentType === documentType,
  );

  // Map partyId -> the document of this type bound to that party as `subject` (id + status).
  const docByParty = new Map<string, { id: string; workflowState: string }>();
  for (const d of docs) {
    const subject = (await listDocumentParties(d.id, userId)).find((b) => b.roleKey === 'subject');
    if (subject) docByParty.set(subject.partyId, { id: d.id, workflowState: d.workflowState });
  }

  return clients.map((c) => {
    const existing = docByParty.get(c.id);
    return {
      partyId: c.id,
      displayName: c.displayName,
      documentId: existing?.id ?? null,
      workflowState: existing?.workflowState ?? null,
    };
  });
}
