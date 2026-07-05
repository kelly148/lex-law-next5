/**
 * titleExam.ts — TITLE-EXAM-1 (T1) durable query layer for the title-examination data model.
 *
 * Thin, owner-scoped wrappers over the three additive title_exam_* tables (schema.ts). Mirrors the
 * expressDurableRecords.ts shape: pure helpers + exported writeXxxTx(tx, …) seams for mock-tx unit
 * tests + owner-scoped reads that route through ownerScope() (never an inline eq(...userId), per the
 * mr_fold_auth_2 CI ratchet).
 *
 * FORK-C: audit_events is the source of truth for attorney DECISIONS (T4/T6 write those). This layer
 * writes/reads only the operational STATE tables. DORMANT: nothing here runs unless TITLE_EXAM_ENABLED
 * is ON (default OFF) — the caller (the flag-gated titleExam router) is the gate; flag-off never calls
 * in, so no title_exam_* row is ever touched and the build is byte-neutral.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc, desc, sql } from 'drizzle-orm';
import { db } from '../connection.js';
import {
  titleExamMatterAttribute,
  titleExamSession,
  titleExamFinding,
  type TitleExamMatterAttribute,
  type TitleExamSession,
  type TitleExamFinding,
  type TitleExamNpiPosture,
  type TitleExamLaneMode,
  type TitleExamCompleteness,
  type TitleExamSessionStatus,
  type TitleExamLaneOrigin,
  type TitleExamSourceBasis,
  type TitleExamSendability,
  type TitleExamClassification,
  type TitleExamReconClass,
  type TitleExamEscalationState,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';

/** A Drizzle tx handle (or the pooled db) able to insert — mirrors expressDurableRecords.Executor. */
type Executor = Pick<typeof db, 'insert'>;

// ── §2 DC occasional-and-sporadic visibility ────────────────────────────────────────────────────
//
// The module "tracks DC exam counts to make this visible" (spec §2). This is a VISIBILITY nudge, NOT a
// legal determination: the occasional-and-sporadic line is a legal judgment the ATTORNEY makes. When the
// running DC exam count crosses this internal review-prompt threshold, the module surfaces the standing
// caveat for the attorney to re-examine the footing — it never blocks, decides, or asserts a legal line.
export const DC_EXAM_REVIEW_PROMPT_THRESHOLD = 12;

export interface DcExamVisibility {
  count: number;
  reviewPromptThreshold: number;
  /** True once the running DC count reaches the review-prompt threshold — surface the §2 caveat. */
  reviewPrompted: boolean;
}

/** Pure. Derive the §2 DC-exam visibility signal from a running count. */
export function deriveDcExamVisibility(
  count: number,
  reviewPromptThreshold: number = DC_EXAM_REVIEW_PROMPT_THRESHOLD,
): DcExamVisibility {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return {
    count: safeCount,
    reviewPromptThreshold,
    reviewPrompted: safeCount >= reviewPromptThreshold,
  };
}

// ── title_exam_matter_attribute (per-matter NC-12 posture + §2 DC caveat ack) ────────────────────

export interface TitleExamMatterAttributeInput {
  userId: string;
  matterId: string;
  npiPosture?: TitleExamNpiPosture;
  entityHatAtSet?: string | null;
  dcCaveatAcknowledgedAt?: Date | null;
}

/** Insert a matter-attribute row. Exported for a mock-tx unit test. */
export async function writeTitleExamMatterAttributeTx(
  tx: Executor,
  input: TitleExamMatterAttributeInput & { id: string },
): Promise<void> {
  await tx.insert(titleExamMatterAttribute).values({
    id: input.id,
    userId: input.userId,
    matterId: input.matterId,
    npiPosture: input.npiPosture ?? 'no_external_call',
    entityHatAtSet: input.entityHatAtSet ?? null,
    dcCaveatAcknowledgedAt: input.dcCaveatAcknowledgedAt ?? null,
  });
}

/** Read the matter's title-exam attribute row, owner-scoped. Null when unset / not owned. */
export async function getTitleExamMatterAttribute(
  matterId: string,
  userId: string,
): Promise<TitleExamMatterAttribute | null> {
  const rows = await db
    .select()
    .from(titleExamMatterAttribute)
    .where(and(ownerScope(titleExamMatterAttribute.userId, userId), eq(titleExamMatterAttribute.matterId, matterId)));
  return rows[0] ?? null;
}

/**
 * Set (insert or update) the matter's title-exam attribute row, owner-scoped. One row per matter
 * (matterId UNIQUE). Returns the row id. Only the provided fields are changed on update.
 */
export async function upsertTitleExamMatterAttribute(
  input: TitleExamMatterAttributeInput,
): Promise<string> {
  const existing = await getTitleExamMatterAttribute(input.matterId, input.userId);
  if (!existing) {
    const id = uuidv4();
    await writeTitleExamMatterAttributeTx(db, { ...input, id });
    return id;
  }
  await db
    .update(titleExamMatterAttribute)
    .set({
      npiPosture: input.npiPosture ?? existing.npiPosture,
      entityHatAtSet: input.entityHatAtSet ?? existing.entityHatAtSet,
      dcCaveatAcknowledgedAt: input.dcCaveatAcknowledgedAt ?? existing.dcCaveatAcknowledgedAt,
    })
    .where(
      and(
        ownerScope(titleExamMatterAttribute.userId, input.userId),
        eq(titleExamMatterAttribute.matterId, input.matterId),
      ),
    );
  return existing.id;
}

// ── title_exam_session + title_exam_finding (the exam run + its findings) ────────────────────────

export interface TitleExamSessionInput {
  userId: string;
  matterId: string;
  jurisdiction?: string | null;
  entityHat?: string | null;
  laneMode?: TitleExamLaneMode;
  laneFailureBanner?: string | null;
  completeness?: TitleExamCompleteness;
  incompletenessReason?: string | null;
  droppedPageCount?: number;
  status?: TitleExamSessionStatus;
  roundsRun?: number;
  converged?: boolean;
  examinerAModel?: string | null;
  examinerBModel?: string | null;
  reconcilerModel?: string | null;
  lanes?: unknown;
  candidateMemoText?: string | null;
}

export interface TitleExamFindingInput {
  laneOrigin: TitleExamLaneOrigin;
  title: string;
  detail?: string | null;
  sourceBasis: TitleExamSourceBasis;
  sourceMap?: unknown;
  downgraded?: boolean;
  ocrDerived?: boolean;
  ocrSourcePagePincite?: string | null;
  sendability: TitleExamSendability;
  classification: TitleExamClassification;
  reconClassification?: TitleExamReconClass | null;
  isJudgmentConflict?: boolean;
  escalationState?: TitleExamEscalationState;
  autoResolvedRationale?: string | null;
  laneAPosition?: string | null;
  laneBPosition?: string | null;
  recommendation?: string | null;
  seedSourceMatterId?: string | null;
  seedContaminationFlag?: boolean;
  importJustification?: string | null;
  importResolved?: boolean;
  adoptLedgerId?: string | null;
  decisionEventId?: string | null;
}

/** Insert the session row. Exported for a mock-tx unit test. */
export async function writeTitleExamSessionTx(
  tx: Executor,
  input: TitleExamSessionInput & { sessionId: string },
): Promise<void> {
  await tx.insert(titleExamSession).values({
    id: input.sessionId,
    userId: input.userId,
    matterId: input.matterId,
    jurisdiction: input.jurisdiction ?? null,
    entityHat: input.entityHat ?? null,
    laneMode: input.laneMode ?? 'two_lane',
    laneFailureBanner: input.laneFailureBanner ?? null,
    completeness: input.completeness ?? 'complete',
    incompletenessReason: input.incompletenessReason ?? null,
    droppedPageCount: input.droppedPageCount ?? 0,
    status: input.status ?? 'intake',
    roundsRun: input.roundsRun ?? 0,
    converged: input.converged ?? false,
    examinerAModel: input.examinerAModel ?? null,
    examinerBModel: input.examinerBModel ?? null,
    reconcilerModel: input.reconcilerModel ?? null,
    lanes: input.lanes ?? null,
    candidateMemoText: input.candidateMemoText ?? null,
  });
}

/** Insert one finding row for a session (owner + matter denormalized from the session). Exported for tests. */
export async function writeTitleExamFindingTx(
  tx: Executor,
  input: TitleExamFindingInput & { id: string; sessionId: string; userId: string; matterId: string },
): Promise<void> {
  await tx.insert(titleExamFinding).values({
    id: input.id,
    userId: input.userId,
    matterId: input.matterId,
    sessionId: input.sessionId,
    laneOrigin: input.laneOrigin,
    title: input.title,
    detail: input.detail ?? null,
    sourceBasis: input.sourceBasis,
    sourceMap: input.sourceMap ?? null,
    downgraded: input.downgraded ?? false,
    ocrDerived: input.ocrDerived ?? false,
    ocrSourcePagePincite: input.ocrSourcePagePincite ?? null,
    sendability: input.sendability,
    classification: input.classification,
    reconClassification: input.reconClassification ?? null,
    isJudgmentConflict: input.isJudgmentConflict ?? false,
    escalationState: input.escalationState ?? 'none',
    autoResolvedRationale: input.autoResolvedRationale ?? null,
    laneAPosition: input.laneAPosition ?? null,
    laneBPosition: input.laneBPosition ?? null,
    recommendation: input.recommendation ?? null,
    seedSourceMatterId: input.seedSourceMatterId ?? null,
    seedContaminationFlag: input.seedContaminationFlag ?? false,
    importJustification: input.importJustification ?? null,
    importResolved: input.importResolved ?? false,
    adoptLedgerId: input.adoptLedgerId ?? null,
    decisionEventId: input.decisionEventId ?? null,
  });
}

export interface PersistTitleExamRunInput {
  session: TitleExamSessionInput;
  findings: readonly TitleExamFindingInput[];
}

/** Write the session row + all its finding rows in ONE transaction. Exported for a mock-tx unit test. */
export async function writeTitleExamRunTx(
  tx: Executor,
  input: PersistTitleExamRunInput & { sessionId: string },
): Promise<void> {
  await writeTitleExamSessionTx(tx, { ...input.session, sessionId: input.sessionId });
  for (const f of input.findings) {
    await writeTitleExamFindingTx(tx, {
      ...f,
      id: uuidv4(),
      sessionId: input.sessionId,
      userId: input.session.userId,
      matterId: input.session.matterId,
    });
  }
}

/** Persist a title-exam run (session + findings) atomically. Returns the new session id. */
export async function persistTitleExamRun(input: PersistTitleExamRunInput): Promise<string> {
  const sessionId = uuidv4();
  await db.transaction(async (tx) => {
    await writeTitleExamRunTx(tx, { ...input, sessionId });
  });
  return sessionId;
}

/** One exam session by id, owner-scoped. Null when not found / not owned. */
export async function getTitleExamSessionById(
  sessionId: string,
  userId: string,
): Promise<TitleExamSession | null> {
  const rows = await db
    .select()
    .from(titleExamSession)
    .where(and(ownerScope(titleExamSession.userId, userId), eq(titleExamSession.id, sessionId)));
  return rows[0] ?? null;
}

/** The matter's exam sessions, owner-scoped, newest first. */
export async function listTitleExamSessionsForMatter(
  matterId: string,
  userId: string,
): Promise<TitleExamSession[]> {
  return db
    .select()
    .from(titleExamSession)
    .where(and(ownerScope(titleExamSession.userId, userId), eq(titleExamSession.matterId, matterId)))
    .orderBy(desc(titleExamSession.createdAt));
}

/** All findings for a session, owner-scoped, in recording order. */
export async function listTitleExamFindingsBySession(
  sessionId: string,
  userId: string,
): Promise<TitleExamFinding[]> {
  return db
    .select()
    .from(titleExamFinding)
    .where(and(ownerScope(titleExamFinding.userId, userId), eq(titleExamFinding.sessionId, sessionId)))
    .orderBy(asc(titleExamFinding.createdAt));
}

/**
 * §2 — count the owner's DC title-exam sessions (the volume the occasional-and-sporadic caveat tracks).
 * Owner-scoped; counts sessions whose jurisdiction is 'DC'.
 */
export async function countDcExamSessions(userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(titleExamSession)
    .where(and(ownerScope(titleExamSession.userId, userId), eq(titleExamSession.jurisdiction, 'DC')));
  return Number(rows[0]?.n ?? 0) || 0;
}

/** §2 — the owner's DC-exam visibility signal (count + review-prompt state). */
export async function getDcExamVisibility(userId: string): Promise<DcExamVisibility> {
  const count = await countDcExamSessions(userId);
  return deriveDcExamVisibility(count);
}
