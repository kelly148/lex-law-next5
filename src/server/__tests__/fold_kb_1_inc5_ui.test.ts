/**
 * FOLD-KB-1 Increment 5 — Practice Knowledge Base UI source-audit.
 *
 * The React surface can't be rendered in this no-DOM vitest setup, so this asserts the
 * load-bearing wiring structurally: the KB-derived disclosure is shown at the surface (the
 * shared constant), surfaced candidates render their currency warning, mutations route through
 * useGuardedMutation, and the panel is wired into MatterDetail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KB_DERIVED_DISCLOSURE } from '../../shared/schemas/practiceKb.js';

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-KB-1 Inc5 — Practice Knowledge Base panel', () => {
  const panel = readSrc('../../client/components/KnowledgeBasePanel.tsx');
  const matterDetail = readSrc('../../client/pages/MatterDetail.tsx');

  it('shows the KB-derived disclosure (shared constant, not buried)', () => {
    expect(panel).toMatch(/KB_DERIVED_DISCLOSURE/);
    expect(panel).toMatch(/from '\.\.\/\.\.\/shared\/schemas\/practiceKb\.js'/);
    expect(KB_DERIVED_DISCLOSURE).toMatch(/re-verify/i);
  });

  it('surfaces candidates with their specific currency warning (Fork F)', () => {
    expect(panel).toMatch(/surfaceCandidates/);
    expect(panel).toMatch(/currencyWarning/);
  });

  it('mutations route through useGuardedMutation (Ch 35.13)', () => {
    expect(panel).toMatch(/useGuardedMutation/);
    expect(panel).toMatch(/practiceKb\.adoptMemo\.mutate/);
    expect(panel).toMatch(/practiceKb\.confirmMatterPaKey\.mutate/);
    expect(panel).toMatch(/practiceKb\.createMemo\.mutate/);
  });

  it('exposes the abstraction-required lifecycle acts (Fork B/C)', () => {
    expect(panel).toMatch(/practiceKb\.abstractMemo\.mutate/);
    expect(panel).toMatch(/practiceKb\.promoteMemo\.mutate/);
    expect(panel).toMatch(/practiceKb\.markReverified\.mutate/);
  });

  it('MatterDetail renders the knowledge-base panel', () => {
    expect(matterDetail).toMatch(/<KnowledgeBasePanel matterId=\{matterId\} \/>/);
  });
});
