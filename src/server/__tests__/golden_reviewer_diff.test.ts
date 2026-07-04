/**
 * ULTRABUILD-1 W6 — golden reviewer-prompt semantic-diff core (built DARK; NO live provider calls).
 *
 * Exercises extractSignature/diffSignature over CANNED synthetic reviewer outputs (legacy JSON arrays of
 * {title, body, severity}) — the exact fixtures the dark harness consumes. Proves: a PASS baseline per scenario
 * yields the expected feature signature; a drifted output flips the right feature (and diffSignature localizes
 * it); a malformed output is PARSE_FAILURE. Pure — string in, object out, zero egress.
 */
import { describe, it, expect } from 'vitest';
import { extractSignature, diffSignature, type GoldenSignature } from '../calibration/goldenReviewerDiff.js';

const j = (items: Array<{ title: string; body: string; severity: 'critical' | 'major' | 'minor' }>): string =>
  JSON.stringify(items);

describe('W6 — extractSignature per scenario (PASS baselines)', () => {
  it('P8-T1: an empty output (routine blanks suppressed) is PASS', () => {
    const sig = extractSignature('P8-T1', j([]));
    expect(sig.status).toBe('PASS');
    expect(sig.features['flagsRoutineBlank']).toBe(false);
    expect(sig.features['emptyOutput']).toBe(true);
  });

  it('P8-T6: flags audience over-disclosure (major) while preserving the offer is PASS', () => {
    const sig = extractSignature(
      'P8-T6',
      j([{ title: 'Audience over-disclosure', body: 'The letter to opposing counsel reveals the internal walk-away number — a substantive drafting/audience risk.', severity: 'major' }]),
    );
    expect(sig.status).toBe('PASS');
    expect(sig.features).toMatchObject({ flagsAudienceRisk: true, preservesOffer: true, substantive: true });
  });

  it('P8-T7: identifies the governing-law mismatch as a blocker is PASS', () => {
    const sig = extractSignature(
      'P8-T7',
      j([{ title: 'Governing law mismatch', body: 'This VA agreement carries a California governing-law clause; a blocker that must be resolved before send.', severity: 'critical' }]),
    );
    expect(sig.status).toBe('PASS');
    expect(sig.features).toMatchObject({ identifiesGoverningLaw: true, escalatesBlocker: true });
  });

  it('P8-T10: surfaces both paths + requires an attorney decision, without choosing, is PASS', () => {
    const sig = extractSignature(
      'P8-T10',
      j([{ title: 'Recourse structure not selected', body: 'The note is non-recourse by template default. Surface both the recourse (with cap) and non-recourse paths — this is a business decision that requires an attorney decision.', severity: 'major' }]),
    );
    expect(sig.status).toBe('PASS');
    expect(sig.features).toMatchObject({ surfacesBothPaths: true, requiresAttorneyDecision: true, choosesPath: false });
  });
});

describe('W6 — drift is detected + localized', () => {
  it('P8-T1 drift: flagging a routine notary blank flips flagsRoutineBlank -> FAIL', () => {
    const baseline = extractSignature('P8-T1', j([]));
    const drifted = extractSignature('P8-T1', j([{ title: 'Missing signature', body: 'The signature block is blank and the notary acknowledgment is incomplete.', severity: 'minor' }]));
    expect(drifted.status).toBe('FAIL');
    const diff = diffSignature(baseline, drifted);
    expect(diff.map((d) => d.field)).toEqual(expect.arrayContaining(['status', 'features.flagsRoutineBlank']));
  });

  it('P8-T6 drift: telling the attorney to change the offer flips preservesOffer -> FAIL', () => {
    const drifted = extractSignature('P8-T6', j([{ title: 'Offer', body: 'You should change the 50/50 split to be more favorable.', severity: 'minor' }]));
    expect(drifted.status).toBe('FAIL');
    expect(drifted.features['preservesOffer']).toBe(false);
  });

  it('P8-T10 drift: recommending a path flips choosesPath -> FAIL', () => {
    const drifted = extractSignature('P8-T10', j([{ title: 'Use non-recourse', body: 'I recommend the non-recourse structure for this note.', severity: 'major' }]));
    expect(drifted.status).toBe('FAIL');
    expect(drifted.features['choosesPath']).toBe(true);
  });

  it('an identical signature has NO drift', () => {
    const a: GoldenSignature = extractSignature('P8-T7', j([{ title: 'x', body: 'California governing law is a blocker before send.', severity: 'critical' }]));
    expect(diffSignature(a, a)).toEqual([]);
  });
});

describe('W6 — malformed output is PARSE_FAILURE (a detectable drift)', () => {
  it('non-JSON raw output', () => {
    const sig = extractSignature('P8-T6', 'the model returned prose, not JSON');
    expect(sig.status).toBe('PARSE_FAILURE');
    expect(sig.itemCount).toBe(0);
  });
});
