/**
 * DOC-CLIENT-TARGET-1 Inc 5 — retroactive document-targeting migration (disposition §7).
 *
 * Documents created before this feature have NO document_party bindings. This backfills them, reusing
 * the SAME pure resolvers the create flow uses (single source of truth):
 *   - single-client matter, individual doc  -> bind the sole client as subject (SAFE, unambiguous).
 *   - multi-client matter, individual doc    -> do NOT auto-assign (no high-confidence signal here);
 *                                               FLAG it unresolved (the SUBJECT_NOT_BOUND guard already
 *                                               blocks its generation; the sticky header warns).
 *   - party_set (joint) doc                  -> bind the clients present at migration as the role set.
 * Idempotent: a doc that already has the relevant binding is skipped.
 *
 * EXECUTION IS OPERATOR-GATED (it WRITES when dryRun=false): the document.migrateTargeting procedure runs
 * dryRun=true first (preview: counts + candidates, NO writes) for review/approval, then dryRun=false to
 * apply. Mirrors the R2-PRE-CONFLICT-1 client-party migration pattern. Composes the owner-scoped query
 * wrappers above the query layer (no new owner-scope chokepoint; no import cycle).
 */

import { listMatters } from '../db/queries/matters.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { listDocumentsForMatter } from '../db/queries/documents.js';
import { listDocumentParties, bindDocumentParty } from '../db/queries/documentParty.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';
import { resolveIndividualSubject, resolvePartySetBinding } from './subjectBinding.js';

export type TargetingMigrationAction =
  | 'backfill_individual_subject'
  | 'backfill_party_set'
  | 'flag_unresolved_multi_client';

export interface TargetingMigrationCandidate {
  matterId: string;
  documentId: string;
  documentType: string;
  action: TargetingMigrationAction;
  detail: string;
}

export interface TargetingMigrationResult {
  dryRun: boolean;
  scannedMatters: number;
  scannedDocuments: number;
  backfilled: number;
  unresolved: number;
  candidates: TargetingMigrationCandidate[];
}

export async function migrateDocumentTargetingForOwner(
  userId: string,
  opts: { dryRun: boolean },
): Promise<TargetingMigrationResult> {
  const allMatters = await listMatters(userId, { includeArchived: true });
  const candidates: TargetingMigrationCandidate[] = [];
  let backfilled = 0;
  let unresolved = 0;
  let scannedDocuments = 0;

  for (const m of allMatters) {
    const clientIds = (await listPartiesForMatter(m.id, userId)).filter((p) => p.role === 'client').map((p) => p.id);
    const docs = await listDocumentsForMatter(m.id, userId, { includeArchived: false });

    for (const d of docs) {
      scannedDocuments++;
      const config = getDocTypeConfig(d.documentType);
      if (!config) continue;
      const bindings = await listDocumentParties(d.id, userId);

      if (config.targetStructure === 'individual_subject') {
        if (bindings.some((b) => b.roleKey === 'subject')) continue; // already bound — idempotent
        const res = resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: clientIds });
        if (res.kind === 'bind') {
          candidates.push({ matterId: m.id, documentId: d.id, documentType: d.documentType, action: 'backfill_individual_subject', detail: 'single-client subject backfill (safe)' });
          backfilled++;
          if (!opts.dryRun) {
            await bindDocumentParty({ userId, matterId: m.id, documentId: d.id, partyId: res.partyId, roleKey: 'subject', createdBy: userId });
            await recordAuditEvent({
              userId, matterId: m.id, documentId: d.id, eventType: 'disposition', actor: 'system',
              summary: `Backfilled subject binding (single-client) for ${d.documentType}`,
              targetType: 'document_party', targetId: res.partyId, action: 'migrate_document_subject', scope: 'matter',
              payload: { documentType: d.documentType },
            });
          }
        } else if (res.kind === 'error' && res.code === 'SUBJECT_REQUIRED') {
          // multi-client: never auto-assign — flag for the attorney's affirmative pick.
          candidates.push({ matterId: m.id, documentId: d.id, documentType: d.documentType, action: 'flag_unresolved_multi_client', detail: 'multi-client individual doc needs an attorney principal pick' });
          unresolved++;
        }
        // res.kind === 'none' (zero clients) -> nothing to bind; skip.
      } else if (config.targetStructure === 'party_set') {
        const roleKey = config.requiredRoles[0]?.roleKey;
        if (roleKey !== undefined && bindings.some((b) => b.roleKey === roleKey)) continue; // already bound
        const ps = resolvePartySetBinding({ targetStructure: 'party_set', requiredRoleKey: roleKey, clientPartyIds: clientIds });
        if (ps) {
          candidates.push({ matterId: m.id, documentId: d.id, documentType: d.documentType, action: 'backfill_party_set', detail: `bind ${ps.partyIds.length} client(s) as ${ps.roleKey}` });
          backfilled++;
          if (!opts.dryRun) {
            let sortOrder = 0;
            for (const partyId of ps.partyIds) {
              await bindDocumentParty({ userId, matterId: m.id, documentId: d.id, partyId, roleKey: ps.roleKey, sortOrder: sortOrder++, createdBy: userId });
            }
            await recordAuditEvent({
              userId, matterId: m.id, documentId: d.id, eventType: 'disposition', actor: 'system',
              summary: `Backfilled party_set binding for ${d.documentType}`,
              targetType: 'document_party', targetId: d.id, action: 'migrate_document_party_set', scope: 'matter',
              payload: { documentType: d.documentType, roleKey: ps.roleKey, count: ps.partyIds.length },
            });
          }
        }
      }
    }
  }

  return { dryRun: opts.dryRun, scannedMatters: allMatters.length, scannedDocuments, backfilled, unresolved, candidates };
}
