/**
 * DOC-CLIENT-TARGET-1 Increment 3 — party_set (joint) flow.
 *
 * Pure-unit coverage of the party-set binding resolver (bind the whole client set to the required role
 * as a creation-time snapshot) and the prompt-scoping instruction builder (individual vs joint), plus
 * source-audits that document.create binds the set and that the §6 finalize check stays individual-only.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { resolvePartySetBinding } from '../documents/subjectBinding.js';
import { buildScopeInstruction, type DraftingSubjectScope } from '../documents/draftingSubject.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('DOC-CLIENT-TARGET-1 Inc 3: resolvePartySetBinding', () => {
  it('party_set -> binds the whole client set to the required role (creation-time snapshot)', () => {
    expect(resolvePartySetBinding({ targetStructure: 'party_set', requiredRoleKey: 'settlor', clientPartyIds: [A, B] }))
      .toEqual({ roleKey: 'settlor', partyIds: [A, B] });
  });

  it('non-party_set type -> null (handled by the individual_subject resolver)', () => {
    expect(resolvePartySetBinding({ targetStructure: 'individual_subject', requiredRoleKey: 'subject', clientPartyIds: [A] })).toBeNull();
  });

  it('no clients yet -> null (nothing to snapshot)', () => {
    expect(resolvePartySetBinding({ targetStructure: 'party_set', requiredRoleKey: 'settlor', clientPartyIds: [] })).toBeNull();
  });

  it('no required role declared -> null', () => {
    expect(resolvePartySetBinding({ targetStructure: 'party_set', requiredRoleKey: undefined, clientPartyIds: [A] })).toBeNull();
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 3: buildScopeInstruction', () => {
  const individual = (otherClientNames: string[]): DraftingSubjectScope => ({
    kind: 'individual_subject',
    scoped: true,
    subjectName: 'Sarah Brown',
    subjectRoleLabel: 'Principal',
    otherClientNames,
    mustBindFirst: false,
  });

  it('individual_subject -> draft for the subject only, excluding the other clients', () => {
    const s = buildScopeInstruction(individual(['Gregory Brown']), 'draft');
    expect(s).toMatch(/FOR Sarah Brown/);
    expect(s).toMatch(/only/);
    expect(s).toMatch(/Gregory Brown/);
  });

  it('party_set -> a JOINT instrument for the bound set', () => {
    const s = buildScopeInstruction(
      { kind: 'party_set', scoped: true, subjectName: 'Sarah Brown and Gregory Brown', subjectRoleLabel: 'Settlor', otherClientNames: [], mustBindFirst: false },
      'draft',
    );
    expect(s).toMatch(/JOINT/);
    expect(s).toMatch(/Sarah Brown and Gregory Brown/);
    expect(s).toMatch(/settlors/);
  });

  it('unscoped -> null', () => {
    expect(
      buildScopeInstruction({ kind: 'none', scoped: false, subjectName: null, subjectRoleLabel: 'Principal', otherClientNames: [], mustBindFirst: false }, 'draft'),
    ).toBeNull();
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 3: party_set create binding + finalize gating', () => {
  it('document.create binds the whole client set for party_set types (snapshot)', () => {
    const docs = read('src/server/procedures/documents.ts');
    expect(docs).toContain('resolvePartySetBinding(');
    expect(docs).toContain('partySetBinding.partyIds');
    expect(docs).toContain('roleKey: partySetBinding.roleKey');
  });

  it('the §6 finalize consistency check is gated to individual_subject only (party_set is structural)', () => {
    const d4a = read('src/server/procedures/documents4a.ts');
    expect(d4a).toContain("finalizeSubjectScope.kind === 'individual_subject'");
  });

  it('the create form shows the joint "Applies to" label for party_set', () => {
    const md = read('src/client/pages/MatterDetail.tsx');
    expect(md).toContain('data-testid="party-set-applies"');
    expect(md).toContain('Applies to:');
  });
});
