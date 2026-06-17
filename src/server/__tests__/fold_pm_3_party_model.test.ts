/**
 * FOLD-PM-3 — party/entity/contact data model behavioral tests.
 *
 * Covers: CRUD round-trip (entity + contacts), owner-scope isolation (cross-owner =
 * NOT_FOUND, no existence leak, no mutation), the flag gate (default OFF, fail-closed,
 * zero store I/O), the WITHIN-MATTER partyRef validation (a same-matter party is
 * accepted; a foreign/other-matter party is rejected), the migration additive guards,
 * and the schema/enum shape. DB-free: the entity query layer runs against an injected
 * in-memory store; the matters + matterParties query modules are vi.mocked. Authed
 * callers are built off ctx.userId only (Ch 35.2 — userId is NEVER a procedure input).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // owned by U1
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // owned by U2
const PARTY_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // U1 party in MATTER_A
const PARTY_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // U2 party in MATTER_B
const PARTY_A_OTHER_MATTER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; // U1 party, but a DIFFERENT matter

// Owner-scoped matters stub: getMatterById returns a matter ONLY for its owner.
vi.mock('../db/queries/matters.js', () => {
  const matters = [
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: '11111111-1111-1111-1111-111111111111', title: 'Matter A', clientName: 'Client A', practiceArea: 'RE', phase: 'drafting' },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', userId: '22222222-2222-2222-2222-222222222222', title: 'Matter B', clientName: 'Client B', practiceArea: 'RE', phase: 'intake' },
  ];
  return {
    getMatterById: (id: string, userId: string) =>
      Promise.resolve(matters.find((m) => m.id === id && m.userId === userId) ?? null),
  };
});

// Owner-scoped matterParties stub: getMatterPartyById returns a party ONLY for its owner.
// PARTY_A lives in MATTER_A (valid same-matter ref); PARTY_A_OTHER_MATTER is U1's but in a
// DIFFERENT matter (must be rejected as not-in-this-matter); PARTY_B is U2's (cross-owner).
vi.mock('../db/queries/matterParties.js', () => {
  const parties = [
    { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', userId: '11111111-1111-1111-1111-111111111111', matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', userId: '11111111-1111-1111-1111-111111111111', matterId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userId: '22222222-2222-2222-2222-222222222222', matterId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
  ];
  return {
    getMatterPartyById: (id: string, userId: string) =>
      Promise.resolve(parties.find((p) => p.id === id && p.userId === userId) ?? null),
  };
});

import { appRouter } from '../router.js';
import { setMatterEntityStore, type MatterEntityStore } from '../db/queries/matterEntities.js';
import { createInMemoryMatterEntityStore } from './inMemoryMatterEntityStore.js';
import {
  MATTER_ENTITY_KIND_VALUES,
  MATTER_ENTITY_CONTACT_TYPE_VALUES,
  MatterEntityRowSchema,
  MatterEntityContactRowSchema,
} from '../../shared/schemas/partyModel.js';

const FLAG = 'PARTY_MODEL_ENABLED';
const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../db/migrations/0044_fold_pm_3_party_model.sql', import.meta.url)),
  'utf8',
);
// Executable DDL only: strip `/* */` and `-- …` comments so the destructive-DDL guards below
// scan statements, not prose. The header comment intentionally NAMES the `ALTER TABLE … ADD
// INDEX` TiDB trap it avoids, which must not trip the guard.
const MIGRATION_DDL = MIGRATION_SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  setMatterEntityStore(createInMemoryMatterEntityStore());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setMatterEntityStore(null);
});

describe('FOLD-PM-3 — entity + contact CRUD round-trip', () => {
  it('create entity -> list -> update -> add/list/update contact -> remove', async () => {
    const u1 = caller(U1);

    const entity = await u1.matterEntity.create({
      matterId: MATTER_A,
      entityKind: 'organization',
      displayName: 'Acme Holdings LLC',
      legalName: 'Acme Holdings, LLC',
    });
    expect(entity.userId).toBe(U1);
    expect(entity.matterId).toBe(MATTER_A);
    expect(entity.entityKind).toBe('organization');
    expect(entity.normalizedName).toBe('acme holdings llc'); // normalizeName applied
    expect(entity.partyRef).toBeNull();
    expect(entity.externalIdentityKey).toBeNull();

    const list = await u1.matterEntity.listForMatter({ matterId: MATTER_A });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(entity.id);

    const updated = await u1.matterEntity.update({ id: entity.id, displayName: 'Acme Holdings', notes: 'grantor' });
    expect(updated.displayName).toBe('Acme Holdings');
    expect(updated.normalizedName).toBe('acme holdings'); // re-normalized on rename
    expect(updated.notes).toBe('grantor');

    const contact = await u1.matterEntity.addContact({
      entityId: entity.id,
      contactType: 'email',
      value: 'closing@acme.example',
      isPrimary: true,
    });
    expect(contact.userId).toBe(U1);
    expect(contact.matterId).toBe(MATTER_A); // inherited from the entity, never input
    expect(contact.entityId).toBe(entity.id);
    expect(contact.isPrimary).toBe(true);

    const contacts = await u1.matterEntity.listContacts({ entityId: entity.id });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.value).toBe('closing@acme.example');

    const updatedContact = await u1.matterEntity.updateContact({ id: contact.id, value: 'notices@acme.example' });
    expect(updatedContact.value).toBe('notices@acme.example');

    await u1.matterEntity.removeContact({ id: contact.id });
    expect(await u1.matterEntity.listContacts({ entityId: entity.id })).toHaveLength(0);

    await u1.matterEntity.remove({ id: entity.id });
    expect(await u1.matterEntity.listForMatter({ matterId: MATTER_A })).toHaveLength(0);
  });
});

describe('FOLD-PM-3 — within-matter partyRef validation (NO cross-matter)', () => {
  it('accepts a same-matter party, rejects a same-owner OTHER-matter party, rejects a cross-owner party', async () => {
    const u1 = caller(U1);

    // Same matter (PARTY_A in MATTER_A) — accepted.
    const ok = await u1.matterEntity.create({ matterId: MATTER_A, displayName: 'Linked', partyRef: PARTY_A });
    expect(ok.partyRef).toBe(PARTY_A);

    // U1's party but in a DIFFERENT matter — rejected (within-matter only).
    await expect(
      u1.matterEntity.create({ matterId: MATTER_A, displayName: 'X', partyRef: PARTY_A_OTHER_MATTER }),
    ).rejects.toThrow(/not found in this matter/i);

    // A party owned by U2 — rejected (owner-scoped getMatterPartyById returns null).
    await expect(
      u1.matterEntity.create({ matterId: MATTER_A, displayName: 'Y', partyRef: PARTY_B }),
    ).rejects.toThrow(/not found in this matter/i);
  });
});

describe('FOLD-PM-3 — owner-scope isolation (cross-owner = NOT_FOUND, no existence leak)', () => {
  it('an entity created by U1 is invisible/untouchable to U2', async () => {
    const created = await caller(U1).matterEntity.create({ matterId: MATTER_A, displayName: 'private' });
    const u2 = caller(U2);

    // U2 cannot list U1's matter (matter not owned -> NOT_FOUND)
    await expect(u2.matterEntity.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/not found/i);
    // U2 cannot update / remove U1's entity (owner-scoped resolve -> NOT_FOUND)
    await expect(u2.matterEntity.update({ id: created.id, displayName: 'hijack' })).rejects.toThrow(/not found/i);
    await expect(u2.matterEntity.remove({ id: created.id })).rejects.toThrow(/not found/i);
    // U2 cannot list U1's entity contacts (entity not owned -> NOT_FOUND)
    await expect(u2.matterEntity.listContacts({ entityId: created.id })).rejects.toThrow(/not found/i);
    // U2 cannot attach a contact to U1's entity
    await expect(
      u2.matterEntity.addContact({ entityId: created.id, contactType: 'phone', value: '555-0000' }),
    ).rejects.toThrow(/not found/i);

    // U1 still sees it intact (the failed cross-owner writes did not mutate it)
    const u1List = await caller(U1).matterEntity.listForMatter({ matterId: MATTER_A });
    expect(u1List).toHaveLength(1);
    expect(u1List[0]!.displayName).toBe('private');
  });

  it('creating an entity on a matter you do not own is NOT_FOUND', async () => {
    await expect(caller(U1).matterEntity.create({ matterId: MATTER_B, displayName: 'x' })).rejects.toThrow(/not found/i);
  });

  it('an unauthenticated caller is rejected (UNAUTHORIZED)', async () => {
    await expect(caller(undefined).matterEntity.listForMatter({ matterId: MATTER_A })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('FOLD-PM-3 — flag gate (default OFF, fail-closed, zero store I/O)', () => {
  it('with PARTY_MODEL_ENABLED OFF, every op refuses and never touches the store', async () => {
    delete process.env[FLAG];
    const throwingStore = new Proxy({} as MatterEntityStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setMatterEntityStore(throwingStore);
    const u1 = caller(U1);

    await expect(u1.matterEntity.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.create({ matterId: MATTER_A, displayName: 'x' })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.update({ id: MATTER_A, displayName: 'x' })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.remove({ id: MATTER_A })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.listContacts({ entityId: MATTER_A })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.addContact({ entityId: MATTER_A, contactType: 'email', value: 'a@b.c' })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.updateContact({ id: MATTER_A, value: 'z' })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
    await expect(u1.matterEntity.removeContact({ id: MATTER_A })).rejects.toThrow(/PARTY_MODEL_DISABLED/);
  });

  it('isEnabled reports the flag state (ungated)', async () => {
    delete process.env[FLAG];
    expect(await caller(U1).matterEntity.isEnabled()).toEqual({ enabled: false });
    process.env[FLAG] = 'true';
    expect(await caller(U1).matterEntity.isEnabled()).toEqual({ enabled: true });
  });
});

describe('FOLD-PM-3 — schema / enum shape', () => {
  it('the row schemas accept a well-formed row and reject bad enums / empty names', () => {
    const baseEntity = {
      id: U1, userId: U1, matterId: MATTER_A, entityKind: 'person',
      displayName: 'A', normalizedName: 'a', legalName: null, partyRef: null,
      externalIdentityKey: null, notes: null, deletedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(MatterEntityRowSchema.safeParse(baseEntity).success).toBe(true);
    expect(MatterEntityRowSchema.safeParse({ ...baseEntity, entityKind: 'alien' }).success).toBe(false);
    expect(MatterEntityRowSchema.safeParse({ ...baseEntity, displayName: '' }).success).toBe(false);

    const baseContact = {
      id: U1, userId: U1, matterId: MATTER_A, entityId: U2, contactType: 'email',
      label: null, value: 'a@b.c', isPrimary: false, deletedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(MatterEntityContactRowSchema.safeParse(baseContact).success).toBe(true);
    expect(MatterEntityContactRowSchema.safeParse({ ...baseContact, contactType: 'fax' }).success).toBe(false);
    expect(MatterEntityContactRowSchema.safeParse({ ...baseContact, value: '' }).success).toBe(false);

    expect(MATTER_ENTITY_KIND_VALUES).toContain('organization');
    expect(MATTER_ENTITY_CONTACT_TYPE_VALUES).toContain('address');
  });
});

describe('FOLD-PM-3 — migration 0044 additive guards (CI-enforceable)', () => {
  it('creates the two tables, is additive-only, and has NO ALTER ... ADD INDEX', () => {
    expect(/CREATE TABLE IF NOT EXISTS `matter_entity`/.test(MIGRATION_SQL)).toBe(true);
    expect(/CREATE TABLE IF NOT EXISTS `matter_entity_contact`/.test(MIGRATION_SQL)).toBe(true);
    // additive-only
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bRENAME\b/i.test(MIGRATION_DDL)).toBe(false);
    // TiDB trap guard: indexes are INLINE in CREATE TABLE, never `ALTER TABLE ... ADD INDEX`.
    expect(/ALTER\s+TABLE[\s\S]*ADD\s+(UNIQUE\s+)?INDEX/i.test(MIGRATION_DDL)).toBe(false);
  });
});
