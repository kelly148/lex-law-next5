/**
 * AUTOMATED-UAT-SUITE-1 — durable encoding of the MONSTER UAT master test matrix
 * (outputs/MONSTER_UAT_FINDINGS_2026-06-15.md, "UAT MASTER TEST MATRIX").
 *
 * Each matrix row is exercised here to the extent it can be WITHOUT live providers or a running server,
 * using the project's pure-function + source-audit idioms. Rows that genuinely need a live provider, DB,
 * or browser are enumerated as DOCUMENTED MANUAL-UAT items (the `manualUat` table at the bottom) and are
 * NOT attempted here — they are for the operator/Cowork post-deploy pass.
 *
 * This is a regression net for the four failure-classes the audit watches:
 *   (a) raw JSON / internal markers reaching a card, (b) a lane mislabeled, (c) a wedged session,
 *   (d) an honest-state error (fake success / hidden failure).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveReviewerModel,
  validateReviewerModels,
  REVIEWER_MODELS,
  LITE_REVIEWER_MODELS,
} from '../llm/config.js';
import { getModelCapability } from '../llm/modelCapabilities.js';
import { stripEmbeddedCardsJson } from '../../client/utils/feedbackCardDisplay.js';
import {
  deriveLaneDisplayState,
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../shared/schemas/reviewerLaneState.js';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewPane = read('src/client/components/ReviewPane.tsx');
const chatReviewPanel = read('src/client/components/ChatReviewPanel.tsx');
const reviewSessionProc = read('src/server/procedures/reviewSession.ts');
const chatReviewPanelProc = read('src/server/procedures/chatReviewPanel.ts');

function lane(role: string, status: ReviewerLaneStatus, suggestionCount: number | null = null): ReviewerLaneView {
  return {
    reviewerRole: role,
    reviewerTitle: role,
    status,
    terminal: isTerminalLaneStatus(status),
    suggestionCount,
    failureReason: null,
    jobStatus: null,
    dispatchedAt: null,
    terminalizedAt: null,
    updatedAt: '2026-06-15T00:00:00.000Z',
  } as ReviewerLaneView;
}

// ── Rows 1 + 2: every reviewer (FULL + LITE) resolves to a recognized id; a bad id is rejected ───────
describe('UAT row 1+2 — reviewer-id resolution + startup validation (no wedged-on-bad-id)', () => {
  const ALL_KEYS = [
    'claude', 'gpt', 'gemini', 'grok',
    'claude_lite', 'gpt_lite', 'gemini_lite', 'grok_lite',
  ];

  it('all 8 reviewer keys resolve to a registered model id', () => {
    for (const key of ALL_KEYS) {
      const id = resolveReviewerModel(key);
      expect(id, `${key} resolves`).toBeDefined();
      expect(getModelCapability(id!), `${key} -> ${id} is registered`).toBeDefined();
    }
  });

  it('gpt_lite is pinned to a known-good id (not the unavailable gpt-5.4-mini that wedged tonight)', () => {
    // CR-2: default is gpt-4.1-mini unless the operator overrode LITE_OPENAI_REVIEWER_MODEL.
    const id = LITE_REVIEWER_MODELS.gpt_lite;
    expect(getModelCapability(id)).toBeDefined();
  });

  it('the current resolved reviewer set passes boot validation; a typo throws at boot', () => {
    expect(() => validateReviewerModels(REVIEWER_MODELS, LITE_REVIEWER_MODELS)).not.toThrow();
    expect(() => validateReviewerModels({ gpt: 'openai:not-real' }, {})).toThrow(/not a recognized model/);
  });
});

// ── Row 3: async multi-lane — honest N-of-M, send-blocked while partial, per-lane honesty ────────────
describe('UAT row 3 — async multi-lane honest N-of-M + send-blocked banner', () => {
  it('a partial run is incomplete (send-blocked) with an honest N-of-M denominator that never shrinks', () => {
    const c = buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 3),
      lane('gpt', 'running'),
      lane('gemini', 'pending'),
    ]);
    expect(c.aggregate.expected).toBe(3); // denominator = intended set
    expect(c.aggregate.returned).toBe(1);
    expect(c.allTerminal).toBe(false);
    expect(c.displayState).toBe('partial');
    expect(c.incomplete).toBe(true); // send-blocked while partial
  });

  it('a completed run with a failed lane reads complete_with_failures and stays incomplete (honest)', () => {
    const c = buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 4),
      lane('gpt', 'failed'),
    ]);
    expect(c.displayState).toBe('complete_with_failures');
    expect(c.aggregate.failed).toBe(1);
    expect(c.incomplete).toBe(true); // a failure keeps it honestly incomplete
  });

  it('an all-failed run is all_failed (never silently "complete"); an affirmative zero is no_suggestions', () => {
    expect(deriveLaneDisplayState([lane('gpt', 'failed'), lane('grok', 'timed_out')]).displayState).toBe('all_failed');
    expect(
      deriveLaneDisplayState([lane('claude', 'completed_without_feedback', 0), lane('gpt', 'completed_without_feedback', 0)]).displayState,
    ).toBe('no_suggestions');
  });

  it('a fully-returned run with suggestions is complete and not incomplete', () => {
    const c = buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 2),
      lane('gpt', 'completed_with_feedback', 1),
    ]);
    expect(c.displayState).toBe('complete');
    expect(c.incomplete).toBe(false);
    expect(c.totalSuggestions).toBe(3);
  });
});

// ── Row 4 + clean-card stripping on ALL display paths: no raw marker ever renders ────────────────────
describe('UAT row 4 — clean cards on every display path (no raw STRUCTURED_FEEDBACK_CARDS)', () => {
  const legacyBody =
    'NARRATIVE_REVIEWER_MEMO: The cap is one-sided.\nSTRUCTURED_FEEDBACK_CARDS\n[{"id":"c1","body":"internal"}]';

  it('the sanitizer removes the marker + internal JSON and keeps the narrative', () => {
    const clean = stripEmbeddedCardsJson(legacyBody);
    expect(clean).not.toContain('STRUCTURED_FEEDBACK_CARDS');
    expect(clean).not.toContain('internal');
    expect(clean).toContain('cap is one-sided');
  });

  it('ReviewPane routes the live narrative AND the History body through the sanitizer (CR-3)', () => {
    expect(reviewPane).toContain('stripEmbeddedCardsJson(suggestion.body)'); // live lane
    expect(reviewPane).toContain('{stripEmbeddedCardsJson(s.body)}'); // History overlay (CR-3 fix)
    expect(reviewPane).not.toContain('mt-0.5">{s.body}</p>'); // the old raw render is gone
  });

  it('ChatReviewPanel routes the panel suggestion through the sanitizer (HI-4)', () => {
    expect(chatReviewPanel).toContain('{stripEmbeddedCardsJson(item.suggestion)}');
    expect(chatReviewPanel).not.toContain('text-ink">{item.suggestion}</p>');
  });
});

// ── Row 6: stuck-session recovery behavior (current, reaper-gated) ───────────────────────────────────
describe('UAT row 6 — stuck-session recovery (current behavior; CR-4 is a separate FIRE proposal)', () => {
  it('create self-heals a stuck-active session when no reviewer job is in flight (reaper-gated)', () => {
    // The "no in-flight reviewer => abandon and proceed" recovery exists and is owner-scoped.
    expect(reviewSessionProc).toContain("statuses: ['queued', 'running']");
    expect(reviewSessionProc).toContain('liveReviewers.length === 0');
    expect(reviewSessionProc).toContain("updateReviewSessionState(existingSession.id, userId, 'abandoned')");
    // Honest dead-end avoidance: the throw carries the sessionId so the client can resume, not just error.
    expect(reviewSessionProc).toContain('SESSION_ALREADY_EXISTS:');
  });
});

// ── Row 7: copilot panel dispositioner — retry once + honest degraded fallback (never fabricated) ────
describe('UAT row 7 — dispositioner retries once then degrades honestly', () => {
  it('synthesis retries exactly once on a retryable malformed set, then preserves the honest fallback', () => {
    // CHAT-PANEL-DISPOSITIONER-CEILING-1 parameterized attemptSynthesis with a per-attempt budget;
    // pin the single guarded-retry INTENT (retries at most once) rather than the brittle arg-less
    // call spelling, so a behavior-preserving refactor doesn't false-fail this UAT row.
    expect(chatReviewPanelProc).toMatch(/if \(!synth\.ok && synth\.retryable\)/);
    expect(chatReviewPanelProc).toMatch(/synth = await attemptSynthesis\([^)]*\);/);
    expect(chatReviewPanelProc).toMatch(/[Ee]xactly once/);
    // degraded => suggestions kept with primaryDisposition null ("not yet synthesized"), never fabricated
    expect(chatReviewPanelProc).toContain("dispositionerStatus = 'failed'");
    expect(chatReviewPanelProc).toMatch(/NEVER fabricate/i);
  });

  it('a disposition DB-write failure after a successful synthesis is logged as infra, not model-quality (ME-7)', () => {
    expect(chatReviewPanelProc).toContain('disposition DB write FAILED after a successful synthesis');
  });
});

// ── Row 8: sendability is advisory — copy/palette never overstate send-clearance (ME-5) ──────────────
describe('UAT row 8 — sendability advisory copy/palette (no green-as-safe)', () => {
  it('the "no blockers" state uses a neutral icon + advisory copy, not a success-green check', () => {
    expect(reviewPane).toContain('No blockers detected by the advisory check');
    expect(reviewPane).toContain('<Info className="w-3.5 h-3.5 text-gray-400" />');
    expect(reviewPane).not.toContain('<CheckCircle className="w-3.5 h-3.5 text-green-600" />');
  });
});

// ── DOCUMENTED MANUAL-UAT items: need a live provider / DB / browser; NOT automated here ──────────────
describe('UAT manual-only rows (documented; operator/Cowork post-deploy pass)', () => {
  const manualUat: Array<{ row: number | string; surface: string; why: string }> = [
    { row: '1/2 (live)', surface: 'each provider full+lite returns clean cards live', why: 'needs live provider keys + dispatch' },
    { row: 5, surface: 'select >=1 suggestion + regenerate; adopted text carried, no partial-adopt wedge', why: 'needs DB + regenerate job' },
    { row: 7, surface: 'panel review end-to-end; all reviewers return, dispositions render', why: 'needs live providers + DB' },
    { row: 9, surface: 'masters: lawfirm draft / chat injection / outline on an elected matter', why: 'needs DB + generation' },
    { row: 10, surface: 'deliverables / supervision / doc-extraction; supervision logs egress', why: 'needs DB + flags + extraction' },
    { row: 11, surface: 'deleteMatter cascades cleanly; audit/egress preserved', why: 'needs DB' },
    { row: 12, surface: 'export DOCX of the substantive current version', why: 'needs DB + export pipeline' },
  ];
  it('enumerates the manual-UAT rows that cannot run without live infra (handed to the post-deploy pass)', () => {
    expect(manualUat.length).toBeGreaterThanOrEqual(7);
    for (const m of manualUat) {
      expect(m.surface.length).toBeGreaterThan(0);
      expect(m.why).toMatch(/needs/);
    }
  });
});
