// @vitest-environment jsdom
/**
 * RELAYOUT-2 — MatterRecitalBand render tests (ci-gotchas #10: render, don't trust tsc).
 *
 * Proves the recital band renders all seven blocks from the matterState.dashboard +
 * matterIntake.listParties reads across the state-wording permutations (spec §2.2/§2.4), with the
 * emphasis grammar: amber precondition/needs-you, the reserved severity tint for an undispositioned
 * conflict hit ONLY, never green-from-open_items (G4), NEVER oxblood, no blue. The mocked useQuery
 * calls a real React hook so hook counts behave like production. The cardinal rule (never blank) is
 * asserted via the loading skeleton + always-rendered frame.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockDash = vi.hoisted(() => ({ data: undefined as unknown }));
const mockParties = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      matterState: {
        dashboard: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockDash.data, isLoading: mockDash.data === undefined, isError: false, error: null };
          },
        },
      },
      matterIntake: {
        listParties: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockParties.data, isLoading: mockParties.data === undefined, isError: false, error: null };
          },
        },
      },
      // S13 (UI-ATTORNEY-SWEEP-1): the band now probes conflict-enforcement to quiet the conflicts block
      // when it's OFF. Default the probe ENABLED here so the conflicts block stays present (these tests
      // assert all seven blocks incl. conflicts).
      conflictPolicy: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: true }, isLoading: false, isError: false, error: null };
          },
        },
      },
    },
  };
});

import MatterRecitalBand from '../MatterRecitalBand.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';

interface DashOver {
  jurisdiction?: string | null;
  state?: string;
  reasons?: string[];
  sources?: number;
  superseded?: number;
  openItemsOpen?: number;
  openBlockers?: number;
  divergent?: boolean;
  workflowState?: string | null;
  posture?: string;
}

const dash = (over: DashOver) => ({
  full: {
    mode: 'full',
    counts: {
      sourceAuthorities: over.sources ?? 0,
      openItemsOpen: over.openItemsOpen ?? 0,
      openBlockers: over.openBlockers ?? 0,
    },
    sourceAuthorities: Array.from({ length: over.sources ?? 0 }, (_v, i) => ({
      id: `s${i}`,
      lifecycle: i < (over.superseded ?? 0) ? 'superseded' : 'operative',
    })),
    openItems: over.divergent
      ? [{ id: 'oi1', status: 'open', category: 'divergent_reviewer_feedback' }]
      : Array.from({ length: over.openItemsOpen ?? 0 }, (_v, i) => ({ id: `oi${i}`, status: 'open', category: 'other' })),
    operativeDocument: over.workflowState !== undefined ? { workflowState: over.workflowState } : null,
    safeToSend: { posture: over.posture ?? 'unknown', openBlockerCount: over.openBlockers ?? 0 },
  },
  conflictClearance: { state: over.state ?? 'NOT_ESTABLISHED', reasons: over.reasons ?? ['no_conflict_check'] },
  jurisdiction: over.jurisdiction ?? null,
});

type Party = { role: string; displayName: string; confirmed: boolean };
const parties = (...p: Party[]) => p;

const ALL_BLOCKS = ['jurisdiction', 'client', 'conflicts', 'sources', 'open-items', 'document', 'sendability'];

afterEach(() => cleanup());
beforeEach(() => { mockDash.data = undefined; mockParties.data = undefined; });

describe('MatterRecitalBand — RELAYOUT-2 recital band', () => {
  it('empty/precondition matter: amber preconditions, neutral not-started, never green', () => {
    mockDash.data = dash({}); // no jurisdiction, no_conflict_check, no sources/items/doc, posture unknown
    mockParties.data = parties();
    const { container, getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    // all seven blocks present
    for (const k of ALL_BLOCKS) expect(getByTestId(`band-block-${k}`)).toBeTruthy();
    expect(getByTestId('band-value-jurisdiction').textContent).toBe('Not set');
    expect(getByTestId('band-value-client').textContent).toBe('None yet');
    expect(getByTestId('band-value-conflicts').textContent).toBe('Not yet run'); // NEVER "No conflicts"
    expect(getByTestId('band-value-sources').textContent).toBe('None yet');
    expect(getByTestId('band-value-open-items').textContent).toBe('None');
    expect(getByTestId('band-value-document').textContent).toBe('No document yet');
    expect(getByTestId('band-value-sendability').textContent).toBe('Not checked'); // G4 neutral, not green
    // no oxblood, no blue, no "No conflicts"
    expect(container.innerHTML).not.toMatch(/accent/);
    expect(container.innerHTML).not.toMatch(/blue/);
    expect(container.textContent ?? '').not.toMatch(/No conflicts/);
  });

  it('cleared + populated matter: identity values, cleared (green), advisory sendability (never green)', () => {
    mockDash.data = dash({ jurisdiction: 'VA', state: 'CLEARED', reasons: [], sources: 3, superseded: 0, openItemsOpen: 0, workflowState: 'drafting', posture: 'clear' });
    mockParties.data = parties(
      { role: 'client', displayName: 'John Smith', confirmed: true },
      { role: 'adverse', displayName: 'Acme Co', confirmed: true },
      { role: 'related', displayName: 'Jane Doe', confirmed: true },
    );
    const { getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    expect(getByTestId('band-value-jurisdiction').textContent).toBe('Virginia');
    expect(getByTestId('band-value-client').textContent).toBe('John Smith +2');
    expect(getByTestId('band-value-conflicts').textContent).toBe('Cleared');
    expect(getByTestId('band-value-conflicts').className).toMatch(/text-success/); // muted green
    expect(getByTestId('band-value-sources').textContent).toBe('3 · current');
    expect(getByTestId('band-value-document').textContent).toBe('Drafting'); // G3: workflowState
    // G4: clear posture must NOT render green; conservative amber advisory
    expect(getByTestId('band-value-sendability').textContent).toBe('Advisory — review');
    expect(getByTestId('band-value-sendability').className).not.toMatch(/text-success/);
    expect(getByTestId('band-value-sendability').className).toMatch(/text-warning/);
  });

  it('blocked + divergent + stale + unconfirmed: severity tint for the conflict hit only', () => {
    mockDash.data = dash({ jurisdiction: 'MD', state: 'BLOCKED', reasons: ['undispositioned_blocker'], sources: 3, superseded: 1, openItemsOpen: 2, openBlockers: 1, divergent: true, workflowState: 'substantively_accepted', posture: 'blocked' });
    mockParties.data = parties(
      { role: 'client', displayName: 'John Smith', confirmed: false },
      { role: 'adverse', displayName: 'Acme Co', confirmed: true },
    );
    const { getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    expect(getByTestId('band-value-jurisdiction').textContent).toBe('Maryland');
    expect(getByTestId('band-value-client').textContent).toBe('John Smith +1 · 1 unconfirmed');
    expect(getByTestId('band-value-client').className).toMatch(/text-warning/); // unconfirmed -> amber
    // the ONE reserved severity tint — undispositioned conflict hit
    expect(getByTestId('band-value-conflicts').textContent).toBe('Hit awaiting disposition');
    expect(getByTestId('band-value-conflicts').className).toMatch(/text-danger/);
    expect(getByTestId('band-value-sources').textContent).toBe('3 · 1 stale');
    expect(getByTestId('band-value-open-items').textContent).toBe('2 open · review divergences');
    expect(getByTestId('band-value-document').textContent).toBe('In review');
    expect(getByTestId('band-value-sendability').textContent).toBe('Advisory — review');
  });

  it('the severity tint is reserved: no OTHER block ever uses text-danger', () => {
    mockDash.data = dash({ jurisdiction: null, state: 'NOT_ESTABLISHED', reasons: ['no_client_party'], sources: 2, superseded: 1, openItemsOpen: 5, openBlockers: 3, workflowState: 'drafting', posture: 'blocked' });
    mockParties.data = parties();
    const { getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    // many amber/needs-you signals, but NONE may borrow the conflict severity color
    for (const k of ['jurisdiction', 'client', 'sources', 'open-items', 'document', 'sendability']) {
      expect(getByTestId(`band-value-${k}`).className).not.toMatch(/text-danger/);
    }
  });

  it('compact single band (one-viewport proxy): one bounded flex-wrap row, never blank', () => {
    mockDash.data = dash({ jurisdiction: 'VA', state: 'CLEARED', sources: 1, workflowState: 'drafting', posture: 'unknown' });
    mockParties.data = parties({ role: 'client', displayName: 'A', confirmed: true });
    const { getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    const band = getByTestId('recital-band');
    expect(band.className).toMatch(/flex-wrap/); // wraps, never horizontal-scrolls
    expect(band.className).not.toMatch(/overflow-x|overflow-scroll/);
    expect(band.querySelectorAll('[data-testid^="band-block-"]').length).toBe(7);
  });

  it('shows a skeleton (not a crash, never blank) before the dashboard read resolves', () => {
    mockDash.data = undefined;
    const { getByTestId } = render(<MatterRecitalBand matterId={MATTER_ID} />);
    expect(getByTestId('recital-band-loading')).toBeTruthy();
  });
});
