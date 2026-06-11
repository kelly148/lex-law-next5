/**
 * CHAT-UI-1 (live wiring) — confirm routing truth table (interrupt vs queue).
 *
 * The slider + carve-out core: the hard-stop floor always confirms; the slider only changes WHEN it
 * surfaces. HARD always interrupts; Propose-and-Confirm interrupts each; Auto-Act batches batchable
 * posture but interrupts non-posture acts and the BROAD carve-out (adverse/third-party).
 */
import { describe, it, expect } from 'vitest';

import {
  routeConfirmDecision,
  DEFAULT_SLIDER_POSITION,
  type RouteInput,
} from '../../shared/posture/confirmRouting.js';

const auto = (over: Partial<RouteInput> = {}): RouteInput => ({
  isPostureAct: true,
  hasHard: false,
  recipient: 'internal_client',
  sliderPosition: 'auto_act',
  ...over,
});

describe('routeConfirmDecision', () => {
  it('new matters default to Propose-and-Confirm', () => {
    expect(DEFAULT_SLIDER_POSITION).toBe('propose_and_confirm');
  });

  it('a HARD incoherence always interrupts — even in Auto-Act', () => {
    expect(routeConfirmDecision(auto({ hasHard: true }))).toBe('interrupt');
  });

  it('Propose-and-Confirm interrupts every act (posture and non-posture)', () => {
    expect(routeConfirmDecision(auto({ sliderPosition: 'propose_and_confirm' }))).toBe('interrupt');
    expect(
      routeConfirmDecision(auto({ sliderPosition: 'propose_and_confirm', isPostureAct: false, recipient: null })),
    ).toBe('interrupt');
  });

  it('Auto-Act: non-posture hard-stop acts never batch (lock/send/tier/... interrupt)', () => {
    expect(routeConfirmDecision(auto({ isPostureAct: false, recipient: null }))).toBe('interrupt');
  });

  it('Auto-Act: a batchable posture change queues', () => {
    expect(routeConfirmDecision(auto({ recipient: 'internal_client' }))).toBe('queue');
    expect(routeConfirmDecision(auto({ recipient: 'co_counsel_agent' }))).toBe('queue');
  });

  it('Auto-Act: the BROAD carve-out (adverse / third-party) interrupts individually', () => {
    for (const r of ['neutral_third_party', 'regulator_court', 'adverse', 'public'] as const) {
      expect(routeConfirmDecision(auto({ recipient: r }))).toBe('interrupt');
    }
  });
});
