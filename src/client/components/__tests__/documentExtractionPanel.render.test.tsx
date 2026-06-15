// @vitest-environment jsdom
/**
 * DocumentExtractionPanel render test — FOLD-PM-2.
 *
 * Asserts: (1) when enabled with an extraction, the type + fields + confidence render
 * and the low-confidence + withheld honesty signals surface; (2) the not-yet-extracted
 * state; (3) when the flag is OFF, the panel renders nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockState = vi.hoisted(() => ({
  enabled: true,
  extraction: null as unknown,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      materialExtraction: {
        isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) },
        getForMaterial: { useQuery: q(() => mockState.extraction) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import { DocumentExtractionPanel } from '../DocumentExtractionPanel.js';

function renderPanel(): HTMLElement {
  const { container } = render(<DocumentExtractionPanel materialId="cccccccc-cccc-cccc-cccc-cccccccccccc" />);
  return container;
}

afterEach(() => {
  cleanup();
  mockState.enabled = true;
  mockState.extraction = null;
});

describe('DocumentExtractionPanel — FOLD-PM-2', () => {
  it('renders the extraction result with type, fields, and honesty signals', () => {
    mockState.extraction = {
      documentType: 'title_commitment',
      typeConfidence: 80,
      overallConfidence: 84,
      lowConfidence: true,
      fields: [
        { key: 'commitmentNumber', label: 'Commitment number', value: 'AC-1', confidence: 88, withheld: false },
        { key: 'legalDescription', label: 'Legal description', value: null, confidence: 55, withheld: true },
        { key: 'policyAmount', label: 'Policy amount', value: null, confidence: 0, withheld: false },
      ],
      warnings: ['fields_withheld_low_confidence:1'],
    };
    const c = renderPanel();
    expect(c.querySelector('[data-testid="document-extraction-panel"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="extraction-result"]')).toBeTruthy();
    expect(c.querySelectorAll('[data-testid="extraction-field"]').length).toBe(3);
    expect(c.querySelector('[data-testid="extraction-low-confidence"]')).toBeTruthy();
    expect(c.textContent).toContain('Title commitment');
    expect(c.textContent).toContain('AC-1');
    expect(c.textContent).toContain('withheld');
    expect(c.textContent).toContain('not found');
  });

  it('renders the not-yet-extracted state when there is no extraction', () => {
    mockState.extraction = null;
    const c = renderPanel();
    expect(c.querySelector('[data-testid="document-extraction-panel"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="extraction-result"]')).toBeNull();
    expect(c.querySelector('[data-testid="extraction-run-button"]')?.textContent).toContain('Extract');
  });

  it('renders nothing when the flag is OFF', () => {
    mockState.enabled = false;
    const c = renderPanel();
    expect(c.querySelector('[data-testid="document-extraction-panel"]')).toBeNull();
  });
});
