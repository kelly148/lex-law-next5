/**
 * INSTR-2A — register master/claude/lawfirm (v2.2) + master/claude/title; rev te -> v1.2.
 *
 * Golden guards over EVERY manifested master asset (extends the INSTR-1A0 golden pattern):
 *   1. Golden hash — each asset loads, its manifest pin equals the recorded golden, and the
 *      bytes re-hash to it (a byte drift is a HARD boot failure via loadPromptAssets()).
 *   2. Negative markers — no container-path / pipeline / jailbreak text survives in any asset
 *      (the same defect class as the TE v1.0 §8 bug, now guarded across all masters).
 *   3. Positive markers — the load-bearing delivery + consequential-action floor clauses are
 *      present in the bytes, so floor-subordination is a TESTED property, not a convention.
 *   4. GUARD (zero selection change) — the new masters are REGISTERED but NOT SELECTED. The
 *      selection function still composes ONLY the TE path; a title or general matter stays
 *      legacy; and assemblePrompt.ts references neither new logical ID. Selection wiring is
 *      INSTR-2B (blocked) — 2A is registration-only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadPromptAssets,
  getPromptAsset,
  clearPromptAssetCacheForTests,
  sha256Hex,
  MASTER_CLAUDE_TE,
} from '../promptAssets.js';
import { assemblePrompt } from '../assemblePrompt.js';
import { PRIMARY_DRAFTER_MODEL } from '../config.js';

const MASTER_LAWFIRM = 'master/claude/lawfirm';
const MASTER_TITLE = 'master/claude/title';

/** Golden SHA-256 pins — must equal prompts/manifest.json. A drift here is a hard boot failure. */
const GOLDEN: Record<string, string> = {
  [MASTER_CLAUDE_TE]: '0e137d1013a277f8b96cb9fa7cca2a12f9be619256fee55888a5e01420603f63',
  [MASTER_LAWFIRM]: '7e801dde0c59101e364c5963a342305fbc66ece5a5fffc9c8a472b7b32bd3547',
  [MASTER_TITLE]: '54cf3b2d78ef14c9bf3c34fb837f3a3ef6934c8fe242eac96e5f4e054c574ccb',
};

/** Forbidden markers (decisions doc §5.6) — container paths, docx pipeline, jailbreak. */
const NEGATIVE_MARKERS = [
  '/mnt/',
  '/home/claude',
  "require('docx')",
  'unpack',
  'repack',
  'You will be terminated',
];

const FLAG = 'PROMPT_COMPOSITION_ENABLED';

describe('INSTR-2A — every manifested master hash-matches its golden pin', () => {
  afterEach(() => clearPromptAssetCacheForTests());

  it('loads all three masters; each bytes-hash to the manifest pin == golden', () => {
    const assets = loadPromptAssets();
    for (const [id, golden] of Object.entries(GOLDEN)) {
      const asset = assets.get(id);
      expect(asset).toBeDefined();
      expect(asset!.sha256).toBe(golden); // manifest pin == recorded golden
      expect(sha256Hex(Buffer.from(asset!.text, 'utf8'))).toBe(golden); // bytes == golden
      expect(asset!.text.length).toBeGreaterThan(0);
    }
  });
});

describe('INSTR-2A — negative-marker guard (no container-path/pipeline/jailbreak in any master)', () => {
  afterEach(() => clearPromptAssetCacheForTests());

  it('no manifested master contains any forbidden marker', () => {
    loadPromptAssets();
    for (const id of Object.keys(GOLDEN)) {
      const text = getPromptAsset(id).text;
      expect(NEGATIVE_MARKERS.filter((m) => text.includes(m))).toEqual([]);
    }
  });
});

describe('INSTR-2A — positive-marker guard (load-bearing clauses present in the bytes)', () => {
  afterEach(() => clearPromptAssetCacheForTests());

  it('the reved TE v1.2 master carries the consequential-action floor clause', () => {
    loadPromptAssets();
    expect(getPromptAsset(MASTER_CLAUDE_TE).text).toContain(
      'reserve consequential acts for express human decision',
    );
  });

  it('the Law Firm master carries the §8 delivery sentence and the §16 floor clause', () => {
    loadPromptAssets();
    const text = getPromptAsset(MASTER_LAWFIRM).text;
    expect(text).toContain('is handled downstream by the platform'); // §8 deliverable-output
    expect(text).toContain('reserve consequential acts for express human decision'); // §16 floor
  });

  it('the Title master carries the consequential-actions floor clause', () => {
    loadPromptAssets();
    expect(getPromptAsset(MASTER_TITLE).text).toContain(
      'do not authorize taking consequential actions on their own',
    );
  });
});

describe('INSTR-2A — GUARD: new masters are REGISTERED but NOT SELECTED (zero selection change)', () => {
  let savedFlag: string | undefined;

  beforeEach(() => {
    savedFlag = process.env[FLAG];
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (savedFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = savedFlag;
    clearPromptAssetCacheForTests();
  });

  it('a title_settlement matter does NOT compose a master (title selection is INSTR-2B)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: 'title_settlement', practiceArea: null },
      docType: null,
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
  });

  it('a general / non-TE matter does NOT compose a master (general selection is INSTR-2B)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: 'real_estate', practiceArea: 'Real Estate' },
      docType: null,
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
  });

  it('the ONLY composing path remains TE, now resolving the v1.2 asset', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: 'trusts_estates', practiceArea: null },
      docType: 'last_will_testament',
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.assetSha256).toBe(GOLDEN[MASTER_CLAUDE_TE]);
  });

  it('Title routing is still deferred (post-INSTR-2B-core): a title_settlement matter composes lawfirm, never title', () => {
    // INSTR-2B-core wires lawfirm/te selection in assemblePrompt.ts, so the old source-string-scan
    // ("references neither new ID") is retired. What must still hold is that the Title master is
    // NOT selected — title_settlement falls through to the lawfirm safe default until INSTR-2B-TITLE.
    // Pin INTENT (behavior), not spelling (ci-gotchas #8).
    const savedMl = process.env['MASTER_LAWFIRM_ENABLED'];
    process.env['MASTER_LAWFIRM_ENABLED'] = 'true';
    try {
      const out = assemblePrompt({
        matter: { paKey: 'title_settlement', practiceArea: null },
        docType: null,
        callRole: 'draft',
        model: PRIMARY_DRAFTER_MODEL,
      });
      expect(out.source).toBe(MASTER_LAWFIRM); // operator-ratified safe default
      expect(out.source).not.toBe(MASTER_TITLE); // Title routing is INSTR-2B-TITLE, deferred
    } finally {
      if (savedMl === undefined) delete process.env['MASTER_LAWFIRM_ENABLED'];
      else process.env['MASTER_LAWFIRM_ENABLED'] = savedMl;
    }
  });
});
