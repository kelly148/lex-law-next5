/**
 * LEAK-PARITY-SWEEP-1 — client leak/parity GUARD (source-audit + sanitizer behavior).
 *
 * Finishes the raw-internal-data leak sweep the async-lane fix started, across the remaining display
 * surfaces the overnight MONSTER UAT audit found (outputs/MONSTER_UAT_FINDINGS_2026-06-15.md):
 *   CR-3 — ReviewPane Prior-Feedback (History) overlay rendered {s.body} RAW (embedded
 *          STRUCTURED_FEEDBACK_CARDS JSON leaked to the attorney). Now stripEmbeddedCardsJson(s.body).
 *   HI-4 — ChatReviewPanel rendered {item.suggestion} RAW (raw-LLM-text fallback). Now sanitized.
 *   ME-5 — Sendability "no blockers" used success-green + a green check (reads as send-clearance).
 *          Now a NEUTRAL info icon + advisory copy (no green-as-safe).
 *   ME-6 — The History overlay was the only review overlay not wrapped in PanelErrorBoundary. Now wrapped.
 *
 * Style mirrors reviewer_async_display_1.client_guard.test.ts (the sibling leak-fix guard).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripEmbeddedCardsJson } from '../../client/utils/feedbackCardDisplay.js';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewPane = read('src/client/components/ReviewPane.tsx');
const chatReviewPanel = read('src/client/components/ChatReviewPanel.tsx');

// ─── Behavioral invariant: the sanitizer removes the marker on a realistic legacy body ───────────────
describe('LEAK-PARITY-SWEEP-1 — sanitizer strips embedded card JSON (the leak-prevention invariant)', () => {
  const legacyBody = [
    'NARRATIVE_REVIEWER_MEMO: The indemnity clause is one-sided; consider a mutual cap.',
    'STRUCTURED_FEEDBACK_CARDS',
    JSON.stringify([{ id: 'c1', title: 'Indemnity', severity: 'high', body: 'internal plumbing' }]),
  ].join('\n');

  it('drops everything from the STRUCTURED_FEEDBACK_CARDS marker onward', () => {
    const clean = stripEmbeddedCardsJson(legacyBody);
    expect(clean).not.toContain('STRUCTURED_FEEDBACK_CARDS');
    expect(clean).not.toContain('internal plumbing');
    expect(clean).toContain('indemnity clause is one-sided');
  });

  it('strips the NARRATIVE_REVIEWER_MEMO label and is legacy-safe / never throws', () => {
    expect(stripEmbeddedCardsJson(legacyBody).startsWith('NARRATIVE_REVIEWER_MEMO')).toBe(false);
    expect(stripEmbeddedCardsJson('plain body, no markers')).toBe('plain body, no markers');
    expect(stripEmbeddedCardsJson('')).toBe('');
    // @ts-expect-error — guarding the non-string degrade path
    expect(stripEmbeddedCardsJson(null)).toBe('');
  });
});

// ─── CR-3 + HI-4: the leaky render sites now route through the sanitizer (no raw render) ──────────────
describe('LEAK-PARITY-SWEEP-1 — CR-3/HI-4 no raw model-body render', () => {
  it('CR-3: the History overlay renders the sanitized body, not raw {s.body}', () => {
    expect(reviewPane).toContain('{stripEmbeddedCardsJson(s.body)}');
    expect(reviewPane).not.toContain('mt-0.5">{s.body}</p>');
  });

  it('HI-4: ChatReviewPanel imports the sanitizer and renders the sanitized suggestion, not raw {item.suggestion}', () => {
    expect(chatReviewPanel).toContain("import { stripEmbeddedCardsJson } from '../utils/feedbackCardDisplay.js';");
    expect(chatReviewPanel).toContain('{stripEmbeddedCardsJson(item.suggestion)}');
    expect(chatReviewPanel).not.toContain('text-ink">{item.suggestion}</p>');
  });
});

// ─── ME-5: sendability advisory palette/copy (no green-as-safe) ──────────────────────────────────────
describe('LEAK-PARITY-SWEEP-1 — ME-5 sendability is advisory, not send-clearance', () => {
  it('the "no blockers" state uses a neutral info icon, not a success-green check', () => {
    expect(reviewPane).toContain('<Info className="w-3.5 h-3.5 text-gray-400" />');
    // the prior green check on the sendable branch is gone
    expect(reviewPane).not.toContain('<CheckCircle className="w-3.5 h-3.5 text-green-600" />');
  });

  it('the copy names it as the advisory check, not an affirmative clearance', () => {
    expect(reviewPane).toContain('No blockers detected by the advisory check');
  });
});

// ─── ME-6: the History overlay is wrapped in PanelErrorBoundary like its siblings ────────────────────
describe('LEAK-PARITY-SWEEP-1 — ME-6 History overlay is error-bounded', () => {
  it('wraps HistorySection in PanelErrorBoundary', () => {
    expect(reviewPane).toContain(
      '<PanelErrorBoundary label="Prior feedback"><HistorySection documentId={documentId} currentIterationNumber={session.iterationNumber} /></PanelErrorBoundary>',
    );
  });
});
