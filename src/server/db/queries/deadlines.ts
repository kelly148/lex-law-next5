/**
 * deadlines.ts — FOLD-PM-1 Increment 3: deadline/tickler instance lifecycle (owner-scoped, audited).
 *
 * Ch 35.1 Zod Wall: the only path that reads the deadline tables; every row parses through the shared
 * schemas. Ch 35.2: userId is always the caller's; ownership flows through ownerScope() + getMatterById.
 *
 * SAFETY INVARIANTS (FOLD-PM-1 disposition / G-C — no silent states):
 *   - pending_confirm instances DO materialize ticklers (confirmation governs reliance, not visibility).
 *   - expired_unresolved is permanent until a reasoned satisfy/waive; while it stands it PROJECTS a
 *     one-directional open_item (category 'expired_deadline', blocker) so closure/sendability reads see
 *     it. The projection is cleared only by satisfy/waive (never auto-closed).
 *   - ack/snooze state is keyed to the LOGICAL lead-time (leadDays) and preserved across regeneration.
 *   - every lifecycle act is audited; the system FIRING is audited DISTINCTLY (deadline_fired) from the
 *     attorney acknowledgment (deadline_acknowledged) and from attorney dispositions.
 *   - NO autonomous/egress action: this records and surfaces; it never sends, files, or notifies.
 *
 * Determinism: all "today"/horizon logic takes an injected DeadlineClock (never an ambient clock).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../connection.js';
import { ownerScope } from '../ownerScope.js';
import {
  matterDeadline,
  deadlineRuleRevision,
  tickler,
  holidayCalendar,
} from '../schema.js';
import {
  MatterDeadlineRowSchema, type MatterDeadlineRow,
  DeadlineRuleRevisionRowSchema, type DeadlineRuleRevisionRow,
  TicklerRowSchema, type TicklerRow,
} from '../../../shared/schemas/deadline.js';
import { insertAuditEvent } from './auditEvents.js';
import { autoRegisterOpenItem, listOpenOpenItemsForMatter, resolveOpenItem } from './openItems.js';
import { computeDeadline, type DeadlineRuleInput, type HolidayCalendar, type ConstraintInputs } from '../../deadline/computeDeadline.js';
import { addDays } from '../../deadline/dateMath.js';
import type { DeadlineClock } from '../../deadline/clock.js';

const HORIZON_DAYS = 365; // rolling 12-month tickler materialization horizon
const EXPIRED_OPEN_ITEM_CATEGORY = 'expired_deadline';

// ── parse-on-read helpers ──
const parseDeadline = (r: unknown): MatterDeadlineRow => MatterDeadlineRowSchema.parse(r);
const parseRevision = (r: unknown): DeadlineRuleRevisionRow => DeadlineRuleRevisionRowSchema.parse(r);
const parseTickler = (r: unknown): TicklerRow => TicklerRowSchema.parse(r);

/** Effective due date = attorney override if set, else the computed due date. */
export function effectiveDueDate(d: Pick<MatterDeadlineRow, 'attorneyOverrideDate' | 'computedDueDate'>): string | null {
  return d.attorneyOverrideDate ?? d.computedDueDate;
}

// ============================================================
// Holiday calendar loader (firm-level; builds the engine's HolidayCalendar)
// ============================================================
export async function loadHolidayCalendar(jurisdictions: string[]): Promise<HolidayCalendar> {
  const wanted = Array.from(new Set(['US', ...jurisdictions])); // business-day math always unions US (federal)
  const rows = await db.select().from(holidayCalendar).where(inArray(holidayCalendar.jurisdiction, wanted));
  const dates = rows.map((r) => String(r.date));
  const holidays = new Set(dates);
  const sorted = [...dates].sort();
  return {
    jurisdictions: wanted,
    holidays,
    coverageStart: sorted[0] ?? '0000-01-01',
    coverageEnd: sorted[sorted.length - 1] ?? '0000-01-01',
  };
}

// ============================================================
// Rule revision read (firm-level; no owner key)
// ============================================================
export async function getRuleRevisionById(revisionId: string): Promise<DeadlineRuleRevisionRow | null> {
  const rows = await db.select().from(deadlineRuleRevision).where(eq(deadlineRuleRevision.id, revisionId));
  return rows[0] ? parseRevision(rows[0]) : null;
}

function revisionToRuleInput(rev: DeadlineRuleRevisionRow): DeadlineRuleInput {
  return {
    anchorType: rev.anchorType,
    offsetDays: rev.offsetDays,
    dayConvention: rev.dayConvention,
    rollRule: rev.rollRule,
    recurrence: rev.recurrence,
    constraintsSpec: rev.constraintsSpec,
    jurisdiction: rev.jurisdiction,
    sourceTag: rev.sourceTag,
  };
}

// ============================================================
// Reads (owner-scoped, Zod Wall)
// ============================================================
export async function getMatterDeadlineById(id: string, userId: string): Promise<MatterDeadlineRow | null> {
  const rows = await db.select().from(matterDeadline)
    .where(and(eq(matterDeadline.id, id), ownerScope(matterDeadline.userId, userId)));
  return rows[0] ? parseDeadline(rows[0]) : null;
}

export async function listDeadlinesForMatter(matterId: string, userId: string): Promise<MatterDeadlineRow[]> {
  const rows = await db.select().from(matterDeadline)
    .where(and(eq(matterDeadline.matterId, matterId), ownerScope(matterDeadline.userId, userId)));
  return rows.map(parseDeadline);
}

export async function listDeadlinesForOwner(userId: string): Promise<MatterDeadlineRow[]> {
  const rows = await db.select().from(matterDeadline).where(ownerScope(matterDeadline.userId, userId));
  return rows.map(parseDeadline);
}

export async function listTicklersForDeadline(matterDeadlineId: string, userId: string): Promise<TicklerRow[]> {
  const rows = await db.select().from(tickler)
    .where(and(eq(tickler.matterDeadlineId, matterDeadlineId), ownerScope(tickler.userId, userId)));
  return rows.map(parseTickler);
}

// ============================================================
// Tickler materialization (pure target + idempotent, state-preserving reconcile)
// ============================================================
/** PURE: the target tickler set (leadDays -> fireAt) for a deadline within the rolling horizon. */
export function targetTicklers(
  effDue: string | null,
  leadDays: number[],
  today: string,
): Array<{ leadDays: number; fireAt: string }> {
  if (!effDue) return [];
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const out: Array<{ leadDays: number; fireAt: string }> = [];
  for (const L of leadDays) {
    const fireAt = addDays(effDue, -L);
    if (fireAt <= horizonEnd) out.push({ leadDays: L, fireAt }); // includes past-due (fired) + upcoming-in-horizon
  }
  return out;
}

/**
 * Reconcile a deadline's tickler rows to the target set, preserving ack/snooze keyed to leadDays.
 * Additive + update only (never deletes a still-valid lead's row, so ack/snooze is never lost to a refresh);
 * a lead removed from the rule set is dropped explicitly on recompute. Runs in the caller's transaction.
 */
async function reconcileTicklers(
  tx: typeof db,
  d: MatterDeadlineRow,
  leadDays: number[],
  today: string,
): Promise<void> {
  const target = targetTicklers(effectiveDueDate(d), leadDays, today);
  const existing = await tx.select().from(tickler)
    .where(and(eq(tickler.matterDeadlineId, d.id), ownerScope(tickler.userId, d.userId)));
  const byLead = new Map<number, (typeof existing)[number]>();
  for (const e of existing) byLead.set(e.leadDays, e);

  for (const t of target) {
    const ex = byLead.get(t.leadDays);
    if (!ex) {
      await tx.insert(tickler).values({
        id: uuidv4(), userId: d.userId, matterDeadlineId: d.id, leadDays: t.leadDays, fireAt: t.fireAt,
      });
    } else if (String(ex.fireAt) !== t.fireAt) {
      // anchor/override moved the date: update fireAt, PRESERVE acknowledged/snoozed (keyed to leadDays).
      await tx.update(tickler).set({ fireAt: t.fireAt })
        .where(and(eq(tickler.id, ex.id), ownerScope(tickler.userId, d.userId)));
    }
  }
}

/** Drop tickler rows whose leadDays is no longer in the rule's lead set (explicit, recompute-only). */
async function dropStaleLeadTicklers(tx: typeof db, d: MatterDeadlineRow, leadDays: number[]): Promise<void> {
  const keep = new Set(leadDays);
  const existing = await tx.select().from(tickler)
    .where(and(eq(tickler.matterDeadlineId, d.id), ownerScope(tickler.userId, d.userId)));
  const stale = existing.filter((e) => !keep.has(e.leadDays)).map((e) => e.id);
  if (stale.length > 0) {
    await tx.delete(tickler).where(and(inArray(tickler.id, stale), ownerScope(tickler.userId, d.userId)));
  }
}

function leadDaysOf(d: MatterDeadlineRow): number[] {
  const snap = d.ruleSnapshot as { leadTimeDefaults?: unknown } | null;
  const leads = snap?.leadTimeDefaults;
  return Array.isArray(leads) ? leads.filter((n): n is number => typeof n === 'number') : [];
}

/** On-load refresh: re-materialize the rolling horizon for every non-terminal deadline of a matter. */
export async function refreshTicklersForMatter(matterId: string, userId: string, clock: DeadlineClock): Promise<void> {
  const today = clock.today();
  const deadlines = (await listDeadlinesForMatter(matterId, userId))
    .filter((d) => d.status === 'pending_confirm' || d.status === 'active');
  if (deadlines.length === 0) return;
  await db.transaction(async (tx) => {
    for (const d of deadlines) await reconcileTicklers(tx as typeof db, d, leadDaysOf(d), today);
  });
}

// ============================================================
// Create (computed-from-rule OR manual) — pending_confirm; materializes ticklers; audited
// ============================================================
export interface CreateDeadlineParams {
  matterId: string;
  ruleRevisionId: string | null; // null = manual/ad-hoc
  family: MatterDeadlineRow['family'];
  description: string;
  anchorType: string;
  anchorDate: string;
  anchorSource: MatterDeadlineRow['anchorSource'];
  anchorBasis?: string | null | undefined;
  anchorDocumentId?: string | null | undefined;
  jurisdiction?: string | null | undefined; // for the holiday calendar union
  constraintInputs?: ConstraintInputs | undefined;
  // manual-only:
  manualDueDate?: string | null | undefined;
  leadTimeDefaults: number[]; // rule defaults (attorney-editable) or manual lead times
}

export async function createMatterDeadline(p: CreateDeadlineParams, userId: string, clock: DeadlineClock): Promise<MatterDeadlineRow> {
  let computedDueDate: string | null = null;
  let constraints: unknown[] = [];
  let basisExplanation = 'manual deadline (attorney-entered)';

  if (p.ruleRevisionId) {
    const rev = await getRuleRevisionById(p.ruleRevisionId);
    if (!rev) throw new Error(`createMatterDeadline: rule revision not found (${p.ruleRevisionId})`);
    const calendar = await loadHolidayCalendar([p.jurisdiction ?? rev.jurisdiction ?? 'US'].filter((x): x is string => !!x));
    const result = computeDeadline(revisionToRuleInput(rev), p.anchorDate, calendar, p.constraintInputs);
    computedDueDate = result.dueDate;
    constraints = result.constraints;
    basisExplanation = result.basis.explanation;
  } else {
    computedDueDate = p.manualDueDate ?? null;
  }

  const id = uuidv4();
  const ruleSnapshot = { leadTimeDefaults: p.leadTimeDefaults, ruleRevisionId: p.ruleRevisionId, basisExplanation };

  await db.transaction(async (tx) => {
    await tx.insert(matterDeadline).values({
      id, userId, matterId: p.matterId, ruleRevisionId: p.ruleRevisionId, family: p.family,
      description: p.description, anchorType: p.anchorType, anchorDate: p.anchorDate, anchorSource: p.anchorSource,
      anchorBasis: p.anchorBasis ?? null, anchorDocumentId: p.anchorDocumentId ?? null,
      computedDueDate, constraints, status: 'pending_confirm', ruleSnapshot,
    });
    const created = parseDeadline((await tx.select().from(matterDeadline).where(eq(matterDeadline.id, id)))[0]);
    await reconcileTicklers(tx as typeof db, created, p.leadTimeDefaults, clock.today()); // pending_confirm DOES fire ticklers (G-C)
    await insertAuditEvent({
      userId, matterId: p.matterId, eventType: 'disposition', actor: 'attorney',
      summary: `Created deadline "${p.description}" (${p.family}); status pending_confirm`,
      targetType: 'matter_deadline', targetId: id, action: 'create_deadline',
      rationale: basisExplanation, payload: { computedDueDate, constraints, anchorDate: p.anchorDate },
    }, tx);
  });
  const row = await getMatterDeadlineById(id, userId);
  if (!row) throw new Error('createMatterDeadline: row not found after insert');
  return row;
}

// ============================================================
// Confirm / batch-confirm (pending_confirm -> active; snapshot; audited)
// ============================================================
export async function confirmMatterDeadline(id: string, userId: string): Promise<MatterDeadlineRow> {
  const d = await getMatterDeadlineById(id, userId);
  if (!d) throw new Error('confirmMatterDeadline: not found');
  if (d.status !== 'pending_confirm') throw new Error(`confirmMatterDeadline: status is ${d.status}, expected pending_confirm`);
  await db.transaction(async (tx) => {
    await tx.update(matterDeadline)
      .set({ status: 'active', confirmedByUserId: userId, confirmedAt: new Date() })
      .where(and(eq(matterDeadline.id, id), ownerScope(matterDeadline.userId, userId)));
    await insertAuditEvent({
      userId, matterId: d.matterId, eventType: 'disposition', actor: 'attorney',
      summary: `Confirmed deadline "${d.description}" -> active (now relied upon)`,
      targetType: 'matter_deadline', targetId: id, action: 'confirm_deadline',
    }, tx);
  });
  return (await getMatterDeadlineById(id, userId))!;
}

export async function batchConfirmMatterDeadlines(matterId: string, ids: string[], userId: string): Promise<MatterDeadlineRow[]> {
  const out: MatterDeadlineRow[] = [];
  for (const id of ids) {
    const d = await getMatterDeadlineById(id, userId);
    if (d && d.matterId === matterId && d.status === 'pending_confirm') out.push(await confirmMatterDeadline(id, userId));
  }
  return out; // per-item audited individually inside confirmMatterDeadline
}

// ============================================================
// Override (attorney sets an explicit date + required reason; ticklers regenerate; audited)
// ============================================================
export async function overrideMatterDeadline(id: string, userId: string, overrideDate: string, reason: string, clock: DeadlineClock): Promise<MatterDeadlineRow> {
  const d = await getMatterDeadlineById(id, userId);
  if (!d) throw new Error('overrideMatterDeadline: not found');
  if (!reason.trim()) throw new Error('overrideMatterDeadline: a reason is required');
  await db.transaction(async (tx) => {
    await tx.update(matterDeadline)
      .set({ attorneyOverrideDate: overrideDate, overrideReason: reason })
      .where(and(eq(matterDeadline.id, id), ownerScope(matterDeadline.userId, userId)));
    const updated = parseDeadline((await tx.select().from(matterDeadline).where(eq(matterDeadline.id, id)))[0]);
    await reconcileTicklers(tx as typeof db, updated, leadDaysOf(updated), clock.today()); // preserve ack/snooze by leadDays
    await insertAuditEvent({
      userId, matterId: d.matterId, eventType: 'disposition', actor: 'attorney',
      summary: `Overrode deadline "${d.description}" due date -> ${overrideDate}`,
      targetType: 'matter_deadline', targetId: id, action: 'override_deadline', rationale: reason,
    }, tx);
  });
  return (await getMatterDeadlineById(id, userId))!;
}

// ============================================================
// Waive / satisfy (terminal; record basis; clear the projected open_item; audited)
// ============================================================
async function disposeTerminal(id: string, userId: string, status: 'satisfied' | 'waived', basis: string): Promise<MatterDeadlineRow> {
  const d = await getMatterDeadlineById(id, userId);
  if (!d) throw new Error('disposeTerminal: not found');
  if (!basis.trim()) throw new Error(`${status}: a basis/reason is required`);
  await db.transaction(async (tx) => {
    await tx.update(matterDeadline).set({ status, dispositionBasis: basis })
      .where(and(eq(matterDeadline.id, id), ownerScope(matterDeadline.userId, userId)));
    await insertAuditEvent({
      userId, matterId: d.matterId, eventType: 'disposition', actor: 'attorney',
      summary: `${status === 'satisfied' ? 'Satisfied' : 'Waived'} deadline "${d.description}"`,
      targetType: 'matter_deadline', targetId: id, action: status === 'satisfied' ? 'satisfy_deadline' : 'waive_deadline',
      rationale: basis,
    }, tx);
  });
  // Clear the one-directional expired_deadline projection for this deadline, if any.
  await clearExpiredProjection(id, d.matterId, userId);
  return (await getMatterDeadlineById(id, userId))!;
}
export const satisfyMatterDeadline = (id: string, userId: string, basis: string) => disposeTerminal(id, userId, 'satisfied', basis);
export const waiveMatterDeadline = (id: string, userId: string, reason: string) => disposeTerminal(id, userId, 'waived', reason);

// ============================================================
// expired_unresolved sweep + one-directional open_item projection (deterministic on clock)
// ============================================================
export async function sweepExpiredForMatter(matterId: string, userId: string, clock: DeadlineClock): Promise<MatterDeadlineRow[]> {
  const today = clock.today();
  const active = (await listDeadlinesForMatter(matterId, userId)).filter((d) => d.status === 'active');
  const expired: MatterDeadlineRow[] = [];
  for (const d of active) {
    const due = effectiveDueDate(d);
    if (due && due < today) {
      await db.transaction(async (tx) => {
        await tx.update(matterDeadline).set({ status: 'expired_unresolved' })
          .where(and(eq(matterDeadline.id, d.id), ownerScope(matterDeadline.userId, userId)));
        await insertAuditEvent({
          userId, matterId, eventType: 'deadline_fired', actor: 'system',
          summary: `Deadline "${d.description}" expired unresolved (due ${due}, today ${today})`,
          targetType: 'matter_deadline', targetId: d.id, action: 'expire_unresolved',
        }, tx);
      });
      // Project a one-directional open_item so closure/sendability reads see the blown deadline.
      await projectExpiredOpenItem(d, userId);
      expired.push((await getMatterDeadlineById(d.id, userId))!);
    }
  }
  return expired;
}

async function projectExpiredOpenItem(d: MatterDeadlineRow, userId: string): Promise<void> {
  const existing = (await listOpenOpenItemsForMatter(d.matterId, userId))
    .find((oi) => oi.category === EXPIRED_OPEN_ITEM_CATEGORY && oi.summary.includes(d.id));
  if (existing) return; // idempotent — one projection per blown deadline
  await autoRegisterOpenItem({
    userId, matterId: d.matterId, category: EXPIRED_OPEN_ITEM_CATEGORY, severity: 'blocker',
    summary: `Overdue unresolved deadline "${d.description}" (deadline ${d.id}) — satisfy or waive to clear.`,
    origin: 'deadline_engine', requiresAttorneyConfirmation: true,
  });
}

async function clearExpiredProjection(deadlineId: string, matterId: string, userId: string): Promise<void> {
  const oi = (await listOpenOpenItemsForMatter(matterId, userId))
    .find((x) => x.category === EXPIRED_OPEN_ITEM_CATEGORY && x.summary.includes(deadlineId));
  if (oi) {
    await resolveOpenItem({ id: oi.id, userId, matterId, rationale: 'deadline satisfied/waived' });
  }
}

// ============================================================
// Recompute (propose-and-confirm; never silent)
// ============================================================
export interface RecomputeProposal {
  deadlineId: string;
  currentDueDate: string | null;
  proposedDueDate: string | null;
  deltaDays: number | null;
  proposedConstraints: unknown[];
  basisExplanation: string;
}
export async function proposeRecompute(id: string, userId: string, newAnchorDate: string, constraintInputs?: ConstraintInputs): Promise<RecomputeProposal> {
  const d = await getMatterDeadlineById(id, userId);
  if (!d) throw new Error('proposeRecompute: not found');
  if (!d.ruleRevisionId) throw new Error('proposeRecompute: manual deadlines have no rule to recompute');
  const rev = await getRuleRevisionById(d.ruleRevisionId);
  if (!rev) throw new Error('proposeRecompute: rule revision not found');
  const calendar = await loadHolidayCalendar([rev.jurisdiction ?? 'US'].filter((x): x is string => !!x));
  const result = computeDeadline(revisionToRuleInput(rev), newAnchorDate, calendar, constraintInputs);
  const current = effectiveDueDate(d);
  const deltaDays = current && result.dueDate
    ? Math.round((Date.parse(result.dueDate + 'T00:00:00Z') - Date.parse(current + 'T00:00:00Z')) / 86400000)
    : null;
  return { deadlineId: id, currentDueDate: current, proposedDueDate: result.dueDate, deltaDays, proposedConstraints: result.constraints, basisExplanation: result.basis.explanation };
}

export async function confirmRecompute(id: string, userId: string, newAnchorDate: string, clock: DeadlineClock, constraintInputs?: ConstraintInputs): Promise<MatterDeadlineRow> {
  const d = await getMatterDeadlineById(id, userId);
  if (!d) throw new Error('confirmRecompute: not found');
  if (!d.ruleRevisionId) throw new Error('confirmRecompute: manual deadlines have no rule to recompute');
  const rev = await getRuleRevisionById(d.ruleRevisionId);
  if (!rev) throw new Error('confirmRecompute: rule revision not found');
  const calendar = await loadHolidayCalendar([rev.jurisdiction ?? 'US'].filter((x): x is string => !!x));
  const result = computeDeadline(revisionToRuleInput(rev), newAnchorDate, calendar, constraintInputs);
  const leads = leadDaysOf(d);
  await db.transaction(async (tx) => {
    await tx.update(matterDeadline)
      .set({ anchorDate: newAnchorDate, computedDueDate: result.dueDate, constraints: result.constraints })
      .where(and(eq(matterDeadline.id, id), ownerScope(matterDeadline.userId, userId)));
    const updated = parseDeadline((await tx.select().from(matterDeadline).where(eq(matterDeadline.id, id)))[0]);
    await dropStaleLeadTicklers(tx as typeof db, updated, leads);
    await reconcileTicklers(tx as typeof db, updated, leads, clock.today()); // preserve ack/snooze by leadDays
    await insertAuditEvent({
      userId, matterId: d.matterId, eventType: 'disposition', actor: 'attorney',
      summary: `Recomputed deadline "${d.description}": anchor -> ${newAnchorDate}, due ${effectiveDueDate(d)} -> ${result.dueDate}`,
      targetType: 'matter_deadline', targetId: id, action: 'recompute_deadline', rationale: result.basis.explanation,
    }, tx);
  });
  return (await getMatterDeadlineById(id, userId))!;
}

// ============================================================
// Tickler ack / snooze (audited; ack is deadline_acknowledged, distinct from the firing)
// ============================================================
export async function acknowledgeTickler(ticklerId: string, userId: string): Promise<TicklerRow> {
  const rows = await db.select().from(tickler).where(and(eq(tickler.id, ticklerId), ownerScope(tickler.userId, userId)));
  const t = rows[0] ? parseTickler(rows[0]) : null;
  if (!t) throw new Error('acknowledgeTickler: not found');
  const d = await getMatterDeadlineById(t.matterDeadlineId, userId);
  await db.transaction(async (tx) => {
    await tx.update(tickler).set({ acknowledgedByUserId: userId, acknowledgedAt: new Date() })
      .where(and(eq(tickler.id, ticklerId), ownerScope(tickler.userId, userId)));
    if (d) await insertAuditEvent({
      userId, matterId: d.matterId, eventType: 'deadline_acknowledged', actor: 'attorney',
      summary: `Acknowledged tickler (T-${t.leadDays}) for deadline "${d.description}"`,
      targetType: 'tickler', targetId: ticklerId, action: 'acknowledge_tickler',
    }, tx);
  });
  return (await listTicklersForDeadline(t.matterDeadlineId, userId)).find((x) => x.id === ticklerId)!;
}

export async function snoozeTickler(ticklerId: string, userId: string, snoozedUntil: string, reason: string): Promise<TicklerRow> {
  const rows = await db.select().from(tickler).where(and(eq(tickler.id, ticklerId), ownerScope(tickler.userId, userId)));
  const t = rows[0] ? parseTickler(rows[0]) : null;
  if (!t) throw new Error('snoozeTickler: not found');
  await db.update(tickler).set({ snoozedUntil, snoozeReason: reason })
    .where(and(eq(tickler.id, ticklerId), ownerScope(tickler.userId, userId)));
  return (await listTicklersForDeadline(t.matterDeadlineId, userId)).find((x) => x.id === ticklerId)!;
}

// ============================================================
// Coverage chip + integrity/health (no-silent-states; G-C)
// ============================================================
export type CoverageState = 'none' | 'unconfirmed' | 'active' | 'overdue_unresolved';
export interface MatterCoverage {
  state: CoverageState;
  total: number; pendingConfirm: number; active: number; overdueUnresolved: number; satisfied: number; waived: number;
}
/** PURE: coverage-chip state precedence so ABSENCE never reads as all-clear (G-C). */
export function coverageStateFromCounts(c: { overdueUnresolved: number; pendingConfirm: number; active: number }): CoverageState {
  if (c.overdueUnresolved > 0) return 'overdue_unresolved';
  if (c.pendingConfirm > 0) return 'unconfirmed';
  if (c.active > 0) return 'active';
  return 'none';
}
export async function coverageForMatter(matterId: string, userId: string): Promise<MatterCoverage> {
  const ds = await listDeadlinesForMatter(matterId, userId);
  const c = {
    total: ds.length,
    pendingConfirm: ds.filter((d) => d.status === 'pending_confirm').length,
    active: ds.filter((d) => d.status === 'active').length,
    overdueUnresolved: ds.filter((d) => d.status === 'expired_unresolved').length,
    satisfied: ds.filter((d) => d.status === 'satisfied').length,
    waived: ds.filter((d) => d.status === 'waived').length,
  };
  return { state: coverageStateFromCounts(c), ...c };
}

export interface IntegrityReport {
  today: string;
  dueWithinNDays: number;
  missingTicklerDeadlineIds: string[]; // active deadlines due within N days with NO tickler rows (a gap)
  counts: { active: number; pendingConfirm: number; overdueUnresolved: number; dueNow: number };
}
/** Active deadlines due within N days MUST have tickler rows, else a system warning (no silent miss). */
export async function integrityCheckForOwner(userId: string, withinDays: number, clock: DeadlineClock): Promise<IntegrityReport> {
  const today = clock.today();
  const horizon = addDays(today, withinDays);
  const ds = await listDeadlinesForOwner(userId);
  const missing: string[] = [];
  let dueNow = 0;
  for (const d of ds.filter((x) => x.status === 'active')) {
    const due = effectiveDueDate(d);
    if (due && due >= today && due <= horizon) {
      const ticks = await db.select({ id: tickler.id }).from(tickler)
        .where(and(eq(tickler.matterDeadlineId, d.id), ownerScope(tickler.userId, userId)));
      if (ticks.length === 0) missing.push(d.id);
    }
    if (due && due <= today) dueNow++;
  }
  return {
    today, dueWithinNDays: withinDays, missingTicklerDeadlineIds: missing,
    counts: {
      active: ds.filter((d) => d.status === 'active').length,
      pendingConfirm: ds.filter((d) => d.status === 'pending_confirm').length,
      overdueUnresolved: ds.filter((d) => d.status === 'expired_unresolved').length,
      dueNow,
    },
  };
}
