/**
 * DOC-CLIENT-TARGET-1 Inc 2/3 — resolve a document's drafting subject scope (DB composition).
 *
 * Composes the document_party bindings with the matter's parties to answer, for a TARGETED document
 * (individual_subject or party_set), WHO it is for — the name(s) to draft for + (individual only) the
 * other clients to exclude. Lives above the query layer (imports both the documentParty and
 * matterParties query modules) so neither query module gains a cross-import.
 *
 * Consumed by document.generateDraft / .regenerate (identity-layer scoping) and document.finalize (the
 * §6 target-consistency backstop — which gates on `kind === 'individual_subject'`). `mustBindFirst`
 * lets generateDraft block an individual document that has matter clients but no bound subject.
 */

import { listDocumentParties } from '../db/queries/documentParty.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';

export interface DraftingSubjectScope {
  /** What kind of targeting applies — drives the prompt wording AND the finalize §6 gate. */
  kind: 'individual_subject' | 'party_set' | 'none';
  /** True iff there is a resolvable identity to draft for. */
  scoped: boolean;
  /** individual: the bound subject's name; party_set: the joined bound-party set; null when unbound. */
  subjectName: string | null;
  /** The role's human label ("Principal" / "Testator" / "Settlor"). */
  subjectRoleLabel: string;
  /** individual: the matter's OTHER client names (to exclude); party_set: [] (it is for the set). */
  otherClientNames: string[];
  /** individual_subject doc that HAS matter clients but NO bound subject — generation must block. */
  mustBindFirst: boolean;
}

/**
 * The system-prompt scoping instruction for a resolved scope (verb = "draft" | "revise"), or null when
 * the document is not scoped. individual_subject -> "for <name> only, exclude the other clients";
 * party_set -> "a joint instrument for <names> together".
 */
export function buildScopeInstruction(scope: DraftingSubjectScope, verb: 'draft' | 'revise'): string | null {
  if (!scope.scoped || !scope.subjectName) return null;
  if (scope.kind === 'party_set') {
    return `This document is a JOINT instrument FOR ${scope.subjectName} together as ${scope.subjectRoleLabel.toLowerCase()}s; ${verb} it for them jointly.`;
  }
  let instruction = `This document is FOR ${scope.subjectName} as the ${scope.subjectRoleLabel}; ${verb} it for ${scope.subjectName} only.`;
  if (scope.otherClientNames.length > 0) {
    instruction += ` Do NOT ${verb} it for, or import the individual choices of, any other client (${scope.otherClientNames.join(', ')}).`;
  }
  return instruction;
}

/** Grammatical name conjunction: "A", "A and B", "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export async function resolveDraftingSubjectScope(
  doc: { id: string; matterId: string; documentType: string },
  userId: string,
): Promise<DraftingSubjectScope> {
  const config = getDocTypeConfig(doc.documentType);
  const structure = config?.targetStructure;

  if (structure === 'individual_subject') {
    const roleLabel = config!.requiredRoles.find((r) => r.roleKey === 'subject')?.renderLabel ?? 'Principal';
    const bindings = await listDocumentParties(doc.id, userId);
    const subjectBinding = bindings.find((b) => b.roleKey === 'subject');
    const parties = await listPartiesForMatter(doc.matterId, userId);
    const clients = parties.filter((p) => p.role === 'client');

    if (!subjectBinding) {
      return {
        kind: 'individual_subject',
        scoped: false,
        subjectName: null,
        subjectRoleLabel: roleLabel,
        otherClientNames: clients.map((c) => c.displayName),
        mustBindFirst: clients.length > 0,
      };
    }
    const subject = parties.find((p) => p.id === subjectBinding.partyId);
    const subjectName = subject?.displayName ?? null;
    return {
      kind: 'individual_subject',
      scoped: subjectName !== null,
      subjectName,
      subjectRoleLabel: roleLabel,
      otherClientNames: clients.filter((c) => c.id !== subjectBinding.partyId).map((c) => c.displayName),
      mustBindFirst: false,
    };
  }

  if (structure === 'party_set') {
    const requiredRole = config!.requiredRoles[0];
    const roleLabel = requiredRole?.renderLabel ?? 'Party';
    const roleKey = requiredRole?.roleKey;
    const bindings = await listDocumentParties(doc.id, userId);
    const parties = await listPartiesForMatter(doc.matterId, userId);
    const boundNames = bindings
      .filter((b) => roleKey !== undefined && b.roleKey === roleKey)
      .map((b) => parties.find((p) => p.id === b.partyId)?.displayName)
      .filter((n): n is string => n !== undefined);
    return {
      kind: 'party_set',
      scoped: boundNames.length > 0,
      subjectName: boundNames.length > 0 ? joinNames(boundNames) : null,
      subjectRoleLabel: roleLabel,
      otherClientNames: [],
      mustBindFirst: false,
    };
  }

  return {
    kind: 'none',
    scoped: false,
    subjectName: null,
    subjectRoleLabel: 'Principal',
    otherClientNames: [],
    mustBindFirst: false,
  };
}
