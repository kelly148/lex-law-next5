/**
 * INSTR-2B-title — Title-posture drafting routing via the engagement-capacity election.
 *
 * The Title master (master/claude/title) is reachable ONLY through an affirmative
 * engagement_capacity === 'title_settlement_agent' election. Title is NEVER the default, NEVER
 * reached from paKey alone, and the dangerous direction (a client matter getting the title posture)
 * is structurally impossible without the explicit election.
 *
 * Covers (STEP 4): GUARD flag-OFF byte-for-byte unchanged (no title routing, no capacity effect);
 * capacity defaults/backfills to the safe default => lawfirm general, never title; title ONLY on the
 * affirmative election; capacity precedence over paKey; the safe-default guard (title paKey without
 * the election still routes lawfirm); non-Anthropic/reviewer exclusions; regenerate composes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPromptAsset,
  clearPromptAssetCacheForTests,
  MASTER_CLAUDE_TE,
  MASTER_CLAUDE_LAWFIRM,
  MASTER_CLAUDE_TITLE,
} from '../promptAssets.js';
import { assemblePrompt } from '../assemblePrompt.js';
import { PRIMARY_DRAFTER_MODEL } from '../config.js';

const ML_FLAG = 'MASTER_LAWFIRM_ENABLED';
const PC_FLAG = 'PROMPT_COMPOSITION_ENABLED';

let savedML: string | undefined;
let savedPC: string | undefined;

beforeEach(() => {
  savedML = process.env[ML_FLAG];
  savedPC = process.env[PC_FLAG];
  delete process.env[ML_FLAG];
  delete process.env[PC_FLAG];
});

afterEach(() => {
  if (savedML === undefined) delete process.env[ML_FLAG];
  else process.env[ML_FLAG] = savedML;
  if (savedPC === undefined) delete process.env[PC_FLAG];
  else process.env[PC_FLAG] = savedPC;
  clearPromptAssetCacheForTests();
});

const matter = (
  engagementCapacity: string | null,
  paKey: string | null = null,
  practiceArea: string | null = null,
) => ({ paKey, practiceArea, engagementCapacity });

const draftArgs = (
  m: { paKey: string | null; practiceArea: string | null; engagementCapacity: string | null } | null,
  model: string = PRIMARY_DRAFTER_MODEL,
  callRole: 'draft' | 'regenerate' | 'review' = 'draft',
) => ({ matter: m, docType: null, callRole, model } as const);

// ---------------------------------------------------------------------------
// GUARD — flag OFF: capacity has NO effect; title is never composed
// ---------------------------------------------------------------------------

describe('INSTR-2B-title — GUARD: MASTER_LAWFIRM_ENABLED OFF ignores capacity entirely', () => {
  it('flag OFF: a title_settlement_agent matter composes NO master (legacy)', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, 'Real Estate')));
    expect(out.source).toBe('legacy');
    expect(out.layeredMasterText).toBeNull();
  });

  it('flag OFF + PROMPT_COMPOSITION ON: capacity is ignored (1A0 blob is TE-only) — title matter stays legacy', () => {
    process.env[PC_FLAG] = 'true';
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', 'real_estate', null)));
    expect(out.source).toBe('legacy'); // never title, never lawfirm when ML is OFF
  });
});

// ---------------------------------------------------------------------------
// Routing — flag ON
// ---------------------------------------------------------------------------

describe('INSTR-2B-title — routing (MASTER_LAWFIRM_ENABLED ON)', () => {
  beforeEach(() => {
    process.env[ML_FLAG] = 'true';
  });

  it('affirmative title_settlement_agent election -> master/claude/title (layered)', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, null)));
    expect(out.source).toBe(MASTER_CLAUDE_TITLE);
    expect(out.layeredMasterText).toBe(getPromptAsset(MASTER_CLAUDE_TITLE).text);
    expect(out.systemText).toBeNull();
    expect(out.assetSha256).toBe(getPromptAsset(MASTER_CLAUDE_TITLE).sha256);
  });

  it('capacity defaults to law_firm -> lawfirm general, NEVER title', () => {
    const out = assemblePrompt(draftArgs(matter('law_firm', 'real_estate', 'Real Estate')));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('capacity NULL (backfilled/legacy row) -> lawfirm general (safe default), NEVER title', () => {
    const out = assemblePrompt(draftArgs(matter(null, null, null)));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('SAFE DEFAULT: a title_settlement paKey WITHOUT the capacity election routes lawfirm general, not title', () => {
    expect(assemblePrompt(draftArgs(matter('law_firm', 'title_settlement', null))).source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(assemblePrompt(draftArgs(matter(null, 'title_settlement', null))).source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('only the EXACT capacity value triggers title — the paKey string "title_settlement" does not', () => {
    // 'title_settlement' (the paKey vocabulary) is NOT the capacity value 'title_settlement_agent'.
    const out = assemblePrompt(draftArgs(matter('title_settlement', null, null)));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('T&E keys still route to te when capacity is law_firm (2B-core preserved)', () => {
    const out = assemblePrompt(draftArgs(matter('law_firm', 'trusts_estates', null)));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
  });

  it('the title capacity election takes PRECEDENCE over a T&E paKey', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', 'trusts_estates', null)));
    expect(out.source).toBe(MASTER_CLAUDE_TITLE);
  });

  it('regeneration with the title election also composes the Title master', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, null), PRIMARY_DRAFTER_MODEL, 'regenerate'));
    expect(out.source).toBe(MASTER_CLAUDE_TITLE);
  });

  it('non-Anthropic model -> legacy even with the title election', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, null), 'openai:gpt-4.1-mini'));
    expect(out.source).toBe('legacy');
  });

  it('reviewer role -> none even with the title election (calibration-preserving)', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, null), PRIMARY_DRAFTER_MODEL, 'review'));
    expect(out.source).toBe('legacy');
  });
});
