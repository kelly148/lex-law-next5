/**
 * chatCopilotPolicy.ts — CHAT-COPILOT-1 PURE policy primitives (no DB, no I/O, no flags).
 *
 * The testable core of the copilot's confidentiality + isolation invariants:
 *   - STORE-BY-REFERENCE projection: toPersistableMessage drops, by construction, the compiled master
 *     body / raw assembled context / source chunks (and any forbidden key); assertPersistableSafe proves
 *     it. Citations are reduced to reference-only { sourceId, locator }.
 *   - ISOLATION guard: assertConversationContext rejects (NOT_FOUND) a conversation used under a
 *     different owner / matter / document — a conversationId can never be reused across that boundary.
 *   - CAPACITY binding: buildCapacitySnapshot + capacitySnapshotsDiverge (the freeze-on-divergence key,
 *     used by Inc 2) — a conversation is capacity-bound (law-firm vs title/settlement vs unelected).
 *   - draftingGateDecisionId: a deterministic, auditable hash of the gate decision at turn time (the
 *     gate has no persistent decision table).
 *   - Lifecycle: canDeleteConversation (legal-hold honored) + buildMatterFileExport (the defensibility
 *     asset). All pure; the DB query layer (queries/chatCopilot.ts) calls these before persisting.
 */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { hasTitleSignal } from './masterCompositionPrimitives.js';
import type {
  CapacitySnapshot,
  ChatCitation,
  ChatConversationRow,
  ChatMessageRole,
  ChatSummaryRow,
  ChatMessageRow,
} from '../../shared/schemas/chatCopilot.js';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ── Capacity binding ─────────────────────────────────────────────────────────────────────────────────

/** The matter fields needed to snapshot capacity posture (a read-only subset of MatterRow). */
export interface CapacityMatter {
  engagementCapacity?: string | null | undefined;
  engagementCapacityElectedAt?: Date | string | null | undefined;
  paKey?: string | null | undefined;
  practiceArea?: string | null | undefined;
}

/**
 * Capture the matter's CURRENT capacity posture. electionMarker is the affirmative-election timestamp as
 * an ISO string (null = unelected — CAPACITY-ELECTION-UX); titleSignal is the over-inclusive title/
 * settlement signal in the practice area. Stored on the conversation (binding) + each turn (audit).
 */
export function buildCapacitySnapshot(matter: CapacityMatter): CapacitySnapshot {
  const electedAt = matter.engagementCapacityElectedAt;
  const electionMarker =
    electedAt == null ? null : electedAt instanceof Date ? electedAt.toISOString() : String(electedAt);
  return {
    engagementCapacity: matter.engagementCapacity ?? null,
    electionMarker,
    titleSignal: hasTitleSignal({ paKey: matter.paKey ?? null, practiceArea: matter.practiceArea ?? null }),
  };
}

/**
 * Posture-relevant divergence between two capacity snapshots — the freeze-on-capacity-divergence key
 * (Inc 2). Divergent IFF the engagementCapacity changed, the elected-vs-unelected state flipped, OR the
 * title signal changed. A benign re-election to the SAME posture (a fresh marker timestamp, same value +
 * same elected-ness + same title signal) is NOT divergence — it must not force a needless freeze.
 */
export function capacitySnapshotsDiverge(a: CapacitySnapshot, b: CapacitySnapshot): boolean {
  return (
    a.engagementCapacity !== b.engagementCapacity ||
    (a.electionMarker == null) !== (b.electionMarker == null) ||
    a.titleSignal !== b.titleSignal
  );
}

// ── Drafting-gate decision id (deterministic audit hash) ───────────────────────────────────────────────

export interface GateDecisionLike {
  allowed: boolean;
  clearance?: { state?: string | null } | null;
  blockingPreconditions?: readonly string[];
  overriddenPreconditions?: readonly string[];
  activeOverrides?: ReadonlyArray<{ id: string }>;
}

/**
 * A stable, auditable identifier for the resolveDraftingGate decision at turn time. The gate has no
 * persistent decision table, so we hash a CANONICAL projection of the decision; the same gate state
 * always yields the same id, and any change to allow/clearance/blocking/override changes it.
 */
export function draftingGateDecisionId(gate: GateDecisionLike): string {
  const canonical = JSON.stringify({
    allowed: gate.allowed,
    clearanceState: gate.clearance?.state ?? null,
    blocking: [...(gate.blockingPreconditions ?? [])].sort(),
    overridden: [...(gate.overriddenPreconditions ?? [])].sort(),
    overrides: (gate.activeOverrides ?? []).map((o) => o.id).sort(),
  });
  return `gate_${sha256Hex(canonical)}`;
}

// ── Store-by-reference projection (categorical exclusion) ──────────────────────────────────────────────

/**
 * Keys that must NEVER be persisted into chat_messages (categorical exclusion — the triad's adopted
 * control). The projection below excludes them BY CONSTRUCTION (it copies only the allowlisted fields);
 * assertPersistableSafe is the defense-in-depth proof that none leaked.
 */
export const FORBIDDEN_PERSIST_KEYS: readonly string[] = [
  'compiledMasterBody',
  'masterBody',
  'layeredMasterText',
  'assembledContext',
  'rawContext',
  'sourceChunks',
  'sourceChunkText',
  'wireInstructions',
  'accountNumber',
  'routingNumber',
  'payoffStatement',
  'ssn',
  'tin',
  'idImage',
];

/** The rich, in-memory turn data (may carry forbidden runtime fields that must not be persisted). */
export interface RichChatTurnInput {
  role: ChatMessageRole;
  /** The attorney turn text OR the model response — this IS persisted (store-by-reference excludes
   *  the compiled master / assembled context / source chunks, NOT the conversation's own text). */
  text: string;
  masterApplied: boolean;
  masterSource: string | null;
  capacitySnapshot: CapacitySnapshot | null;
  draftingGateDecisionId: string | null;
  citations?: ChatCitation[] | null;
  modelProvider?: string | null;
  modelId?: string | null;
  doNotPersist?: boolean;
  excludeFromGrounding?: boolean;
  // Forbidden runtime fields (compiled master body / assembled context / source chunks). Accepted on the
  // INPUT type only so the projection can demonstrably DROP them; never copied to the output.
  compiledMasterBody?: string;
  assembledContext?: string;
  sourceChunks?: unknown;
  [extra: string]: unknown;
}

/** The persistable projection — exactly the allowlisted, reference-only fields. No forbidden field exists. */
export interface PersistableChatMessage {
  role: ChatMessageRole;
  content: string | null;
  contentHash: string | null;
  masterApplied: boolean;
  masterSource: string | null;
  capacitySnapshot: CapacitySnapshot | null;
  draftingGateDecisionId: string | null;
  citations: ChatCitation[] | null;
  modelProvider: string | null;
  modelId: string | null;
  doNotPersist: boolean;
  excludeFromGrounding: boolean;
}

/** Reduce citations to reference-only { sourceId, locator } — never any copied chunk text or extra fields. */
export function sanitizeCitations(citations: ChatCitation[] | null | undefined): ChatCitation[] | null {
  if (citations == null) return null;
  return citations.map((c) => {
    const out: ChatCitation = { sourceId: c.sourceId };
    if (c.locator != null) out.locator = c.locator;
    return out;
  });
}

/**
 * Project a rich runtime turn to the persistable shape. Copies ONLY the allowlisted fields — the
 * compiled master body / assembled context / source chunks (and any other forbidden key) are excluded
 * by construction. A do-not-persist turn becomes a tombstone: ordering + posture audit metadata are
 * kept, but content + contentHash + citations are dropped (the turn content is NOT persisted).
 */
export function toPersistableMessage(input: RichChatTurnInput): PersistableChatMessage {
  const doNotPersist = input.doNotPersist === true;
  const content = doNotPersist ? null : input.text;
  return {
    role: input.role,
    content,
    contentHash: content == null ? null : sha256Hex(content),
    masterApplied: input.masterApplied,
    masterSource: input.masterSource,
    capacitySnapshot: input.capacitySnapshot,
    draftingGateDecisionId: input.draftingGateDecisionId,
    citations: doNotPersist ? null : sanitizeCitations(input.citations),
    modelProvider: input.modelProvider ?? null,
    modelId: input.modelId ?? null,
    doNotPersist,
    excludeFromGrounding: input.excludeFromGrounding === true,
  };
}

/**
 * Defense-in-depth: assert a persistable message carries NO forbidden key and that its citations are
 * reference-only (no chunk text / extra fields). Throws on violation. The DB write boundary calls this
 * before INSERT; the blocking tests call it on the projection output.
 */
export function assertPersistableSafe(msg: Record<string, unknown>): void {
  for (const key of FORBIDDEN_PERSIST_KEYS) {
    if (key in msg) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `store-by-reference violation: forbidden field '${key}' must never be persisted to chat_messages`,
      });
    }
  }
  const citations = (msg as { citations?: unknown }).citations;
  if (Array.isArray(citations)) {
    for (const c of citations) {
      const keys = Object.keys(c as Record<string, unknown>);
      const extra = keys.filter((k) => k !== 'sourceId' && k !== 'locator');
      if (extra.length > 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `store-by-reference violation: a citation may carry only sourceId + locator, not [${extra.join(', ')}]`,
        });
      }
    }
  }
}

// ── Isolation guard ────────────────────────────────────────────────────────────────────────────────────

/** The context a caller asserts a conversation must belong to. documentId optional (only checked if given). */
export interface ConversationContext {
  userId: string;
  matterId: string;
  documentId?: string | null;
}

/**
 * Reject (NOT_FOUND — no existence leak) any attempt to use a conversation outside its IMMUTABLE
 * binding: a conversationId belonging to matter A / document A / owner A can never be read or appended
 * under matter B / document B / owner B. ownerScope() already filters reads by owner; this is the
 * defense-in-depth invariant the triad required (isolation invariants, not just scoped queries).
 */
export function assertConversationContext(conversation: ChatConversationRow, ctx: ConversationContext): void {
  const mismatch =
    conversation.userId !== ctx.userId ||
    conversation.matterId !== ctx.matterId ||
    (ctx.documentId != null && conversation.documentId !== ctx.documentId);
  if (mismatch) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found in this context' });
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────────────

export interface DeletionCheck {
  ok: boolean;
  reason?: string;
}

/** A conversation under legal hold cannot be deleted (the hold wins over an attorney delete). */
export function canDeleteConversation(conversation: ChatConversationRow): DeletionCheck {
  if (conversation.legalHold) {
    return { ok: false, reason: 'LEGAL_HOLD' };
  }
  return { ok: true };
}

export interface MatterFileExport {
  conversationId: string;
  matterId: string;
  documentId: string | null;
  capacitySnapshot: CapacitySnapshot;
  retentionClass: string;
  title: string | null;
  messages: Array<{
    seq: number;
    role: ChatMessageRole;
    content: string | null;
    masterApplied: boolean;
    masterSource: string | null;
    draftingGateDecisionId: string | null;
    citations: ChatCitation[] | null;
    createdAt: string;
  }>;
  summaries: Array<{ coversFromSeq: number; coversToSeq: number; summaryText: string }>;
}

/**
 * Build the matter-file export artifact — the full thread + its citations as a defensibility asset
 * (Doc 3's kept catch). Reference-only (no chunk text was ever stored). Excludes-from-grounding/
 * do-not-persist marks ride along on the rows; the export is a faithful record of what was retained.
 */
export function buildMatterFileExport(
  conversation: ChatConversationRow,
  messages: ChatMessageRow[],
  summaries: ChatSummaryRow[],
): MatterFileExport {
  return {
    conversationId: conversation.id,
    matterId: conversation.matterId,
    documentId: conversation.documentId,
    capacitySnapshot: conversation.capacitySnapshot,
    retentionClass: conversation.retentionClass,
    title: conversation.title,
    messages: [...messages]
      .sort((a, b) => a.seq - b.seq)
      .map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        masterApplied: m.masterApplied,
        masterSource: m.masterSource,
        draftingGateDecisionId: m.draftingGateDecisionId,
        citations: m.citations,
        createdAt: m.createdAt.toISOString(),
      })),
    summaries: [...summaries]
      .sort((a, b) => a.coversFromSeq - b.coversFromSeq)
      .map((s) => ({ coversFromSeq: s.coversFromSeq, coversToSeq: s.coversToSeq, summaryText: s.summaryText })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// Inc 2 — windowed multi-turn history + master-laundering mitigations (all PURE)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// The triad's adopted defenses against laundering the firm master across persisted memory:
//   (a) FRESH per-turn gate (the caller recomputes resolveChatMaster from LIVE matter state every turn;
//       persisted masterApplied/masterSource are AUDIT-ONLY and must never short-circuit it — enforced by
//       the procedure, which never reads them to decide injection);
//   (b) FREEZE-on-capacity-divergence (evaluateFreeze);
//   (c) WINDOW-SCRUB (scrubWindow — exclude master-applied prior turns when the current turn is neutral);
//   (d) POSTURE-AWARE summaries (selectCompatibleSummaries — never feed a master / cross-capacity summary
//       into a turn whose posture wouldn't permit it; segmentForSummary never spans a master boundary).

/** The freeze decision for a turn. A frozen (or newly-divergent) conversation refuses further turns. */
export interface FreezeDecision {
  freeze: boolean; // a NEW divergence detected this turn -> freeze the thread now
  alreadyFrozen: boolean; // the conversation was already frozen
  reason: string | null;
}

/**
 * (b) FREEZE-ON-CAPACITY-DIVERGENCE. If the conversation was already frozen, refuse. If the LIVE matter
 * capacity posture diverges from the conversation's bound snapshot (capacity changed / election flipped /
 * title signal changed), freeze the thread — the attorney must start a new conversation. This is the
 * primary laundering defense: a thread cannot continue under a posture different from the one it was born
 * in, so a master-applied history can never be replayed into a now-different posture.
 */
export function evaluateFreeze(
  conversation: Pick<ChatConversationRow, 'frozenAt' | 'freezeReason' | 'capacitySnapshot'>,
  liveSnapshot: CapacitySnapshot,
): FreezeDecision {
  if (conversation.frozenAt != null) {
    return { freeze: false, alreadyFrozen: true, reason: conversation.freezeReason ?? 'frozen' };
  }
  if (capacitySnapshotsDiverge(conversation.capacitySnapshot, liveSnapshot)) {
    return { freeze: true, alreadyFrozen: false, reason: 'capacity_divergence' };
  }
  return { freeze: false, alreadyFrozen: false, reason: null };
}

/** A windowable view of a stored turn (subset of ChatMessageRow). */
export interface WindowMessage {
  seq: number;
  role: ChatMessageRole;
  content: string | null;
  masterApplied: boolean;
  doNotPersist: boolean;
  excludeFromGrounding: boolean;
  capacitySnapshot: CapacitySnapshot | null;
}

/**
 * Last-N windowing: the most recent `limit` turns that actually carry content (tombstoned do-not-persist
 * turns are skipped). Returned in chronological order. Raw turns remain retrievable elsewhere — this is a
 * windowing convenience, not a deletion.
 */
export function selectHistoryWindow<T extends WindowMessage>(messages: T[], limit: number): T[] {
  const usable = [...messages].sort((a, b) => a.seq - b.seq).filter((m) => m.content != null && !m.doNotPersist);
  if (limit <= 0) return [];
  return usable.slice(Math.max(0, usable.length - limit));
}

/**
 * (c) WINDOW-SCRUB. When the CURRENT turn's fresh posture is NEUTRAL (no master), exclude prior
 * master-applied turns from the window — their representational (firm-counsel) content must never be
 * replayed into a turn the live gate would not permit a master for. When the current turn IS
 * master-applied, the same-posture prior turns are kept (a new fresh gate cleared this turn). Returns the
 * scrubbed window + how many master-applied turns were removed (surfaced as a non-silent signal).
 */
export function scrubWindow<T extends WindowMessage>(
  window: T[],
  currentMasterApplied: boolean,
): { window: T[]; scrubbedMasterTurns: number } {
  if (currentMasterApplied) return { window, scrubbedMasterTurns: 0 };
  const kept = window.filter((m) => !m.masterApplied);
  return { window: kept, scrubbedMasterTurns: window.length - kept.length };
}

/**
 * (d) POSTURE-AWARE SUMMARY SELECTION. Only feed summaries whose posture is compatible with the current
 * turn: same masterApplied AND same engagementCapacity. A law-firm (or any master-applied) summary is
 * NEVER fed into a neutral or different-capacity turn — that would launder the master through the summary.
 */
export function selectCompatibleSummaries(
  summaries: ChatSummaryRow[],
  current: { masterApplied: boolean; capacitySnapshot: CapacitySnapshot },
): ChatSummaryRow[] {
  return summaries.filter(
    (s) =>
      s.posture.masterApplied === current.masterApplied &&
      s.posture.engagementCapacity === current.capacitySnapshot.engagementCapacity,
  );
}

/**
 * (d) POSTURE-AWARE SUMMARY SEGMENTATION. Split a message run into contiguous segments that never cross a
 * master/non-master boundary (a summary is built per segment, so it never compresses across the boundary).
 * Each segment is posture-homogeneous on masterApplied.
 */
export function segmentForSummary<T extends WindowMessage>(messages: T[]): T[][] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq).filter((m) => m.content != null && !m.doNotPersist);
  const segments: T[][] = [];
  let current: T[] = [];
  let posture: boolean | null = null;
  for (const m of ordered) {
    if (posture === null || m.masterApplied === posture) {
      current.push(m);
      posture = m.masterApplied;
    } else {
      if (current.length > 0) segments.push(current);
      current = [m];
      posture = m.masterApplied;
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export interface AssembledWindow {
  windowMessages: WindowMessage[];
  includedSummaries: ChatSummaryRow[];
  scrubbedMasterTurns: number;
}

/**
 * Assemble the history a turn may see: last-N window -> window-scrub (per the current fresh posture) ->
 * posture-compatible summaries. Pure; the procedure renders the result for the model and records the
 * scrubbed-turn count (no silent scrub).
 */
export function assembleCopilotWindow(args: {
  priorMessages: WindowMessage[];
  summaries: ChatSummaryRow[];
  currentMasterApplied: boolean;
  currentCapacitySnapshot: CapacitySnapshot;
  limit: number;
}): AssembledWindow {
  const win = selectHistoryWindow(args.priorMessages, args.limit);
  const scrubbed = scrubWindow(win, args.currentMasterApplied);
  const includedSummaries = selectCompatibleSummaries(args.summaries, {
    masterApplied: args.currentMasterApplied,
    capacitySnapshot: args.currentCapacitySnapshot,
  });
  return {
    windowMessages: scrubbed.window,
    includedSummaries,
    scrubbedMasterTurns: scrubbed.scrubbedMasterTurns,
  };
}
