/**
 * DOC-CLIENT-TARGET-1 Increment 2 — individual_subject flow (server core).
 *
 * Pure-unit coverage of the two malpractice-grade primitives — subject resolution at create
 * (mandatory pick vs auto-bind) and the deterministic §6 pre-finalize target-consistency backstop —
 * plus source-audits of the create/generate/regenerate/finalize wiring, the config-key reconciliation,
 * the single-accessor discipline, and an APP-VOCABULARY guard (every config key must be a real
 * New-Document dropdown value, so a durable_financial_poa-style silent mismatch can't recur).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { resolveIndividualSubject } from '../documents/subjectBinding.js';
import { evaluateTargetConsistency } from '../documents/targetConsistency.js';
import {
  DOC_TYPE_CONFIGS,
  DOC_TYPE_CONFIG_VERSION,
  getDocTypeConfig,
} from '../../shared/docTypes/docTypeConfig.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// resolveIndividualSubject — the create-time binding rule
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 2: resolveIndividualSubject', () => {
  it('non-individual_subject type -> none (party_set/role_sided/derived handled elsewhere)', () => {
    expect(resolveIndividualSubject({ targetStructure: 'party_set', clientPartyIds: [A, B] }).kind).toBe('none');
    expect(resolveIndividualSubject({ targetStructure: undefined, clientPartyIds: [A] }).kind).toBe('none');
  });

  it('single-client matter -> AUTO-BIND the sole client (show, do not ask)', () => {
    const r = resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: [A] });
    expect(r).toEqual({ kind: 'bind', partyId: A });
  });

  it('multi-client matter, NO pick -> SUBJECT_REQUIRED (mandatory affirmative pick, no default)', () => {
    const r = resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: [A, B] });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.code).toBe('SUBJECT_REQUIRED');
  });

  it('multi-client matter, a valid pick -> bind that party', () => {
    const r = resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: [A, B], providedSubjectPartyId: B });
    expect(r).toEqual({ kind: 'bind', partyId: B });
  });

  it('a pick that is NOT a client party -> SUBJECT_NOT_A_CLIENT_PARTY', () => {
    const r = resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: [A], providedSubjectPartyId: B });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.code).toBe('SUBJECT_NOT_A_CLIENT_PARTY');
  });

  it('zero clients -> none (nothing to bind; later guards catch an unbound individual doc)', () => {
    expect(resolveIndividualSubject({ targetStructure: 'individual_subject', clientPartyIds: [] }).kind).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// evaluateTargetConsistency — the deterministic §6 backstop
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 2: evaluateTargetConsistency (§6 backstop)', () => {
  it('subject named in the draft -> match', () => {
    const r = evaluateTargetConsistency({
      draftText: 'I, Sarah Brianne Brown, appoint my agent...',
      subjectName: 'Sarah Brianne Brown',
      otherClientNames: ['Gregory Edwin Brown'],
    });
    expect(r.result).toBe('match');
    expect(r.subjectPresent).toBe(true);
  });

  it('tolerates middle-name variance (subject has a middle name, draft uses first+last)', () => {
    const r = evaluateTargetConsistency({
      draftText: 'This durable power of attorney is granted by Sarah Brown.',
      subjectName: 'Sarah Brianne Brown',
      otherClientNames: [],
    });
    expect(r.result).toBe('match');
  });

  it('WRONG principal: draft names the other client, not the subject -> mismatch (the cross-wire)', () => {
    const r = evaluateTargetConsistency({
      draftText: 'I, Gregory Edwin Brown, appoint my agent...',
      subjectName: 'Sarah Brianne Brown',
      otherClientNames: ['Gregory Edwin Brown'],
    });
    expect(r.result).toBe('mismatch');
    expect(r.subjectPresent).toBe(false);
    expect(r.otherClientsNamed).toContain('Gregory Edwin Brown');
    expect(r.reason).toMatch(/Gregory/);
  });

  it('subject simply absent -> mismatch', () => {
    const r = evaluateTargetConsistency({ draftText: 'A generic document with no client name.', subjectName: 'Sarah Brown', otherClientNames: [] });
    expect(r.result).toBe('mismatch');
    expect(r.reason).toMatch(/does not appear/);
  });

  it('joint MENTION of the other spouse does NOT block as long as the subject is named (agent cross-wire is fast-follow)', () => {
    const r = evaluateTargetConsistency({
      draftText: 'I, Sarah Brianne Brown, appoint my spouse Gregory Edwin Brown as my agent.',
      subjectName: 'Sarah Brianne Brown',
      otherClientNames: ['Gregory Edwin Brown'],
    });
    expect(r.result).toBe('match');
  });

  it('whitespace-bounded: "Sarah" does not match inside "Sarahson"', () => {
    const r = evaluateTargetConsistency({ draftText: 'Sarahson Browning signed this.', subjectName: 'Sarah Brown', otherClientNames: [] });
    expect(r.result).toBe('mismatch');
  });
});

// ---------------------------------------------------------------------------
// Config-key reconciliation to the app vocabulary
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 2: config keys reconciled to the app', () => {
  it('uses the app key durable_poa; the idealized keys are gone', () => {
    expect(getDocTypeConfig('durable_poa')?.targetStructure).toBe('individual_subject');
    expect(getDocTypeConfig('durable_financial_poa')).toBeUndefined();
    expect(getDocTypeConfig('funding_instruction_letter')).toBeUndefined();
  });

  it('every EP/RE type the operator named maps to the right structure', () => {
    expect(getDocTypeConfig('durable_poa')?.targetStructure).toBe('individual_subject');
    expect(getDocTypeConfig('pour_over_will')?.targetStructure).toBe('individual_subject');
    expect(getDocTypeConfig('advance_medical_directive')?.targetStructure).toBe('individual_subject');
    expect(getDocTypeConfig('revocable_living_trust')?.targetStructure).toBe('party_set');
    expect(getDocTypeConfig('certificate_of_trust')?.targetStructure).toBe('derived');
    expect(getDocTypeConfig('deed')?.targetStructure).toBe('role_sided');
  });

  it('the config version was bumped for the reconciliation', () => {
    expect(DOC_TYPE_CONFIG_VERSION).toBe('2026-06-09.2');
  });

  it('APP-VOCABULARY GUARD: every config key is a real New-Document dropdown value', () => {
    const matterDetail = read('src/client/pages/MatterDetail.tsx');
    const dropdownValues = new Set(
      Array.from(matterDetail.matchAll(/value:\s*'([a-z0-9_]+)'/g)).map((m) => m[1]),
    );
    for (const key of Object.keys(DOC_TYPE_CONFIGS)) {
      expect(dropdownValues.has(key), `config key '${key}' is not a real documentType in the dropdown`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-audits — the flow wiring (no test DB)
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 2: create binds the subject', () => {
  const docs = read('src/server/procedures/documents.ts');

  it('document.create accepts subjectPartyId and resolves+binds the subject', () => {
    expect(docs).toMatch(/subjectPartyId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(docs).toContain('resolveIndividualSubject(');
    expect(docs).toContain('bindDocumentParty(');
  });

  it('resolution runs BEFORE insert (never create an untargetable doc) and bind runs AFTER insert', () => {
    expect(docs.indexOf('resolveIndividualSubject(')).toBeLessThan(docs.indexOf('const doc = await insertDocument('));
    expect(docs.indexOf('const doc = await insertDocument(')).toBeLessThan(docs.indexOf('bindDocumentParty('));
  });

  it('exposes document.listParties for the sticky header / selector state', () => {
    expect(docs).toContain('listParties: protectedProcedure');
    expect(docs).toContain('listDocumentParties(input.documentId, ctx.userId)');
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 2: generation scoping + §6 finalize backstop', () => {
  const d4a = read('src/server/procedures/documents4a.ts');

  it('generateDraft + regenerate draft FOR the bound subject (not the generic clientName)', () => {
    expect(d4a).toContain('resolveDraftingSubjectScope(doc, userId)');
    expect(d4a).toContain('subjectScope.subjectName ?? matter.clientName');
    // generateDraft blocks an unbound individual doc that has clients
    expect(d4a).toContain('SUBJECT_NOT_BOUND');
  });

  it('finalize runs the deterministic §6 target-consistency check and hard-stops on mismatch', () => {
    expect(d4a).toContain('evaluateTargetConsistency(');
    expect(d4a).toContain('TARGET_CONSISTENCY_MISMATCH');
    // the check reads the draft content and compares to the bound subject
    expect(d4a).toMatch(/draftText:\s*currentVersion\.content/);
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 2: single-accessor discipline (ADD-DOC-TYPE-1 seam)', () => {
  it('consumers read the config through the accessor, never the raw DOC_TYPE_CONFIGS record', () => {
    const docs = read('src/server/procedures/documents.ts');
    const scope = read('src/server/documents/draftingSubject.ts');
    expect(docs).toContain('getDocTypeConfig');
    expect(docs).not.toContain('DOC_TYPE_CONFIGS');
    expect(scope).toContain('getDocTypeConfig');
    expect(scope).not.toContain('DOC_TYPE_CONFIGS');
  });
});
