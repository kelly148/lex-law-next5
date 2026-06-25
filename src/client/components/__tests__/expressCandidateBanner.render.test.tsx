// @vitest-environment jsdom
/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E7a — ExpressCandidateBanner render test (ci-gotchas #10: render, don't trust tsc).
 *
 * The banner is PURE PRESENTATIONAL (props-driven; no trpc, no state). It asserts:
 *  - the non-final disclosure copy renders (NOT final, sendable, fileable, or recordable);
 *  - the unresolved-escalation count + the escalation list render;
 *  - the can't-approve-yet state when escalations are unresolved (button disabled, blocked copy);
 *  - the approve-enabled state when all escalations are dispositioned (button enabled, approve copy).
 * Mirrors the existing client render-test harness (jsdom + @testing-library/react).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  ExpressCandidateBanner,
  type ExpressBannerEscalation,
} from '../ExpressCandidateBanner.js';

afterEach(() => cleanup());

const ESCALATIONS: ExpressBannerEscalation[] = [
  { id: 'e1-1', riskBucket: 'high', reason: 'Touches the warranty/covenant block' },
  { id: 'e1-2', riskBucket: 'medium', reason: 'Near a protected span boundary' },
];

describe('ExpressCandidateBanner', () => {
  it('always discloses the candidate is NOT final/sendable/fileable/recordable', () => {
    const { getByTestId } = render(
      <ExpressCandidateBanner canApprove={false} unresolvedEscalations={ESCALATIONS} />,
    );
    const banner = getByTestId('express-candidate-banner');
    expect(banner.textContent).toContain('Express produced a candidate draft');
    expect(banner.textContent).toContain('NOT final, sendable, fileable, or recordable');
  });

  it('renders the unresolved escalation count and lists each escalation', () => {
    const { getByTestId, getAllByTestId } = render(
      <ExpressCandidateBanner canApprove={false} unresolvedEscalations={ESCALATIONS} />,
    );
    const instruction = getByTestId('express-candidate-banner-instruction');
    expect(instruction.textContent).toContain('2');
    expect(instruction.textContent).toMatch(/escalations/i);
    expect(getAllByTestId('express-escalation-item')).toHaveLength(2);
    expect(getByTestId('express-candidate-banner-escalations').textContent).toContain(
      'Touches the warranty/covenant block',
    );
  });

  it("can't-approve state: unresolved escalations -> approve button DISABLED + blocked copy", () => {
    const { getByTestId, queryByTestId } = render(
      <ExpressCandidateBanner canApprove={false} unresolvedEscalations={ESCALATIONS} />,
    );
    expect(queryByTestId('express-approve-blocked')).not.toBeNull();
    expect(queryByTestId('express-approve-enabled')).toBeNull();
    const button = getByTestId('express-approve-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('approve-enabled state: all dispositioned (canApprove true) -> button ENABLED + approve copy', () => {
    let clicked = 0;
    const { getByTestId, queryByTestId } = render(
      <ExpressCandidateBanner
        canApprove={true}
        unresolvedEscalations={[]}
        onApprove={() => {
          clicked++;
        }}
      />,
    );
    expect(queryByTestId('express-approve-enabled')).not.toBeNull();
    expect(queryByTestId('express-approve-blocked')).toBeNull();
    const button = getByTestId('express-approve-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(clicked).toBe(1);
    // With no escalations there is no list, and the instruction notes approval is still required.
    expect(queryByTestId('express-candidate-banner-escalations')).toBeNull();
    expect(getByTestId('express-candidate-banner-instruction').textContent).toMatch(/approval are still required/i);
  });

  it('a disabled approve button does not fire onApprove even if clicked', () => {
    let clicked = 0;
    const { getByTestId } = render(
      <ExpressCandidateBanner
        canApprove={false}
        unresolvedEscalations={ESCALATIONS}
        onApprove={() => {
          clicked++;
        }}
      />,
    );
    fireEvent.click(getByTestId('express-approve-button'));
    expect(clicked).toBe(0);
  });
});
