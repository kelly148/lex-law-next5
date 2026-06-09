/**
 * DOC-CLIENT-TARGET-1 Increment 1 — data model + versioned config + validation (the spine).
 *
 * Pure-unit coverage of the doc-type targeting config + role-key validation (the malpractice-grade
 * defense: a document binds to the RIGHT party in a role the type actually declares), plus source-
 * audits of the additive schema/migration/query/hook wiring (the repo's no-test-DB pattern; CI is
 * authoritative). Governing record: _brand/DOC-CLIENT-TARGET-1_consolidated_disposition_2026-06-09.md
 * §3 (LOCKED).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  TARGET_STRUCTURE_VALUES,
  DOC_TYPE_CONFIG_VERSION,
  DOC_TYPE_CONFIGS,
  getDocTypeConfig,
  getTargetStructure,
  getDeclaredRoleKeys,
  isRoleKeyDeclared,
  targetStructureBindsParties,
} from '../../shared/docTypes/docTypeConfig.js';
import { DocumentPartyRowSchema } from '../../shared/schemas/documentParty.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// ---------------------------------------------------------------------------
// Taxonomy + version
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 1: taxonomy + config version', () => {
  it('declares ALL FIVE targeting buckets (reserved now even if only 2 get v1 flows)', () => {
    expect([...TARGET_STRUCTURE_VALUES].sort()).toEqual(
      ['derived', 'individual_subject', 'non_party_specific', 'party_set', 'role_sided'].sort(),
    );
  });

  it('carries a non-empty config version (snapshotted at finalize for provenance)', () => {
    expect(typeof DOC_TYPE_CONFIG_VERSION).toBe('string');
    expect(DOC_TYPE_CONFIG_VERSION.length).toBeGreaterThan(0);
  });

  it('seeds the disposition §3.2 document types with the locked structures', () => {
    expect(getTargetStructure('durable_poa')).toBe('individual_subject');
    expect(getTargetStructure('pour_over_will')).toBe('individual_subject');
    expect(getTargetStructure('advance_medical_directive')).toBe('individual_subject');
    expect(getTargetStructure('revocable_living_trust')).toBe('party_set');
    expect(getTargetStructure('certificate_of_trust')).toBe('derived');
    expect(getTargetStructure('deed')).toBe('role_sided');
  });
});

// ---------------------------------------------------------------------------
// Per-type role structure
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 1: per-type role structure', () => {
  it('individual_subject EP types require exactly one client subject + are pairable', () => {
    for (const t of ['durable_poa', 'pour_over_will', 'advance_medical_directive']) {
      const c = getDocTypeConfig(t)!;
      expect(c.subjectMustBeClient).toBe(true);
      expect(c.pairable).toBe(true);
      const subject = c.requiredRoles.find((r) => r.roleKey === 'subject');
      expect(subject).toBeDefined();
      expect(subject!.min).toBe(1);
      expect(subject!.max).toBe(1);
      expect(subject!.renderLabel).toBeTruthy();
    }
  });

  it('the durable POA reserves agent + successor_agent designation roles (no binding UI in v1)', () => {
    const poa = getDocTypeConfig('durable_poa')!;
    const designations = poa.designationRoles.map((r) => r.roleKey);
    expect(designations).toContain('agent');
    expect(designations).toContain('successor_agent');
    // reserved, not required — the binding UI is a fast-follow
    expect(poa.requiredRoles.map((r) => r.roleKey)).not.toContain('agent');
  });

  it('the revocable living trust is a party_set of >=1 settlor (no subjectMustBeClient)', () => {
    const trust = getDocTypeConfig('revocable_living_trust')!;
    expect(trust.subjectMustBeClient).toBe(false);
    const settlor = trust.requiredRoles.find((r) => r.roleKey === 'settlor');
    expect(settlor).toBeDefined();
    expect(settlor!.min).toBe(1);
    expect(settlor!.max).toBeNull();
  });

  it('the derived type points at its source document type (cert <- trust)', () => {
    expect(getDocTypeConfig('certificate_of_trust')!.sourceDocumentType).toBe('revocable_living_trust');
  });

  it('the deed is role_sided with grantor + grantee role groups', () => {
    const deed = getDocTypeConfig('deed')!;
    const roles = deed.requiredRoles.map((r) => r.roleKey);
    expect(roles).toContain('grantor');
    expect(roles).toContain('grantee');
  });
});

// ---------------------------------------------------------------------------
// Role-key validation (the write-time gate; no DB enum)
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 1: role-key validation', () => {
  it('accepts a declared required role and a reserved designation role', () => {
    expect(isRoleKeyDeclared('durable_poa', 'subject')).toBe(true);
    expect(isRoleKeyDeclared('durable_poa', 'agent')).toBe(true);
  });

  it('REJECTS a role the type does not declare (typo + nonsense protection)', () => {
    expect(isRoleKeyDeclared('durable_poa', 'grantor')).toBe(false);
    expect(isRoleKeyDeclared('durable_poa', 'bogus_role')).toBe(false);
  });

  it('REJECTS every role on an unregistered/custom document type (declares nothing)', () => {
    expect(getDocTypeConfig('some_custom_type')).toBeUndefined();
    expect(isRoleKeyDeclared('some_custom_type', 'subject')).toBe(false);
  });

  it('getDeclaredRoleKeys unions required + designation roles', () => {
    const poa = getDocTypeConfig('durable_poa')!;
    expect(getDeclaredRoleKeys(poa)).toEqual(expect.arrayContaining(['subject', 'agent', 'successor_agent']));
  });

  it('non_party_specific binds nothing; the other buckets bind parties', () => {
    expect(targetStructureBindsParties('non_party_specific')).toBe(false);
    expect(targetStructureBindsParties('individual_subject')).toBe(true);
    expect(targetStructureBindsParties('party_set')).toBe(true);
  });

  it('every seeded config keeps documentType consistent with its registry key', () => {
    for (const [key, cfg] of Object.entries(DOC_TYPE_CONFIGS)) {
      expect(cfg.documentType).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// document_party row contract
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 1: DocumentPartyRowSchema', () => {
  const UUID = '11111111-1111-1111-1111-111111111111';
  const validRow = {
    id: UUID,
    userId: UUID,
    matterId: UUID,
    documentId: UUID,
    partyId: UUID,
    roleKey: 'subject',
    sortOrder: 0,
    createdBy: UUID,
    createdAt: new Date(),
  };

  it('parses a valid binding row', () => {
    expect(() => DocumentPartyRowSchema.parse(validRow)).not.toThrow();
  });

  it('requires roleKey (a binding without a role is rejected)', () => {
    const noRole: Record<string, unknown> = { ...validRow };
    delete noRole.roleKey;
    expect(() => DocumentPartyRowSchema.parse(noRole)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Source-audits — additive schema / migration / query / hook wiring (no test DB)
// ---------------------------------------------------------------------------
describe('DOC-CLIENT-TARGET-1 Inc 1: migration 0023 is additive', () => {
  const mig = read('src/server/db/migrations/0023_doc_client_target_1_document_party.sql');

  it('creates document_party + adds sourceDocumentId + deletedAt, all IF NOT EXISTS', () => {
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS\s+`document_party`/);
    expect(mig).toMatch(/UNIQUE KEY\s+`uq_document_party_doc_party_role`\s+\(`documentId`, `partyId`, `roleKey`\)/);
    expect(mig).toMatch(/ALTER TABLE\s+`documents`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`sourceDocumentId`\s+CHAR\(36\)/i);
    expect(mig).toMatch(/ALTER TABLE\s+`matter_parties`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`deletedAt`\s+TIMESTAMP/i);
  });

  it('contains NO destructive DDL (passes the pre-deploy additive guard)', () => {
    const stripped = mig.replace(/--[^\n]*/g, '');
    expect(stripped).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i);
    expect(stripped).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(stripped).not.toMatch(/\bRENAME\s+(TABLE|COLUMN)\b/i);
  });

  it('is allowlisted in the pre-deploy runner + registers the new table for the presence check', () => {
    const runner = read('scripts/apply-prod-migrations.mjs');
    expect(runner).toContain("'0023_doc_client_target_1_document_party.sql'");
    expect(runner).toMatch(/EXPECTED_TABLES_EXTRA[\s\S]*'document_party'/);
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 1: schema declarations', () => {
  const schema = read('src/server/db/schema.ts');

  it('declares the document_party table with the logical-key unique index', () => {
    expect(schema).toMatch(/mysqlTable\(\s*'document_party'/);
    expect(schema).toContain("uniqueIndex('uq_document_party_doc_party_role')");
    expect(schema).toContain("roleKey: varchar('roleKey', { length: 64 }).notNull()");
  });

  it('reserves documents.sourceDocumentId and matter_parties.deletedAt (additive, nullable)', () => {
    expect(schema).toContain("sourceDocumentId: char('sourceDocumentId', { length: 36 })");
    expect(schema).toContain("deletedAt: timestamp('deletedAt')");
  });

  it('MatterPartyRowSchema carries deletedAt (additive)', () => {
    const layer0 = read('src/shared/schemas/layer0.ts');
    expect(layer0).toContain('deletedAt: z.date().nullable().optional()');
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 1: validation + soft-delete + shared hook wiring', () => {
  it('bindDocumentParty validates roleKey against the type config BEFORE insert', () => {
    const q = read('src/server/db/queries/documentParty.ts');
    const fn = q.slice(q.indexOf('export async function bindDocumentParty'), q.indexOf('export async function listDocumentParties'));
    // the type is read from the document (not the caller), then the role is validated, then inserted
    expect(fn).toContain('isRoleKeyDeclared(doc.documentType, data.roleKey)');
    expect(fn).toContain('ROLE_KEY_NOT_DECLARED');
    expect(fn.indexOf('isRoleKeyDeclared')).toBeLessThan(fn.indexOf('db.insert(documentParty)'));
  });

  it('the block-delete guard refuses removing a party bound to a finalized document', () => {
    const q = read('src/server/db/queries/documentParty.ts');
    expect(q).toContain('export async function partyHasFinalizedBinding');
    const parties = read('src/server/db/queries/matterParties.ts');
    const fn = parties.slice(parties.indexOf('export async function softDeleteMatterParty'));
    expect(fn).toContain('partyHasFinalizedBinding(id, userId)');
    expect(fn).toContain('PARTY_BOUND_TO_FINALIZED_DOCUMENT');
    expect(fn).toContain('deletedAt: new Date()');
  });

  it('list reads exclude soft-deleted parties (drop out of lists + conflicts screening)', () => {
    const parties = read('src/server/db/queries/matterParties.ts');
    expect(parties).toMatch(/listPartiesForMatter[\s\S]*isNull\(matterParties\.deletedAt\)/);
    expect(parties).toMatch(/listOtherPartiesForOwner[\s\S]*isNull\(matterParties\.deletedAt\)/);
  });

  it('the SHARED hook re-runs conflicts in addParty AFTER the party is inserted', () => {
    const intake = read('src/server/procedures/matterIntake.ts');
    const fn = intake.slice(intake.indexOf('addParty: protectedProcedure'), intake.indexOf('confirmParty: protectedProcedure'));
    expect(fn).toContain('const party = await insertMatterParty(');
    expect(fn).toContain('runConflictCheck(input.matterId, ctx.userId)');
    expect(fn.indexOf('insertMatterParty(')).toBeLessThan(fn.indexOf('runConflictCheck('));
    // best-effort: the rescreen is wrapped so a screening failure does not roll back the add
    expect(fn).toMatch(/try\s*{[\s\S]*runConflictCheck[\s\S]*}\s*catch/);
  });
});
