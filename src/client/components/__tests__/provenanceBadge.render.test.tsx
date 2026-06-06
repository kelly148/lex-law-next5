// @vitest-environment jsdom
/**
 * R2 #5 — ProvenanceBadge render + facet-grammar tests (ci-gotchas #10).
 *
 * Asserts the fixed facet grammar (origin · verification · currency · severity) maps to the right
 * tones/labels, that lower-trust origins (model_derived / counterparty) and unverified/stale read as
 * attention, that disclosure is click/focus (not hover-only) and reveals plain-English detail, and
 * that nothing renders blue (R1-CLEANUP-1).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ProvenanceBadge, { originFacet, verificationFacet, currencyFacet, severityFacet } from '../ProvenanceBadge.js';

afterEach(() => cleanup());

describe('ProvenanceBadge — facet grammar (pure resolvers)', () => {
  it('lower-trust origins read as attention; routine origins neutral', () => {
    expect(originFacet('model_derived').tone).toBe('attention');
    expect(originFacet('counterparty').tone).toBe('attention');
    expect(originFacet('firm').tone).toBe('neutral');
    expect(originFacet('operative').tone).toBe('neutral');
  });

  it('verification: verified=good, unverified/stale=attention, superseded/not_legal_authority=muted', () => {
    expect(verificationFacet('verified').tone).toBe('good');
    expect(verificationFacet('attorney_verified_current').tone).toBe('good');
    expect(verificationFacet('unverified').tone).toBe('attention');
    expect(verificationFacet('stale').tone).toBe('attention');
    expect(verificationFacet('superseded').tone).toBe('muted');
    expect(verificationFacet('not_legal_authority').tone).toBe('muted');
  });

  it('currency: superseded=muted, current/operative=neutral; severity: blocker=alert, review=attention', () => {
    expect(currencyFacet('superseded').tone).toBe('muted');
    expect(currencyFacet('operative').tone).toBe('neutral');
    expect(severityFacet('blocker').tone).toBe('alert');
    expect(severityFacet('review').tone).toBe('attention');
  });
});

describe('ProvenanceBadge — render + disclosure', () => {
  it('renders the provided facet labels and no blue', () => {
    const { container } = render(<ProvenanceBadge origin="model_derived" verification="unverified" currency="operative" />);
    const t = container.textContent ?? '';
    expect(t).toContain('AI-derived');
    expect(t).toContain('Unverified');
    expect(container.innerHTML).not.toMatch(/blue/);
  });

  it('detail is hidden until click/focus (not hover-only), then reveals plain-English text', () => {
    const { container, getByRole } = render(<ProvenanceBadge verification="unverified" />);
    expect(container.textContent ?? '').not.toContain('re-verify against current law');
    fireEvent.click(getByRole('button'));
    expect(container.textContent ?? '').toContain('re-verify against current law');
  });

  it('renders nothing when given no facets', () => {
    const { container } = render(<ProvenanceBadge />);
    expect(container.querySelector('[data-testid="provenance-badge"]')).toBeNull();
  });
});
