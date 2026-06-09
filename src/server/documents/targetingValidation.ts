/**
 * DOC-CLIENT-TARGET-1 Inc 5 — pre-finalize STRUCTURAL targeting validation (disposition §6 hard blocks).
 *
 * Complements the §6 text-consistency check (targetConsistency.ts) with the STRUCTURAL guarantees that
 * a targeted document is correctly bound before it can finalize/export:
 *   individual_subject -> exactly ONE subject, and (when subjectMustBeClient) that subject is an ACTIVE
 *     client of the matter (a soft-deleted / removed / non-client subject fails — listPartiesForMatter
 *     already excludes soft-deleted parties);
 *   party_set          -> at least one binding of the required role group (e.g. a settlor).
 * role_sided / derived / non_party_specific are not hard-validated in v1 (their UIs are fast-follow).
 * An unconfigured/custom type carries no structural targeting requirement in v1.
 *
 * Composes the documentParty + matterParties query modules above the query layer (no cross-import).
 */

import { listDocumentParties } from '../db/queries/documentParty.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';

export interface TargetingValidation {
  ok: boolean;
  code?: string;
  message?: string;
}

export async function validateTargetingForFinalize(
  doc: { id: string; matterId: string; documentType: string },
  userId: string,
): Promise<TargetingValidation> {
  const config = getDocTypeConfig(doc.documentType);
  if (!config) return { ok: true }; // unconfigured/custom — no structural targeting requirement in v1

  const bindings = await listDocumentParties(doc.id, userId);

  if (config.targetStructure === 'individual_subject') {
    const subjects = bindings.filter((b) => b.roleKey === 'subject');
    if (subjects.length === 0) {
      return { ok: false, code: 'NO_SUBJECT', message: 'This individual document has no bound subject.' };
    }
    if (subjects.length > 1) {
      return { ok: false, code: 'MULTIPLE_SUBJECTS', message: 'This individual document has more than one bound subject.' };
    }
    if (config.subjectMustBeClient) {
      // listPartiesForMatter excludes soft-deleted parties — a removed/inactive subject is not found.
      const parties = await listPartiesForMatter(doc.matterId, userId);
      const subjectParty = parties.find((p) => p.id === subjects[0]!.partyId);
      if (!subjectParty || subjectParty.role !== 'client') {
        return {
          ok: false,
          code: 'SUBJECT_NOT_ACTIVE_CLIENT',
          message: 'The bound subject is missing, removed, or not a client of this matter.',
        };
      }
    }
    return { ok: true };
  }

  if (config.targetStructure === 'party_set') {
    const requiredRole = config.requiredRoles[0];
    const roleKey = requiredRole?.roleKey;
    const bound = bindings.filter((b) => roleKey !== undefined && b.roleKey === roleKey);
    if (bound.length === 0) {
      return {
        ok: false,
        code: 'MISSING_ROLE_GROUP',
        message: `This joint document has no bound ${(requiredRole?.renderLabel ?? 'party').toLowerCase()}.`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}
