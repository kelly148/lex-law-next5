/**
 * DOC-CLIENT-TARGET-1 Inc 2 — pure subject-resolution for the individual_subject flow.
 *
 * Decides, at document-create time, WHICH party (if any) to bind as the `subject` of an individual
 * instrument, from the document type's targetStructure + the matter's client parties + an optional
 * attorney pick. The malpractice-grade rule (disposition §4.2): a multi-client matter REQUIRES an
 * affirmative pick (no pre-selection — a pre-selected first client is how the wrong name reaches a
 * POA); a single-client matter AUTO-BINDS the sole client. Pure + unit-tested; the procedure does the
 * DB read (client party ids) and the bind.
 */

import type { TargetStructure } from '../../shared/docTypes/docTypeConfig.js';

export type SubjectResolution =
  | { kind: 'bind'; partyId: string }
  | { kind: 'none' }
  | { kind: 'error'; code: 'SUBJECT_REQUIRED' | 'SUBJECT_NOT_A_CLIENT_PARTY'; message: string };

/**
 * Resolve the subject binding for a new document.
 *   - non-individual_subject type            -> { none }  (party_set/role_sided/derived handled elsewhere)
 *   - a pick was provided + it is a client    -> { bind } that party
 *   - a pick was provided but NOT a client    -> { error: SUBJECT_NOT_A_CLIENT_PARTY }
 *   - no pick, exactly one client             -> { bind } the sole client (auto-bind, show-don't-ask)
 *   - no pick, two or more clients            -> { error: SUBJECT_REQUIRED } (mandatory affirmative pick)
 *   - no pick, zero clients                   -> { none }  (nothing to bind; generation/finalize guards
 *                                                            catch an unbound individual doc later)
 */
export function resolveIndividualSubject(opts: {
  targetStructure: TargetStructure | undefined;
  clientPartyIds: readonly string[];
  providedSubjectPartyId?: string | undefined;
}): SubjectResolution {
  const { targetStructure, clientPartyIds, providedSubjectPartyId } = opts;
  if (targetStructure !== 'individual_subject') return { kind: 'none' };

  if (providedSubjectPartyId) {
    if (!clientPartyIds.includes(providedSubjectPartyId)) {
      return {
        kind: 'error',
        code: 'SUBJECT_NOT_A_CLIENT_PARTY',
        message: 'The selected principal is not a client party of this matter.',
      };
    }
    return { kind: 'bind', partyId: providedSubjectPartyId };
  }

  if (clientPartyIds.length === 1) return { kind: 'bind', partyId: clientPartyIds[0]! };
  if (clientPartyIds.length >= 2) {
    return {
      kind: 'error',
      code: 'SUBJECT_REQUIRED',
      message:
        'This is an individual document in a multi-client matter — choose which client is the principal (no default is assumed).',
    };
  }
  return { kind: 'none' };
}
