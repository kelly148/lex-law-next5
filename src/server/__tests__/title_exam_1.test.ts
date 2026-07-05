/**
 * TITLE-EXAM-1 (T1) — title-examination data model coverage (DB-less; CI runs no database).
 *
 * Covers: the §5 enum vocabularies (source basis / sendability / classification / reconciliation /
 * escalation), the feature-flag default (byte-neutral OFF), the §2 DC-exam visibility pure helper, the
 * transaction write bodies against a MOCK tx (row shape + safe defaults), and the migration's
 * additive-only + operator-applied-OUT-OF-BAND (not on the auto-apply allowlist) structural guards.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isTitleExamEnabled } from '../config/featureFlags.js';
import {
  TITLE_EXAM_NPI_POSTURE_VALUES,
  TITLE_EXAM_LANE_MODE_VALUES,
  TITLE_EXAM_COMPLETENESS_VALUES,
  TITLE_EXAM_SESSION_STATUS_VALUES,
  TITLE_EXAM_LANE_ORIGIN_VALUES,
  TITLE_EXAM_SOURCE_BASIS_VALUES,
  TITLE_EXAM_SENDABILITY_VALUES,
  TITLE_EXAM_CLASSIFICATION_VALUES,
  TITLE_EXAM_RECON_CLASS_VALUES,
  TITLE_EXAM_ESCALATION_STATE_VALUES,
} from '../db/schema.js';
import {
  deriveDcExamVisibility,
  DC_EXAM_REVIEW_PROMPT_THRESHOLD,
  writeTitleExamSessionTx,
  writeTitleExamFindingTx,
  writeTitleExamRunTx,
  type TitleExamFindingInput,
} from '../db/queries/titleExam.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

type CapturedInsert = { table: unknown; row: Record<string, unknown> };

/** A minimal executor that captures every insert(table).values(row); satisfies the tx param via a cast. */
function makeMockTx(): { tx: Parameters<typeof writeTitleExamSessionTx>[0]; inserts: CapturedInsert[] } {
  const inserts: CapturedInsert[] = [];
  const mock = {
    insert(table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve();
        },
      };
    },
  };
  return { tx: mock as unknown as Parameters<typeof writeTitleExamSessionTx>[0], inserts };
}

const USER = '44444444-4444-4444-4444-444444444444';
const MATTER = '11111111-1111-1111-1111-111111111111';

describe('T1 — §5 finding data-model vocabularies are complete', () => {
  it('NC-8 typed source basis carries all nine bases (incl. ocr_extracted + prior_matter_seed + externally_verified)', () => {
    for (const b of [
      'instrument',
      'court_record',
      'tax_record',
      'abstractor_stated',
      'ocr_extracted',
      'prior_matter_seed',
      'attorney_instruction',
      'model_inference',
      'externally_verified',
    ]) {
      expect(TITLE_EXAM_SOURCE_BASIS_VALUES).toContain(b);
    }
  });

  it('NC-4 sendability carries the full six-status matrix', () => {
    for (const s of [
      'internal_only',
      'client_facing_ok',
      'client_facing_with_caveat',
      'underwriter_facing_only',
      'do_not_send_without_attorney_rewrite',
      'requires_source_review',
    ]) {
      expect(TITLE_EXAM_SENDABILITY_VALUES).toContain(s);
    }
  });

  it('finding classification carries the eight §5 classes', () => {
    for (const c of [
      'closing_requirement',
      'recording_requirement',
      'disbursement_condition',
      'policy_exception',
      'informational_note',
      'underwriting_escalation',
      'lender_escalation',
      'counsel_referral',
    ]) {
      expect(TITLE_EXAM_CLASSIFICATION_VALUES).toContain(c);
    }
  });

  it('NC-1/NC-2 reconciliation classes + escalate-only lifecycle', () => {
    expect(TITLE_EXAM_RECON_CLASS_VALUES).toEqual(['concordant', 'unique_catch', 'conflict', 'housekeeping']);
    // The lifecycle keeps auto_resolved (record-resolvable/housekeeping) distinct from the attorney
    // dispositions (adopted/modified/held) — judgment conflicts are never auto-resolved.
    for (const s of ['none', 'auto_resolved', 'escalated', 'adopted', 'modified', 'held']) {
      expect(TITLE_EXAM_ESCALATION_STATE_VALUES).toContain(s);
    }
  });

  it('NC-12 NPI posture + lane/completeness/status/lane-origin vocabularies are present', () => {
    expect(TITLE_EXAM_NPI_POSTURE_VALUES).toEqual([
      'full_upload_approved',
      'partial_redaction',
      'local_only_preprocessing',
      'no_external_call',
    ]);
    expect(TITLE_EXAM_LANE_MODE_VALUES).toEqual(['two_lane', 'single_lane']);
    expect(TITLE_EXAM_COMPLETENESS_VALUES).toEqual(['complete', 'incomplete']);
    expect(TITLE_EXAM_SESSION_STATUS_VALUES).toContain('awaiting_attorney');
    expect(TITLE_EXAM_LANE_ORIGIN_VALUES).toEqual(['examiner_a', 'examiner_b', 'reconciler', 'both']);
  });
});

describe('T1 — feature flag default (byte-neutral OFF)', () => {
  const prev = process.env['TITLE_EXAM_ENABLED'];
  afterEach(() => {
    if (prev === undefined) delete process.env['TITLE_EXAM_ENABLED'];
    else process.env['TITLE_EXAM_ENABLED'] = prev;
  });

  it('defaults OFF; only the exact string "true" enables it', () => {
    delete process.env['TITLE_EXAM_ENABLED'];
    expect(isTitleExamEnabled()).toBe(false);
    process.env['TITLE_EXAM_ENABLED'] = 'TRUE';
    expect(isTitleExamEnabled()).toBe(false);
    process.env['TITLE_EXAM_ENABLED'] = '1';
    expect(isTitleExamEnabled()).toBe(false);
    process.env['TITLE_EXAM_ENABLED'] = 'true';
    expect(isTitleExamEnabled()).toBe(true);
  });
});

describe('T1 — §2 DC-exam visibility (a visibility nudge, never a legal determination)', () => {
  it('below the review-prompt threshold does not prompt; at/above it does', () => {
    const below = deriveDcExamVisibility(DC_EXAM_REVIEW_PROMPT_THRESHOLD - 1);
    expect(below.reviewPrompted).toBe(false);
    expect(below.count).toBe(DC_EXAM_REVIEW_PROMPT_THRESHOLD - 1);

    const at = deriveDcExamVisibility(DC_EXAM_REVIEW_PROMPT_THRESHOLD);
    expect(at.reviewPrompted).toBe(true);
    expect(at.reviewPromptThreshold).toBe(DC_EXAM_REVIEW_PROMPT_THRESHOLD);
  });

  it('clamps a negative / non-finite count to zero and never prompts on zero', () => {
    expect(deriveDcExamVisibility(-5).count).toBe(0);
    expect(deriveDcExamVisibility(Number.NaN).reviewPrompted).toBe(false);
    expect(deriveDcExamVisibility(0).reviewPrompted).toBe(false);
  });
});

describe('T1 — write bodies apply safe defaults (mock tx)', () => {
  it('a minimal session row defaults to a two-lane, complete, intake exam with no lane failure', async () => {
    const { tx, inserts } = makeMockTx();
    await writeTitleExamSessionTx(tx, { userId: USER, matterId: MATTER, sessionId: 'sess-1' });
    expect(inserts).toHaveLength(1);
    const row = inserts[0]!.row;
    expect(row['id']).toBe('sess-1');
    expect(row['laneMode']).toBe('two_lane');
    expect(row['completeness']).toBe('complete');
    expect(row['status']).toBe('intake');
    expect(row['converged']).toBe(false);
    expect(row['droppedPageCount']).toBe(0);
    expect(row['roundsRun']).toBe(0);
    expect(row['laneFailureBanner']).toBeNull();
    expect(row['candidateMemoText']).toBeNull();
  });

  it('a finding row carries the typed source basis + defaults its honesty/contamination flags to false', async () => {
    const { tx, inserts } = makeMockTx();
    const finding: TitleExamFindingInput = {
      laneOrigin: 'examiner_a',
      title: 'Unreleased 2004 deed of trust of record',
      sourceBasis: 'instrument',
      sendability: 'internal_only',
      classification: 'closing_requirement',
    };
    await writeTitleExamFindingTx(tx, { ...finding, id: 'f-1', sessionId: 'sess-1', userId: USER, matterId: MATTER });
    const row = inserts[0]!.row;
    expect(row['sourceBasis']).toBe('instrument');
    expect(row['sendability']).toBe('internal_only');
    expect(row['classification']).toBe('closing_requirement');
    expect(row['downgraded']).toBe(false);
    expect(row['ocrDerived']).toBe(false);
    expect(row['isJudgmentConflict']).toBe(false);
    expect(row['escalationState']).toBe('none');
    expect(row['seedContaminationFlag']).toBe(false);
    expect(row['importResolved']).toBe(false);
    expect(row['reconClassification']).toBeNull();
    expect(row['adoptLedgerId']).toBeNull();
    expect(row['decisionEventId']).toBeNull();
  });

  it('writeTitleExamRunTx writes one session then denormalizes owner/matter/session onto every finding', async () => {
    const { tx, inserts } = makeMockTx();
    const findings: TitleExamFindingInput[] = [
      { laneOrigin: 'examiner_a', title: 'A', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'closing_requirement' },
      { laneOrigin: 'examiner_b', title: 'B', sourceBasis: 'ocr_extracted', sendability: 'requires_source_review', classification: 'policy_exception', ocrDerived: true, downgraded: true },
    ];
    await writeTitleExamRunTx(tx, { session: { userId: USER, matterId: MATTER }, findings, sessionId: 'sess-9' });
    expect(inserts).toHaveLength(3); // 1 session + 2 findings
    const findingRows = inserts.slice(1).map((i) => i.row);
    for (const row of findingRows) {
      expect(row['sessionId']).toBe('sess-9');
      expect(row['userId']).toBe(USER);
      expect(row['matterId']).toBe(MATTER);
    }
    // the OCR-extracted finding stays honestly downgraded
    expect(findingRows[1]!['ocrDerived']).toBe(true);
    expect(findingRows[1]!['downgraded']).toBe(true);
  });
});

describe('T1 — migration 0054 is additive-only and operator-applied OUT-OF-BAND', () => {
  const MIGRATION = read('src/server/db/migrations/0054_title_exam_1_data_model.sql');
  const ALLOWLIST = read('scripts/apply-prod-migrations.mjs');

  it('creates all three tables idempotently (CREATE TABLE IF NOT EXISTS)', () => {
    for (const t of ['title_exam_matter_attribute', 'title_exam_session', 'title_exam_finding']) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS \`${t}\``);
    }
  });

  it('contains no destructive DDL (no DROP/TRUNCATE/DELETE/RENAME)', () => {
    const stripped = MIGRATION.replace(/--[^\n]*/g, '');
    expect(/\bDROP\s+(TABLE|COLUMN|INDEX|DATABASE)\b/i.test(stripped)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(stripped)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(stripped)).toBe(false);
    expect(/\bRENAME\s+(TABLE|COLUMN|INDEX|TO)\b/i.test(stripped)).toBe(false);
  });

  it('is NOT on the apply-prod-migrations auto-apply allowlist (operator-applied out-of-band)', () => {
    expect(ALLOWLIST).not.toContain('0054_title_exam_1_data_model.sql');
  });
});

describe('T1 — every matter-scoped title-exam table is registered in the purge cascade', () => {
  const purge = read('src/server/db/queries/matterPurge.ts');
  it('purgeMatter references all three title_exam tables (children-first)', () => {
    expect(purge).toContain('titleExamFinding');
    expect(purge).toContain('titleExamSession');
    expect(purge).toContain('titleExamMatterAttribute');
  });
});
