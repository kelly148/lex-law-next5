/**
 * matterPurge.ts — LLN-PROD-CLEANUP-1: complete, cascading purge of a matter and ALL of its related
 * rows. Built so that purging a (synthetic/test) matter leaves NOTHING orphaned and — critically for a
 * conflicts system — NO phantom `matter_parties` rows that would keep getting screened against real
 * matters (`listOtherPartiesForOwner`). The bare `deleteMatter` (matters row only) does NOT do this.
 *
 * DESTRUCTIVE + IRREVERSIBLE. Execution is operator-gated: always run `dryRun: true` first (returns
 * per-table row COUNTS, writes nothing) for an approval preview, then `dryRun: false` to apply.
 * Owner-scoped throughout (Ch 35.2); each matter is purged in its own transaction (atomic per matter).
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
 *     (CHAT-UI-1 W2), documents — then the `matters` row itself.
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
} from '../schema.js';

export interface MatterPurgeResult {
  matterId: string;
  found: boolean; // the matter exists AND is owned by userId
  dryRun: boolean;
  counts: Record<string, number>; // rows deleted (or, in dryRun, that WOULD be deleted) per table
  total: number; // total rows across all tables, EXCLUDING the matters row itself
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
    const counts: Record<string, number> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const step = async (label: string, table: any, where: any): Promise<void> => {
      const rows = await tx.select({ n: sql<number>`count(*)` }).from(table).where(where);
      const n = Number(rows[0]?.n ?? 0) || 0;
      counts[label] = n;
      if (!dryRun && n > 0) {
        await tx.delete(table).where(where);
      }
    };

    // Matter must exist + be owned. If not, nothing to purge (idempotent).
    const matterRows = await tx
      .select({ id: matters.id })
      .from(matters)
      .where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
    if (matterRows.length === 0) {
      return { matterId, found: false, dryRun, counts: {}, total: 0 };
    }

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
    // DOC-CLIENT-TARGET-1: document_party bindings (a child of documents; also carries matterId). Delete
    // before documents so no binding row is orphaned by the purge.
    await step('documentParty', documentParty, byMatter(documentParty));
    await step('documents', documents, byMatter(documents)); // after its children above

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // 4) Finally the matters row itself (not counted in `total`).
    if (!dryRun) {
      await tx.delete(matters).where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
    }

    return { matterId, found: true, dryRun, counts, total };
  });
}
