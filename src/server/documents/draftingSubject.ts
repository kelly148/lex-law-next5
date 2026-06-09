/**
 * DOC-CLIENT-TARGET-1 Inc 2 — resolve a document's drafting subject scope (DB composition).
 *
 * Composes the document_party bindings with the matter's parties to answer: for an individual_subject
 * document, WHO is the bound subject (the name to draft FOR), and who are the OTHER clients (to exclude
 * from the identity / to name in a consistency mismatch). Lives above the query layer (imports both the
 * documentParty and matterParties query modules) so neither query module gains a cross-import — the
 * party soft-delete guard already imports documentParty; documentParty must NOT import matterParties.
 *
 * Consumed by document.generateDraft / .regenerate (identity-layer scoping) and document.finalize (the
 * §6 target-consistency backstop). `mustBindFirst` lets generateDraft block an individual document that
 * has matter clients but no bound subject yet (pick the principal first).
 */

import { listDocumentParties } from '../db/queries/documentParty.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';

export interface DraftingSubjectScope {
  /** True iff this is an individual_subject document WITH a resolvable bound subject. */
  scoped: boolean;
  /** The bound subject's display name (the identity to draft for), or null. */
  subjectName: string | null;
  /** The subject role's human label ("Principal" / "Testator" / "Declarant"). */
  subjectRoleLabel: string;
  /** The matter's OTHER client display names (everyone but the subject). */
  otherClientNames: string[];
  /** individual_subject doc that HAS matter clients but NO bound subject — generation must block. */
  mustBindFirst: boolean;
}

export async function resolveDraftingSubjectScope(
  doc: { id: string; matterId: string; documentType: string },
  userId: string,
): Promise<DraftingSubjectScope> {
  const config = getDocTypeConfig(doc.documentType);
  const roleLabel = config?.requiredRoles.find((r) => r.roleKey === 'subject')?.renderLabel ?? 'Principal';

  if (config?.targetStructure !== 'individual_subject') {
    return { scoped: false, subjectName: null, subjectRoleLabel: roleLabel, otherClientNames: [], mustBindFirst: false };
  }

  const bindings = await listDocumentParties(doc.id, userId);
  const subjectBinding = bindings.find((b) => b.roleKey === 'subject');
  const parties = await listPartiesForMatter(doc.matterId, userId);
  const clients = parties.filter((p) => p.role === 'client');

  if (!subjectBinding) {
    return {
      scoped: false,
      subjectName: null,
      subjectRoleLabel: roleLabel,
      otherClientNames: clients.map((c) => c.displayName),
      // has clients but no subject bound -> the attorney must pick the principal before generating
      mustBindFirst: clients.length > 0,
    };
  }

  const subject = parties.find((p) => p.id === subjectBinding.partyId);
  const subjectName = subject?.displayName ?? null;
  const otherClientNames = clients.filter((c) => c.id !== subjectBinding.partyId).map((c) => c.displayName);

  return {
    scoped: subjectName !== null,
    subjectName,
    subjectRoleLabel: roleLabel,
    otherClientNames,
    mustBindFirst: false,
  };
}
