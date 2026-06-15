/**
 * matterPurge.ts — LLN-PROD-CLEANUP-1: complete, cascading purge of a matter and ALL of its related
 * rows. Built so that purging a (synthetic/test) matter leaves NOTHING orphaned and — critically for a
 * conflicts system — NO phantom `matter_parties` rows that would keep getting screened against real
 * matters (`listOtherPartiesForOwner`). The bare matters-row-only delete does NOT do this.
 *
 * DELETEMATTER-ORPHAN-1: the owner-scoped, children-first cascade is extracted into the shared
 * `cascadeDeleteMatterChildren` helper, called by BOTH `purgeMatter` (operator-gated preview/apply, which
 * destroys EVERYTHING) and the everyday `deleteMatterCascade` (the user-facing `matter.delete`). The
 * everyday delete passes EVERYDAY_DELETE_PRESERVE, so it cleans up client work-product (leaving no
 * orphans) but RETAINS the matter's permanent audit/posture Matter Record + the GLBA egress log — only
 * the operator-gated purge removes those. One cascade definition (the one the LLN-PROD-CLEANUP-1 coverage
 * test guards), no drift risk.
 *
 * DESTRUCTIVE + IRREVERSIBLE. purgeMatter execution is operator-gated: always run `dryRun: true` first
 * (returns per-table row COUNTS, writes nothing) for an approval preview, then `dryRun: false` to apply.
 * Owner-scoped throughout (Ch 35.2); each matter is purged/deleted in its own transaction (atomic).
 *
 * COVERAGE (every matter-scoped table; verified against schema.ts — see r2 cleanup test that
 * cross-checks this list against every table carrying a `matterId` column so a future matter-scoped
 * table can't be silently missed):
 *   - children of the matter's DOCUMENTS (by documentId): versions, documentOutlines, feedback,
 *     feedbackEvaluations, feedbackManualSelections, reviewSessions; documentReferences (source/ref).
 *   - children of the matter's INFORMATION REQUESTS (by informationRequestId): informationRequestItems.
 *   - children of the matter's DEADLINES (by matterDeadlineId): tickler (FOLD-PM-1).
 *   - direct matterId rows: jobs, matterMaterials, informationRequests, lockedDecisions, adoptLedger,
 *     auditEvents, sourceAuthority, openItems, provisionProvenance, lddKeyTerm, closurePackageItem,
 *     sendabilityOverride, sendabilityEvaluation, matterParties, conflictChecks, conflictHits,
 *     matterAnalysis, kbAdoptions, matterDeadline (FOLD-PM-1), documentParty (DOC-CLIENT-TARGET-1),
 *     gateOverride (CONFLICT-GATE-OVERRIDE-1), promptSnapshots (INSTR-1A0), postureProvenance
 *     (CHAT-UI-1 W2), matterDeliverable (FOLD-PM-4), materialExtraction (FOLD-PM-2), documents — then
 *     the `matters` row itself.
 *
 * DELIBERATELY EXCLUDED (not matter-scoped): telemetry_events (analytics log; nullable matterId),
 * kb_events (KB-level, no matterId), templates / template_versions / template_variable_schemas
 * (firm-level shared), reusable_artifacts + pa_instruction_profiles + practice_memos (owner/PA-level),
 * users / user_preferences. There are NO DB-level FK constraints (relations are app-level), so the
 * children-first ordering below is for clean, attributable counts, not FK satisfaction.
 */
import { sql, and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../connection.js';
import { ownerScope } from '../ownerScope.js';
import {
  matters,
  documents,
  versions,
  documentOutlines,
  documentReferences,
  feedback,
  feedbackEvaluations,
  feedbackManualSelections,
  reviewSessions,
  informationRequests,
  informationRequestItems,
  jobs,
  matterMaterials,
  lockedDecisions,
  adoptLedger,
  auditEvents,
  sourceAuthority,
  openItems,
  provisionProvenance,
  lddKeyTerm,
  closurePackageItem,
  sendabilityOverride,
  sendabilityEvaluation,
  matterParties,
  conflictChecks,
  conflictHits,
  matterAnalysis,
  kbAdoptions,
  matterDeadline,
  tickler,
  documentParty,
  gateOverride,
  promptSnapshots,
  postureProvenance,
  reviewerLanes,
  chatConversations,
  chatMessages,
  chatSummaries,
  chatEgressEvents,
  chatAttachments,
  chatAttachmentParty,
  matterDeliverable,
  materialExtraction,
} from '../schema.js';

export interface MatterPurgeResult {
  matterId: string;
  found: boolean; // the matter exists AND is owned by userId
  dryRun: boolean;
  counts: Record<string, number>; // rows deleted (or, in dryRun, that WOULD be deleted) per table
  total: number; // total rows across all tables, EXCLUDING the matters row itself
}

// The transaction handle drizzle hands to a `db.transaction(async (tx) => ...)` callback. Derived from
// the live `db` type so the shared cascade helper can be invoked inside any matter transaction (and
// driven by a fake tx in unit tests) without importing drizzle's internal generics.
type MatterTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * cascadeDeleteMatterChildren — the SINGLE owner-scoped, children-first cascade shared by purgeMatter
 * and deleteMatterCascade. Counts every matter-scoped child table and, unless `dryRun`, deletes it.
 * Returns per-table counts + the grand total (EXCLUDING the `matters` row itself — each caller removes
 * that row). Owner-scoped on every read and delete (Ch 35.2); never touches another owner's rows. Must
 * run inside a transaction (the caller's) so the whole removal is atomic. Coverage of this table list is
 * guarded by lln_prod_cleanup_1_purge.test.ts (a future matter-scoped table can't be silently missed).
 */
export async function cascadeDeleteMatterChildren(
  tx: MatterTx,
  matterId: string,
  userId: string,
  opts: { dryRun: boolean; preserve?: ReadonlySet<string> },
): Promise<{ counts: Record<string, number>; total: number }> {
  const { dryRun, preserve } = opts;
  const counts: Record<string, number> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step = async (label: string, table: any, where: any): Promise<void> => {
    // DELETEMATTER-ORPHAN-1: a caller may PRESERVE specific classes (pass `preserve`). The everyday
    // matter.delete preserves the permanent audit/posture Matter Record + the GLBA egress-supervision
    // log (EVERYDAY_DELETE_PRESERVE); the operator-gated purge passes nothing, so it still removes
    // everything. A preserved class is left ENTIRELY untouched here — not counted, not deleted.
    if (preserve?.has(label)) return;
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(table).where(where);
    const n = Number(rows[0]?.n ?? 0) || 0;
    counts[label] = n;
    if (!dryRun && n > 0) {
      await tx.delete(table).where(where);
    }
  };

  // Resolve the matter's document + information-request ids (owner-scoped) for the child deletes.
  const docRows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.matterId, matterId), ownerScope(documents.userId, userId)));
  const docIds = docRows.map((r) => r.id);
  const reqRows = await tx
    .select({ id: informationRequests.id })
    .from(informationRequests)
    .where(and(eq(informationRequests.matterId, matterId), ownerScope(informationRequests.userId, userId)));
  const reqIds = reqRows.map((r) => r.id);
  // FOLD-PM-1: the matter's DEADLINE ids, for the tickler child delete (tickler is keyed by
  // matterDeadlineId, not matterId, so it is a deadline-child like versions are a document-child).
  const deadlineRows = await tx
    .select({ id: matterDeadline.id })
    .from(matterDeadline)
    .where(and(eq(matterDeadline.matterId, matterId), ownerScope(matterDeadline.userId, userId)));
  const deadlineIds = deadlineRows.map((r) => r.id);

  // 1) Children of the matter's DOCUMENTS (by documentId). Guard empty id lists (inArray([]) ).
  if (docIds.length > 0) {
    await step('versions', versions, inArray(versions.documentId, docIds));
    await step('documentOutlines', documentOutlines, inArray(documentOutlines.documentId, docIds));
    await step('feedbackManualSelections', feedbackManualSelections, inArray(feedbackManualSelections.documentId, docIds));
    await step('feedbackEvaluations', feedbackEvaluations, inArray(feedbackEvaluations.documentId, docIds));
    await step('feedback', feedback, inArray(feedback.documentId, docIds));
    await step('reviewSessions', reviewSessions, inArray(reviewSessions.documentId, docIds));
    await step(
      'documentReferences',
      documentReferences,
      or(inArray(documentReferences.sourceDocumentId, docIds), inArray(documentReferences.referencedDocumentId, docIds)),
    );
  } else {
    for (const l of ['versions', 'documentOutlines', 'feedbackManualSelections', 'feedbackEvaluations', 'feedback', 'reviewSessions', 'documentReferences']) counts[l] = 0;
  }

  // 2) Children of the matter's INFORMATION REQUESTS (by informationRequestId).
  if (reqIds.length > 0) {
    await step('informationRequestItems', informationRequestItems, inArray(informationRequestItems.informationRequestId, reqIds));
  } else {
    counts['informationRequestItems'] = 0;
  }

  // 2b) Children of the matter's DEADLINES (by matterDeadlineId): tickler (FOLD-PM-1). Deleted before
  // matter_deadline below so no tickler is orphaned.
  if (deadlineIds.length > 0) {
    await step('tickler', tickler, inArray(tickler.matterDeadlineId, deadlineIds));
  } else {
    counts['tickler'] = 0;
  }

  // 3) Direct matterId rows (owner-scoped). Children-before-parent ordering (no FK constraints exist).
  const byMatter = (table: { matterId: unknown; userId: unknown }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    and(eq(table.matterId as any, matterId), ownerScope(table.userId as any, userId));
  await step('informationRequests', informationRequests, byMatter(informationRequests));
  await step('matterMaterials', matterMaterials, byMatter(matterMaterials));
  await step('conflictHits', conflictHits, byMatter(conflictHits));
  await step('conflictChecks', conflictChecks, byMatter(conflictChecks));
  await step('matterParties', matterParties, byMatter(matterParties));
  await step('matterAnalysis', matterAnalysis, byMatter(matterAnalysis));
  await step('lockedDecisions', lockedDecisions, byMatter(lockedDecisions));
  await step('adoptLedger', adoptLedger, byMatter(adoptLedger));
  await step('openItems', openItems, byMatter(openItems));
  await step('sourceAuthority', sourceAuthority, byMatter(sourceAuthority));
  await step('provisionProvenance', provisionProvenance, byMatter(provisionProvenance));
  await step('lddKeyTerm', lddKeyTerm, byMatter(lddKeyTerm));
  await step('closurePackageItem', closurePackageItem, byMatter(closurePackageItem));
  await step('sendabilityOverride', sendabilityOverride, byMatter(sendabilityOverride));
  await step('sendabilityEvaluation', sendabilityEvaluation, byMatter(sendabilityEvaluation));
  await step('gateOverride', gateOverride, byMatter(gateOverride)); // CONFLICT-GATE-OVERRIDE-1
  // INSTR-1A0: per-draft-job prompt snapshots — their legacy-path systemText embeds matter-derived
  // content (matter state, PA profile), so they purge with the matter. matterId is nullable on the
  // table, but every draft-job row carries it; owner-scoped like every other step.
  await step('promptSnapshots', promptSnapshots, byMatter(promptSnapshots));
  await step('kbAdoptions', kbAdoptions, byMatter(kbAdoptions));
  await step('matterDeadline', matterDeadline, byMatter(matterDeadline)); // after its tickler children above
  await step('jobs', jobs, byMatter(jobs));
  await step('auditEvents', auditEvents, byMatter(auditEvents));
  // CHAT-UI-1 W2: the matter's posture-provenance audit ledger. Purged WITH the matter, exactly as
  // auditEvents is — "permanent retention" governs in-operation immutability (no row update/delete),
  // not survival of an operator-gated full-matter purge. Owner-scoped like every other step.
  await step('postureProvenance', postureProvenance, byMatter(postureProvenance));
  await step('reviewerLanes', reviewerLanes, byMatter(reviewerLanes));
  // FOLD-PM-4: the matter's deliverables (to-do list). Owner+matter-scoped child data; purges WITH the
  // matter so an (operator-gated, synthetic/test) purge leaves no orphan.
  await step('matterDeliverable', matterDeliverable, byMatter(matterDeliverable));
  // FOLD-PM-2: the matter's document-type structured extractions (children of materials; carry matterId).
  await step('materialExtraction', materialExtraction, byMatter(materialExtraction));
  // CHAT-COPILOT-1 (Inc 1): the matter's persisted chat copilot — messages + summaries (conversation
  // children, both carry matterId) before the conversations themselves. All purge WITH the matter (the
  // app-level cascade that stands in for a DB FK; an operator-gated full-matter purge overrides the
  // per-conversation legal-hold/retention flag, exactly as it overrides auditEvents/postureProvenance).
  await step('chatMessages', chatMessages, byMatter(chatMessages));
  await step('chatSummaries', chatSummaries, byMatter(chatSummaries));
  await step('chatConversations', chatConversations, byMatter(chatConversations));
  // CHAT-COPILOT-2 (Increment A): the matter's egress audit log. Append-only + "outlives the matter"
  // governs IN-OPERATION immutability (no row update/delete; survives matter closure/retention) — NOT
  // survival of an operator-gated full-matter purge, exactly as auditEvents / postureProvenance / chat
  // tables above. Purged WITH the matter so an (operator-gated, synthetic/test) purge leaves no orphan.
  await step('chatEgressEvents', chatEgressEvents, byMatter(chatEgressEvents));
  // CHAT-COPILOT-2 A2: the matter's ephemeral chat attachments + their party attributions. A full
  // operator-gated matter purge overrides provenance-pinning, exactly as it overrides the chat tables.
  await step('chatAttachmentParty', chatAttachmentParty, byMatter(chatAttachmentParty));
  await step('chatAttachments', chatAttachments, byMatter(chatAttachments));
  // DOC-CLIENT-TARGET-1: document_party bindings (a child of documents; also carries matterId). Delete
  // before documents so no binding row is orphaned by the purge.
  await step('documentParty', documentParty, byMatter(documentParty));
  await step('documents', documents, byMatter(documents)); // after its children above

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

/**
 * Purge one matter. dryRun=true counts only (no writes). Returns per-table counts. Owner-scoped.
 * Idempotent: a second run finds nothing (counts all 0, found=false once the matters row is gone).
 */
export async function purgeMatter(
  matterId: string,
  userId: string,
  opts: { dryRun: boolean },
): Promise<MatterPurgeResult> {
  const { dryRun } = opts;

  return db.transaction(async (tx) => {
    // Matter must exist + be owned. If not, nothing to purge (idempotent).
    const matterRows = await tx
      .select({ id: matters.id })
      .from(matters)
      .where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
    if (matterRows.length === 0) {
      return { matterId, found: false, dryRun, counts: {}, total: 0 };
    }

    // The shared owner-scoped, children-first cascade (counts; deletes unless dryRun).
    const { counts, total } = await cascadeDeleteMatterChildren(tx, matterId, userId, { dryRun });

    // Finally the matters row itself (not counted in `total`).
    if (!dryRun) {
      await tx.delete(matters).where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
    }

    return { matterId, found: true, dryRun, counts, total };
  });
}

/**
 * EVERYDAY_DELETE_PRESERVE — DELETEMATTER-ORPHAN-1: the matter-scoped classes the user-facing
 * matter.delete must NOT destroy (operator-affirmed records-management posture, 2026-06-15). These are
 * the matter's PERMANENT records, retained for compliance even after the matter itself is deleted:
 *   - auditEvents       — FOLD-GOV-1a immutable Matter Record; retentionPolicy declares it deletable:false.
 *   - postureProvenance — CHAT-UI-1 W2 permanent posture-provenance ledger (part of the Matter Record).
 *   - chatEgressEvents  — GLBA vendor-oversight egress log (SUPERVISION-VIEW-1; read owner-scoped, so it
 *                         stays visible in the supervision history after the matter is gone).
 * The everyday delete leaves these in place (matter-detached but retained); ONLY the operator-gated
 * purgeMatter (which passes no preserve set) destroys them. Legal-held chat conversations are handled
 * upstream by the procedure (it refuses the delete), mirroring canDeleteConversation.
 */
export const EVERYDAY_DELETE_PRESERVE: ReadonlySet<string> = new Set([
  'auditEvents',
  'postureProvenance',
  'chatEgressEvents',
]);

/**
 * deleteMatterCascade — DELETEMATTER-ORPHAN-1: the everyday `matter.delete` (after the procedure's
 * "no active documents" AND "no legal-held conversation" gates). Cascades the matter's client
 * WORK-PRODUCT child rows (documents + their children, materials, conflicts, chat-copilot content +
 * ephemeral attachments, deliverables, extractions, drafting/provenance artifacts, etc.) so an ordinary
 * delete leaves no orphaned working data — while PRESERVING the matter's permanent records
 * (EVERYDAY_DELETE_PRESERVE: the audit/posture Matter Record + the GLBA egress log). It then removes the
 * matters row, all in ONE transaction, so a mid-cascade failure rolls back and nothing is left
 * half-deleted. Unlike purgeMatter this is NOT operator-gated and has NO dryRun preview, so it
 * deliberately does NOT destroy the permanent / append-only ledgers — the operator-gated purge is the
 * only path that removes those. Owner-scoped throughout; never deletes another owner's rows.
 */
export async function deleteMatterCascade(matterId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await cascadeDeleteMatterChildren(tx, matterId, userId, { dryRun: false, preserve: EVERYDAY_DELETE_PRESERVE });
    await tx.delete(matters).where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
  });
}
