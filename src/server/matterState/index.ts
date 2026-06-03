/**
 * Matter-State Engine — FOLD-L1-1 (Layer-1).
 *
 * A READ-ONLY aggregation service that composes the existing owner-scoped persistence
 * pieces (locked decisions, adopt ledger, audit/matter record, source authority, open
 * items, documents/versions) into one typed MatterState answering, for a matter:
 * current-matter / operative-document / locked-decisions / adopted / unresolved /
 * source-currency / safe-to-send.
 *
 * The engine REPORTS state; it never decides, never auto-resolves, never auto-adopts,
 * never auto-sends (engine-reports-never-decides). NO new authority is introduced here —
 * it reads existing tables + the L1-1 tables.
 *
 * INTEGRITY INVARIANT (operator disposition item 2): every aggregated row's matterId
 * must resolve to a matter owned by the same userId. We fetch each list owner-AND-matter
 * scoped, then assert it again here as a single defense-in-depth guard against both
 * cross-matter AND cross-user leakage. "full raises the stake" — the same guard covers
 * all modes.
 *
 * Structure: getMatterState() does the (owner-scoped) I/O; assembleMatterState() is the
 * pure shaping core (invariant + counts + curation + mode projection + Zod-wall output),
 * exported so it can be unit-tested without a DB.
 *
 * L1-1 is data model + read contract ONLY: there is no injection of model_context into
 * model calls (that is FOLD-L1-2), no shared-context substrate (L1-3), no UI (L1-5).
 */

import { TRPCError } from '@trpc/server';
import { getMatterById } from '../db/queries/matters.js';
import { listDocumentsForMatter } from '../db/queries/documents.js';
import { getVersionById } from '../db/queries/versions.js';
import {
  listLockedDecisionsForMatter,
  listAdoptLedgerForMatter,
} from '../db/queries/phase4b.js';
import { listAuditEventsForMatter } from '../db/queries/auditEvents.js';
import {
  listSourceAuthorityForMatter,
  listOperativeSourcesForMatter,
} from '../db/queries/sourceAuthority.js';
import {
  listOpenItemsForMatter,
  countOpenBlockers,
} from '../db/queries/openItems.js';
import {
  MatterStateSchema,
  type MatterState,
  type MatterStateMode,
  type MatterIdentity,
  type OperativeDocument,
  type SafeToSend,
} from '../../shared/schemas/matterState.js';
import type { DocumentRow } from '../../shared/schemas/matters.js';
import type { OpenItemRow } from '../../shared/schemas/openItems.js';
import type { LockedDecisionRow, AdoptLedgerRow } from '../../shared/schemas/phase4b.js';
import type { SourceAuthorityRow } from '../../shared/schemas/sourceAuthority.js';
import type { AuditEventRow } from '../../shared/schemas/auditEvents.js';

/**
 * Integrity invariant guard. Throws if any aggregated row's owner or matter does not
 * match the requested (userId, matterId). A breach indicates a query-scoping bug — we
 * FAIL VISIBLY rather than return possibly-leaked state.
 */
export function assertMatterScoped(
  rows: ReadonlyArray<{ userId: string; matterId: string }>,
  matterId: string,
  userId: string,
  label: string,
): void {
  for (const row of rows) {
    if (row.userId !== userId || row.matterId !== matterId) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Matter-state integrity invariant violated in ${label}`,
      });
    }
  }
}

/**
 * safe-to-send posture, derived from open BLOCKER-severity open_items — no LLM call in
 * the read path. No registered items => no send-safety signal => 'unknown' (advisory
 * MR-CAL-8C remains the real-time classifier elsewhere); open blockers => 'blocked'.
 */
export function deriveSafeToSend(openBlockerCount: number, registryHasItems: boolean): SafeToSend {
  const posture = openBlockerCount > 0 ? 'blocked' : registryHasItems ? 'clear' : 'unknown';
  return { posture, openBlockerCount, derivedFrom: 'open_items' };
}

function curateOpenItem(item: OpenItemRow) {
  return {
    id: item.id,
    category: item.category,
    severity: item.severity,
    summary: item.summary,
    scope: (item.documentId ? 'document' : 'matter') as 'matter' | 'document',
  };
}

function docToOperative(doc: DocumentRow, currentVersionNumber: number | null): OperativeDocument {
  return {
    documentId: doc.id,
    title: doc.title,
    workflowState: doc.workflowState,
    currentVersionId: doc.currentVersionId ?? null,
    currentVersionNumber,
  };
}

/**
 * Pure shaping core: assert the invariant, compute counts, curate, project by mode, and
 * validate the output through the read-contract Zod wall. No I/O — fully unit-testable.
 */
export function assembleMatterState(input: {
  mode: MatterStateMode;
  matterId: string;
  userId: string;
  matter: MatterIdentity;
  operativeDocument: OperativeDocument | null;
  documentsForFull: OperativeDocument[];
  docsRaw: ReadonlyArray<{ userId: string; matterId: string }>;
  lockedDecisions: LockedDecisionRow[];
  adoptions: AdoptLedgerRow[];
  openItems: OpenItemRow[];
  sourceAuthorities: SourceAuthorityRow[];
  auditEvents: AuditEventRow[];
  operativeSources: SourceAuthorityRow[];
  openBlockerCount: number;
}): MatterState {
  const { mode, matterId, userId } = input;

  // INTEGRITY INVARIANT — assert every aggregated row resolves to this owner+matter.
  assertMatterScoped(input.docsRaw, matterId, userId, 'documents');
  assertMatterScoped(input.lockedDecisions, matterId, userId, 'locked_decisions');
  assertMatterScoped(input.adoptions, matterId, userId, 'adopt_ledger');
  assertMatterScoped(input.openItems, matterId, userId, 'open_items');
  assertMatterScoped(input.sourceAuthorities, matterId, userId, 'source_authority');
  assertMatterScoped(input.auditEvents, matterId, userId, 'audit_events');

  const activeLocked = input.lockedDecisions.filter((d) => d.status === 'active');
  const activeAdoptions = input.adoptions.filter((a) => a.status === 'active');
  const unresolvedAdoptions = input.adoptions.filter((a) => a.status === 'unresolved');
  const openOpenItems = input.openItems.filter((i) => i.status === 'open');

  const safeToSend = deriveSafeToSend(input.openBlockerCount, input.openItems.length > 0);

  const counts = {
    lockedDecisionsActive: activeLocked.length,
    adoptionsActive: activeAdoptions.length,
    adoptionsUnresolved: unresolvedAdoptions.length,
    openItemsOpen: openOpenItems.length,
    openBlockers: input.openBlockerCount,
    sourceAuthorities: input.sourceAuthorities.length,
    auditEvents: input.auditEvents.length,
  };

  let result: MatterState;
  if (mode === 'summary') {
    result = {
      mode: 'summary',
      matter: input.matter,
      operativeDocument: input.operativeDocument,
      counts,
      safeToSend,
    };
  } else if (mode === 'full') {
    result = {
      mode: 'full',
      matter: input.matter,
      operativeDocument: input.operativeDocument,
      counts,
      safeToSend,
      documents: input.documentsForFull,
      lockedDecisions: input.lockedDecisions,
      adoptions: input.adoptions,
      openItems: input.openItems,
      sourceAuthorities: input.sourceAuthorities,
      auditEvents: input.auditEvents,
    };
  } else {
    result = {
      mode: 'model_context',
      matter: input.matter,
      operativeDocument: input.operativeDocument,
      safeToSend,
      activeLockedDecisions: activeLocked.map((d) => ({
        id: d.id,
        summary: d.summary,
        rationale: d.rationale,
        origin: d.origin,
      })),
      carriedAdoptions: input.adoptions
        .filter((a) => a.status === 'active' || a.status === 'unresolved')
        .map((a) => ({
          id: a.id,
          adoptedText: a.adoptedText,
          disposition: a.disposition,
          status: a.status,
        })),
      openBlockers: openOpenItems.filter((i) => i.severity === 'blocker').map(curateOpenItem),
      openSubstantive: openOpenItems.filter((i) => i.severity === 'substantive').map(curateOpenItem),
      matterLevelItems: openOpenItems.filter((i) => i.documentId === null).map(curateOpenItem),
      operativeSources: input.operativeSources.map((s) => ({
        id: s.id,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        authorityOrigin: s.authorityOrigin,
        lifecycle: s.lifecycle,
        label: s.label,
      })),
    };
  }

  // Zod Wall on the read-contract OUTPUT — the engine never returns an unvalidated shape.
  return MatterStateSchema.parse(result);
}

/**
 * Compose the matter state. `mode` selects the projection (summary | full |
 * model_context). `documentId` optionally focuses the operative document (defaults to
 * the most-recently-created non-archived document). Owner-scoped: throws NOT_FOUND if the
 * matter is not owned by userId.
 */
export async function getMatterState(params: {
  matterId: string;
  userId: string;
  mode: MatterStateMode;
  documentId?: string;
}): Promise<MatterState> {
  const { matterId, userId, mode } = params;

  const matter = await getMatterById(matterId, userId);
  if (!matter) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  }

  const [docs, lockedDecisions, adoptions, openItems, sourceAuthorities, auditEvents, operativeSources, openBlockerCount] =
    await Promise.all([
      listDocumentsForMatter(matterId, userId),
      listLockedDecisionsForMatter(matterId, userId),
      listAdoptLedgerForMatter(matterId, userId),
      listOpenItemsForMatter(matterId, userId),
      listSourceAuthorityForMatter(matterId, userId),
      listAuditEventsForMatter(matterId, userId),
      listOperativeSourcesForMatter(matterId, userId),
      countOpenBlockers(matterId, userId),
    ]);

  const matterIdentity: MatterIdentity = {
    matterId: matter.id,
    title: matter.title,
    clientName: matter.clientName ?? null,
    practiceArea: matter.practiceArea ?? null,
    phase: matter.phase,
    archivedAt: matter.archivedAt ?? null,
  };

  // Operative document: the focused doc (if asked for and present) else the most-recently
  // created non-archived document (listDocumentsForMatter returns createdAt DESC).
  const focusDoc = params.documentId
    ? docs.find((d) => d.id === params.documentId) ?? null
    : docs[0] ?? null;
  let operativeDocument: OperativeDocument | null = null;
  if (focusDoc) {
    let versionNumber: number | null = null;
    if (focusDoc.currentVersionId) {
      const version = await getVersionById(focusDoc.currentVersionId, userId);
      versionNumber = version?.versionNumber ?? null;
    }
    operativeDocument = docToOperative(focusDoc, versionNumber);
  }

  return assembleMatterState({
    mode,
    matterId,
    userId,
    matter: matterIdentity,
    operativeDocument,
    documentsForFull: docs.map((d) => docToOperative(d, null)),
    docsRaw: docs,
    lockedDecisions,
    adoptions,
    openItems,
    sourceAuthorities,
    auditEvents,
    operativeSources,
    openBlockerCount,
  });
}
