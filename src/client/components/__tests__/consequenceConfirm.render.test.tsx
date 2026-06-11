// @vitest-environment jsdom
/**
 * ConsequenceConfirm render test — CHAT-UI-1 W1 (brief §3 law-6, the spine).
 *
 * The shared consequence-tier confirm: forces the full {issuer, privilege, recipient} triple, runs
 * the coherence table (HARD blocks; SOFT requires an explicit ack), and emits a provenance entry on
 * confirm. THE ISSUER SCENARIO is exercised THROUGH the real component: a "from the owners" issuer
 * change surfaces a deliberate confirm with the full triple — never a silent application.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import ConsequenceConfirm from '../ConsequenceConfirm.js';
import type { Posture } from '../../../shared/posture/postureCoherence.js';

afterEach(() => cleanup());

const base = {
  actor: 'kelly',
  sliderPosition: 'Propose-and-Confirm',
  triggerSource: 'test',
};

const p = (over: Partial<Posture>): Posture => ({
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: null,
  recipient: 'internal_client',
  ...over,
});

const btn = (el: HTMLElement): HTMLButtonElement => el as HTMLButtonElement;

describe('ConsequenceConfirm — coherent posture confirm', () => {
  it('shows the full triple, confirm is enabled, and emits a provenance entry', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="privilege"
        title="Confirm privilege"
        posture={{ prior: p({ privilege: null }), next: p({ privilege: true }) }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    // Full triple displayed (brief §2.2).
    expect(getByTestId('confirm-triple')).toBeTruthy();
    expect(getByTestId('triple-issuer')).toBeTruthy();
    expect(getByTestId('triple-privilege').getAttribute('data-changed')).toBe('true');
    expect(getByTestId('triple-recipient')).toBeTruthy();

    expect(btn(getByTestId('confirm-accept')).disabled).toBe(false);
    fireEvent.click(getByTestId('confirm-accept'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const entry = onConfirm.mock.calls[0][0];
    expect(entry.act).toBe('privilege');
    expect(entry.actor).toBe('kelly');
    expect(entry.nextTriple.privilege).toBe(true);
    expect(entry.resolvedRecipient).toBe('internal_client');
    expect(typeof entry.at).toBe('string');
  });
});

describe('ConsequenceConfirm — HARD block', () => {
  it('privileged -> adverse: confirm is blocked and emits nothing', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="recipient"
        title="Confirm recipient"
        posture={{ next: p({ privilege: true, recipient: 'adverse' }) }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(getByTestId('confirm-hard')).toBeTruthy();
    expect(getByTestId('hard-priv-to-adverse')).toBeTruthy();
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(true);
    fireEvent.click(getByTestId('confirm-accept'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConsequenceConfirm — SOFT warning requires acknowledgement', () => {
  it('privileged -> neutral third party: confirm gated until the warning is acknowledged', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="recipient"
        title="Confirm recipient"
        posture={{ next: p({ privilege: true, recipient: 'neutral_third_party' }) }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(getByTestId('soft-priv-to-third-party')).toBeTruthy();
    // Disabled before ack.
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(true);
    fireEvent.click(getByTestId('confirm-accept'));
    expect(onConfirm).not.toHaveBeenCalled();
    // Acknowledge -> enabled -> confirms, carrying the acknowledged finding.
    fireEvent.click(getByTestId('confirm-soft-ack'));
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(false);
    fireEvent.click(getByTestId('confirm-accept'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const entry = onConfirm.mock.calls[0][0];
    expect(entry.acknowledged.map((f: { id: string }) => f.id)).toContain('priv-to-third-party');
  });
});

describe('ConsequenceConfirm — the issuer scenario, through the component', () => {
  it('"from the owners" surfaces a deliberate confirm with the full triple; issuer marked changed; emits prior+next (never silent)', () => {
    const onConfirm = vi.fn();
    const prior = p({ issuer: { entity: 'the firm', capacity: 'counsel' }, privilege: false, recipient: 'adverse' });
    const next = p({ issuer: { entity: 'the owners', capacity: 'principal' }, privilege: false, recipient: 'adverse' });
    const { getByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="issuer"
        title="Confirm issuer"
        triggerSource="natural-language: 'firm style, no branding, from the owners'"
        posture={{ prior, next }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    // The change is SURFACED, with the whole triple, and the issuer row flagged as changed.
    expect(getByTestId('confirm-triple')).toBeTruthy();
    expect(getByTestId('triple-issuer').getAttribute('data-changed')).toBe('true');
    expect(getByTestId('triple-issuer').textContent).toContain('as a party');
    // Coherent (non-privileged company directive to an adverse party) -> confirm is available but deliberate.
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(false);
    fireEvent.click(getByTestId('confirm-accept'));
    const entry = onConfirm.mock.calls[0][0];
    expect(entry.priorTriple.issuer.capacity).toBe('counsel');
    expect(entry.nextTriple.issuer.capacity).toBe('principal');
  });
});

describe('ConsequenceConfirm — non-posture act with a subject (matter identity, W3)', () => {
  it('renders the subject and emits it on the entry', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="matter_identity"
        title="Confirm matter"
        subject={{ type: 'matter', id: 'B', label: 'Brown EP', detail: 'rebind from A' }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(getByTestId('confirm-subject').textContent).toContain('Brown EP');
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(false);
    fireEvent.click(getByTestId('confirm-accept'));
    const entry = onConfirm.mock.calls[0][0];
    expect(entry.act).toBe('matter_identity');
    expect(entry.subject.id).toBe('B');
    expect(entry.nextTriple).toBeNull();
  });
});

describe('ConsequenceConfirm — generic non-posture act', () => {
  it('a lock confirm shows no triple and emits an entry with a null triple', () => {
    const onConfirm = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <ConsequenceConfirm
        {...base}
        act="lock"
        title="Lock this decision"
        description="Locking is a hard-stop act."
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(queryByTestId('confirm-triple')).toBeNull();
    expect(btn(getByTestId('confirm-accept')).disabled).toBe(false);
    fireEvent.click(getByTestId('confirm-accept'));
    const entry = onConfirm.mock.calls[0][0];
    expect(entry.act).toBe('lock');
    expect(entry.nextTriple).toBeNull();
    expect(entry.resolvedRecipient).toBeNull();
  });
});
