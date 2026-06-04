/**
 * FOLD-DRAFT-1 Increment 2 — provenance integrity rules (PURE).
 *
 * Tests the originType<->originId invariant enforced by the record mutation. The tRPC
 * procedures + DB writes (listForVersion/listForDocument/record) run live (no test DB);
 * they are thin owner-scoped glue over the Inc1 queries.
 */

import { describe, it, expect } from 'vitest';
import { originRequiresId, validateProvenanceOrigin } from '../draft/provenanceRules.js';

describe('FOLD-DRAFT-1 Inc2 — originRequiresId', () => {
  it('source-referencing types require an id', () => {
    for (const t of ['operative_source', 'material', 'adopted_suggestion', 'template', 'loi'] as const) {
      expect(originRequiresId(t)).toBe(true);
    }
  });
  it('self-authored / model types do not', () => {
    expect(originRequiresId('attorney_authored')).toBe(false);
    expect(originRequiresId('model_generated')).toBe(false);
  });
});

describe('FOLD-DRAFT-1 Inc2 — validateProvenanceOrigin', () => {
  it('source-referencing type WITH an originId is valid', () => {
    expect(validateProvenanceOrigin('material', 'mat-123').ok).toBe(true);
  });

  it('source-referencing type WITHOUT an originId is rejected', () => {
    const v = validateProvenanceOrigin('operative_source', null);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('requires an originId');
  });

  it('blank/whitespace originId counts as absent', () => {
    expect(validateProvenanceOrigin('template', '   ').ok).toBe(false);
  });

  it('self-authored type WITHOUT an originId is valid', () => {
    expect(validateProvenanceOrigin('attorney_authored', null).ok).toBe(true);
  });

  it('self-authored type WITH an originId is rejected (no concrete source)', () => {
    const v = validateProvenanceOrigin('model_generated', 'src-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('must not carry an originId');
  });
});
