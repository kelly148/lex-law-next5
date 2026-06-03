/**
 * Matter-memory injection service — FOLD-L1-2.
 *
 * Turns the L1-1 Matter-State Engine's curated `model_context` package into a bounded,
 * deterministic, prompt-ready "## Matter State" block, and exposes the async builder the
 * dispatch chokepoint (executeCanonicalMutation) calls so EVERY model call receives the
 * current matter state — the "no cold reviews" precondition that makes multi-model
 * disagreement signal, not noise.
 *
 * Scope (stated): the block covers the matter-state dimensions that were NOT previously
 * injected anywhere — matter identity/phase, operative document, open items
 * (blockers/substantive/matter-level), operative source-authority currency, and the
 * safe-to-send posture. It deliberately EXCLUDES locked decisions and carried adoptions:
 * the reviewer dispatch path already injects those per-document (MR-CAL-6B/7B), so
 * rendering them here too would duplicate. The model_context package still carries them
 * for other consumers; this formatter just doesn't re-render them.
 *
 * Default-safe: the builder is invoked best-effort by the chokepoint (a failed read never
 * breaks a model call), and the formatter returns '' when there is nothing material to say.
 */

import { getMatterState } from './index.js';
import type { MatterStateModelContext } from '../../shared/schemas/matterState.js';

// Bounds for token safety (mirrors the reviewer-path caps).
const MAX_ITEMS_PER_SECTION = 25;
const SUMMARY_MAX_CHARS = 300;
const LABEL_MAX_CHARS = 120;

function clamp(s: string, max: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

function renderItems(
  items: ReadonlyArray<{ category: string; summary: string }>,
): string[] {
  const shown = items.slice(0, MAX_ITEMS_PER_SECTION);
  const lines = shown.map((it, i) => `${i + 1}. [${it.category}] ${clamp(it.summary, SUMMARY_MAX_CHARS)}`);
  const omitted = items.length - shown.length;
  if (omitted > 0) lines.push(`(${omitted} more omitted for length.)`);
  return lines;
}

/**
 * Pure formatter: model_context -> "## Matter State" block (or '' when immaterial).
 * Deterministic; no I/O. Exported for unit testing.
 */
export function formatMatterStateBlock(state: MatterStateModelContext): string {
  const sections: string[] = [];

  // Matter identity + phase (always present when we have a matter).
  sections.push(`Matter phase: ${state.matter.phase}.`);
  if (state.operativeDocument) {
    const od = state.operativeDocument;
    const ver = od.currentVersionNumber != null ? ` v${od.currentVersionNumber}` : '';
    sections.push(`Operative document: ${clamp(od.title, LABEL_MAX_CHARS)} (${od.workflowState}${ver}).`);
  }

  // Safe-to-send posture (only when it carries a signal).
  if (state.safeToSend.posture === 'blocked') {
    sections.push(
      `Send status: BLOCKED — ${state.safeToSend.openBlockerCount} open blocker(s) must be resolved before this can be sent.`,
    );
  } else if (state.safeToSend.posture === 'clear') {
    sections.push('Send status: clear (no open blockers).');
  }

  const blockLines: string[] = [];
  if (state.openBlockers.length > 0) {
    blockLines.push(
      '',
      '### Open blockers (must be resolved before send — do not treat as settled)',
      ...renderItems(state.openBlockers),
    );
  }
  if (state.openSubstantive.length > 0) {
    blockLines.push('', '### Open substantive items (unresolved)', ...renderItems(state.openSubstantive));
  }
  if (state.matterLevelItems.length > 0) {
    blockLines.push(
      '',
      '### Matter-level items (apply across the matter; do not force onto any single document)',
      ...renderItems(state.matterLevelItems),
    );
  }
  if (state.operativeSources.length > 0) {
    blockLines.push('', '### Source authority (currency of the materials in play)');
    const shown = state.operativeSources.slice(0, MAX_ITEMS_PER_SECTION);
    shown.forEach((s, i) => {
      const label = s.label ? clamp(s.label, LABEL_MAX_CHARS) : `${s.subjectType}:${s.subjectId}`;
      blockLines.push(`${i + 1}. ${s.authorityOrigin}/${s.lifecycle} — ${label}`);
    });
    const omitted = state.operativeSources.length - shown.length;
    if (omitted > 0) blockLines.push(`(${omitted} more omitted for length.)`);
  }

  const header = [
    '## Matter State (current — reflect this; do not contradict or re-litigate settled state)',
    'This is the supervising attorney\'s current matter context. Treat it as authoritative state,',
    'not as a defect to flag. Engine reports state; the attorney decides.',
  ];

  return [...header, ...sections, ...blockLines].join('\n');
}

/**
 * Build the matter-state context block for injection. Reads the L1-1 read surface in
 * `model_context` mode (owner-scoped) and formats it. Returns '' if no matter state is
 * available. Throws only on a genuine read error — the caller (the dispatch chokepoint)
 * invokes this best-effort so a failure degrades to no-injection rather than a failed call.
 */
export async function buildMatterStateContextBlock(args: {
  matterId: string;
  userId: string;
  documentId?: string;
}): Promise<string> {
  const state = await getMatterState({
    matterId: args.matterId,
    userId: args.userId,
    mode: 'model_context',
    ...(args.documentId !== undefined ? { documentId: args.documentId } : {}),
  });
  if (state.mode !== 'model_context') return '';
  return formatMatterStateBlock(state);
}
