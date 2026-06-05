/**
 * FOLD-SEND-1 Increment 3 — export-boundary gate decision, typed confirmation, content hash (PURE).
 *
 * The block decision (shadow vs enforce vs overridden), the typed-confirmation rule, and the
 * content-hash binding are pure and exercised directly. The export-endpoint wiring + the
 * override mutation + shadow logging run live (no test DB) and are fail-safe by construction.
 */

import { describe, it, expect } from 'vitest';
import {
  isExportBlocked,
  isTypedConfirmationValid,
  requiresTypedConfirmation,
  EXPORT_OVERRIDE_CONFIRM_PHRASE,
} from '../send/exportGate.js';
import { computeContentHash } from '../send/contentHash.js';
import type { SendabilityFinding } from '../send/sendabilityEngine.js';
import type { SendabilityCheckCategory } from '../../shared/schemas/sendability.js';

const block: SendabilityFinding = { category: 'wrong_matter_id', summary: 'x' };

describe('FOLD-SEND-1 Inc3 — isExportBlocked', () => {
  it('shadow mode (enforced=false) NEVER blocks, even with a block present', () => {
    expect(isExportBlocked([block], false, new Set())).toBe(false);
  });

  it('enforce: an unoverridden block blocks; no blocks does not', () => {
    expect(isExportBlocked([block], true, new Set())).toBe(true);
    expect(isExportBlocked([], true, new Set())).toBe(false);
  });

  it('enforce: a block whose category is overridden does NOT block', () => {
    const overridden = new Set<SendabilityCheckCategory>(['wrong_matter_id']);
    expect(isExportBlocked([block], true, overridden)).toBe(false);
  });
});

describe('FOLD-SEND-1 Inc3 — typed confirmation', () => {
  it('wrong_matter_id requires the exact phrase (case-insensitive, trimmed)', () => {
    expect(requiresTypedConfirmation('wrong_matter_id')).toBe(true);
    expect(isTypedConfirmationValid('wrong_matter_id', EXPORT_OVERRIDE_CONFIRM_PHRASE)).toBe(true);
    expect(isTypedConfirmationValid('wrong_matter_id', '  confirm export ')).toBe(true);
    expect(isTypedConfirmationValid('wrong_matter_id', 'yes')).toBe(false);
    expect(isTypedConfirmationValid('wrong_matter_id', null)).toBe(false);
  });

  it('categories that do not require confirmation are always valid', () => {
    expect(requiresTypedConfirmation('stale_baseline')).toBe(false);
    expect(isTypedConfirmationValid('stale_baseline', null)).toBe(true);
  });
});

describe('FOLD-SEND-1 Inc3 — computeContentHash', () => {
  it('is deterministic and newline-normalized (CRLF == LF)', () => {
    const a = computeContentHash('line 1\nline 2');
    expect(computeContentHash('line 1\nline 2')).toBe(a);
    expect(computeContentHash('line 1\r\nline 2')).toBe(a); // CRLF normalized
  });

  it('changes when content changes (so an override supersedes on a content change)', () => {
    expect(computeContentHash('v1 content')).not.toBe(computeContentHash('v2 content'));
  });
});
