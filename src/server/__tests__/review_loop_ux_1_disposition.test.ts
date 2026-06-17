/**
 * REVIEW-LOOP-UX-1 / R1 — reject/defer disposition wiring.
 *
 * Pure-unit (the latest-disposition projection helper) + source-audit (the tRPC procedure reuses the
 * EXISTING disposition audit event, owner-scopes like lockDecision, and the read file reuses the
 * EXISTING FOLD-L1-1 projection — no new table/column/migration). Deterministic in CI (no DB).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  latestDispositionBySuggestion,
  REVIEWER_SUGGESTION_TARGET_TYPE,
  type ReviewSuggestionDisposition,
} from '../db/queries/reviewDisposition.js';

function disp(over: Partial<ReviewSuggestionDisposition>): ReviewSuggestionDisposition {
  return {
    auditEventId: 'e',
    suggestionId: 's1',
    action: 'reject',
    rationale: null,
    documentId: 'd1',
    reviewSessionId: 'r1',
    createdAt: new Date(),
    ...over,
  };
}

describe('REVIEW-LOOP-UX-1 latestDispositionBySuggestion (newest-first wins)', () => {
  it('keeps the FIRST (newest) disposition per suggestion', () => {
    // The projection returns newest-first; the helper must take the first occurrence per suggestion.
    const rows = [
      disp({ auditEventId: 'e2', suggestionId: 's1', action: 'defer' }), // newer
      disp({ auditEventId: 'e1', suggestionId: 's1', action: 'reject' }), // older
      disp({ auditEventId: 'e3', suggestionId: 's2', action: 'reject' }),
    ];
    const map = latestDispositionBySuggestion(rows);
    expect(map.get('s1')?.action).toBe('defer');
    expect(map.get('s1')?.auditEventId).toBe('e2');
    expect(map.get('s2')?.action).toBe('reject');
    expect(map.size).toBe(2);
  });

  it('is empty for no dispositions', () => {
    expect(latestDispositionBySuggestion([]).size).toBe(0);
  });

  it('pins the reviewer-suggestion target type literal', () => {
    expect(REVIEWER_SUGGESTION_TARGET_TYPE).toBe('reviewer_suggestion');
  });
});

describe('REVIEW-LOOP-UX-1 read file reuses the existing disposition projection (source audit)', () => {
  const src = readFileSync(resolve('src/server/db/queries/reviewDisposition.ts'), 'utf8');

  it('reuses listDispositionHistoryForMatter (the EXISTING FOLD-L1-1 projection)', () => {
    expect(src).toContain("from './auditEvents.js'");
    expect(src).toContain('listDispositionHistoryForMatter(');
  });

  it('adds NO inline owner filter (owner-scoping is inherited from the projection)', () => {
    // ownerScope ratchet discipline: this file must never write its own eq(.userId, ...) filter.
    expect(src).not.toMatch(/eq\(\s*\w+\.userId/);
  });

  it('narrows to reviewer_suggestion reject/defer rows only', () => {
    expect(src).toContain('REVIEWER_SUGGESTION_TARGET_TYPE');
    expect(src).toContain("action === 'reject' || action === 'defer'");
  });
});

describe('REVIEW-LOOP-UX-1 dispositionSuggestion procedure (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('exposes dispositionSuggestion + listSuggestionDispositions procedures', () => {
    expect(src).toContain('dispositionSuggestion: protectedProcedure');
    expect(src).toContain('listSuggestionDispositions: protectedProcedure');
  });

  it('records reject/defer via the EXISTING disposition audit event (no new persistence)', () => {
    const idx = src.indexOf('dispositionSuggestion: protectedProcedure');
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain('recordAuditEvent({');
    expect(block).toContain("eventType: 'disposition'");
    expect(block).toContain("actor: 'attorney'");
    expect(block).toContain('targetType: REVIEWER_SUGGESTION_TARGET_TYPE');
    expect(block).toContain('action: input.action');
  });

  it('owner-scopes exactly like lockDecision (session by userId, then document by userId)', () => {
    const idx = src.indexOf('dispositionSuggestion: protectedProcedure');
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain('getReviewSessionById(input.sessionId, userId)');
    expect(block).toContain('getDocumentById(session.documentId, userId)');
  });

  it('does NOT add a new adopt-ledger insert path (adopt stays the existing selection→regenerate path)', () => {
    const idx = src.indexOf('dispositionSuggestion: protectedProcedure');
    const block = src.slice(idx, idx + 2000);
    expect(block).not.toContain('insertAdoptLedgerEntry(');
  });
});
