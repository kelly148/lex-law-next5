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

// CAPACITY-ELECTION-UX (R3): the te/lawfirm default now composes ONLY on an AFFIRMATIVELY-ELECTED
// law_firm seat (capacity 'law_firm' AND a non-null marker). Title routing
// (engagementCapacity === 'title_settlement_agent') is UNCHANGED and does NOT depend on the marker.
// The helper defaults the marker to ELECTED so law_firm cases stay representational; pass null as the
// 4th arg to exercise the unelected residual (-> legacy).
const ELECTED = new Date('2026-06-13T00:00:00Z');
const matter = (
  engagementCapacity: string | null,
  paKey: string | null = null,
  practiceArea: string | null = null,
  engagementCapacityElectedAt: Date | string | null = ELECTED,
) => ({ paKey, practiceArea, engagementCapacity, engagementCapacityElectedAt });

const draftArgs = (
  m: { paKey: string | null; practiceArea: string | null; engagementCapacity: string | null; engagementCapacityElectedAt?: Date | string | null } | null,
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

  it('CAPACITY-ELECTION-UX: capacity NULL (backfilled/legacy row) -> legacy (unelected; never title, never the lawfirm default)', () => {
    // R3 reversal: a NULL-capacity row is no longer the lawfirm safe default — it is unelected -> legacy.
    const out = assemblePrompt(draftArgs(matter(null, null, null)));
    expect(out.source).toBe('legacy');
    expect(out.source).not.toBe(MASTER_CLAUDE_TITLE);
  });

  it('SAFE DEFAULT: a title_settlement paKey on an ELECTED law_firm seat routes lawfirm general, not title (paKey alone never triggers title)', () => {
    // The safety property preserved: a title_settlement PAKEY does not reach the Title master; on an
    // elected law_firm seat it stays lawfirm. (Unelected variants are covered by the residual tests.)
    expect(assemblePrompt(draftArgs(matter('law_firm', 'title_settlement', null))).source).toBe(MASTER_CLAUDE_LAWFIRM);
    // CAPACITY-ELECTION-UX: the same paKey on a NULL-capacity (unelected) row -> legacy (not lawfirm).
    expect(assemblePrompt(draftArgs(matter(null, 'title_settlement', null))).source).toBe('legacy');
  });

  it('only the EXACT capacity value triggers title — the string "title_settlement" never composes a master', () => {
    // 'title_settlement' (the paKey vocabulary) is NOT the capacity value 'title_settlement_agent', and
    // it is NOT 'law_firm' either -> not an elected law_firm seat -> legacy (and NEVER the Title master).
    const out = assemblePrompt(draftArgs(matter('title_settlement', null, null)));
    expect(out.source).toBe('legacy');
    expect(out.source).not.toBe(MASTER_CLAUDE_TITLE);
  });

  it('T&E keys still route to te when capacity is law_firm (2B-core preserved)', () => {
    const out = assemblePrompt(draftArgs(matter('law_firm', 'trusts_estates', null)));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
  });

  it('the title capacity election takes PRECEDENCE over a T&E paKey', () => {
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', 'trusts_estates', null)));
    expect(out.source).toBe(MASTER_CLAUDE_TITLE);
  });

  it('CAPACITY-ELECTION-UX [residual]: an UNELECTED law_firm matter (NULL marker) -> legacy, never lawfirm', () => {
    const out = assemblePrompt(draftArgs(matter('law_firm', 'real_estate', 'Real Estate', null)));
    expect(out.source).toBe('legacy');
    expect(out.layeredMasterText).toBeNull();
  });

  it('CAPACITY-ELECTION-UX: title routing is UNCHANGED by the marker — a title election with a NULL marker still composes Title', () => {
    // Title routing keys ONLY on engagementCapacity === "title_settlement_agent" (R3 left it untouched);
    // it does not require the election marker. (matter.create/setEngagementCapacity stamp it anyway.)
    const out = assemblePrompt(draftArgs(matter('title_settlement_agent', null, null, null)));
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
