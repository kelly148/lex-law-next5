/**
 * matter_entity + matter_entity_contact query layer (Zod Wall + ownerScope) — FOLD-PM-3.
 *
 * The SOLE read/write path for the within-matter party/entity/contact model. Every read
 * parses through the Zod Wall (MatterEntityRowSchema / MatterEntityContactRowSchema);
 * every owner filter goes through ownerScope() (the FOLD-AUTH chokepoint — never an
 * inline owner-column equality, which the CI ratchet bans for new files).
 * userId / matterId / entityId are immutable bindings (no setter).
 *
 * SCOPE FENCE (FOLD-PM-3): WITHIN-MATTER only. There is NO cross-matter read, match, or
 * join anywhere in this file — every list/get takes a matterId (or an entityId already
 * resolved within a matter) and filters by owner. externalIdentityKey is stored but
 * never queried/matched here; a FUTURE cross-matter resolver is a separate engagement.
 *
 * TEST SEAM (repo convention — see matterDeliverables.ts setMatterDeliverableStore): the
 * low-level persistence is a `MatterEntityStore`; setMatterEntityStore(...) injects an
 * in-memory store so CRUD + owner-isolation behavior is fully exercised WITHOUT a DB.
 * The default store is the real Drizzle-backed implementation.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../connection.js';
import {
  matterEntity,
  matterEntityContact,
  type NewMatterEntity,
  type NewMatterEntityContact,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { normalizeName } from '../../conflicts/engine.js';
import {
  MatterEntityRowSchema,
  MatterEntityContactRowSchema,
  type MatterEntityRow,
  type MatterEntityContactRow,
  type MatterEntityKind,
  type MatterEntityContactType,
} from '../../../shared/schemas/partyModel.js';

// ── parse-on-read (Zod Wall) ──────────────────────────────────────────────
const parseEntity = (r: unknown): MatterEntityRow => MatterEntityRowSchema.parse(r);
const parseContact = (r: unknown): MatterEntityContactRow => MatterEntityContactRowSchema.parse(r);

// ── inputs ────────────────────────────────────────────────────────────────
export interface CreateEntityArgs {
  userId: string;
  matterId: string;
  entityKind?: MatterEntityKind;
  displayName: string;
  legalName?: string | null;
  // partyRef: an OPTIONAL same-matter matter_parties.id. The caller is responsible for
  // ensuring it belongs to the same owner + matter (the procedure verifies ownership).
  partyRef?: string | null;
  externalIdentityKey?: string | null;
  notes?: string | null;
}

/** Mutable entity fields only — userId / matterId / id / createdAt are never patchable. */
export interface EntityPatch {
  entityKind?: MatterEntityKind;
  displayName?: string;
  legalName?: string | null;
  partyRef?: string | null;
  externalIdentityKey?: string | null;
  notes?: string | null;
}

export interface CreateContactArgs {
  userId: string;
  matterId: string;
  entityId: string;
  contactType: MatterEntityContactType;
  label?: string | null;
  value: string;
  isPrimary?: boolean;
}

/** Mutable contact fields only. */
export interface ContactPatch {
  contactType?: MatterEntityContactType;
  label?: string | null;
  value?: string;
  isPrimary?: boolean;
}

// ── store seam ─────────────────────────────────────────────────────────────
export interface MatterEntityStore {
  insertEntity(row: NewMatterEntity): Promise<MatterEntityRow>;
  getEntityById(id: string, userId: string): Promise<MatterEntityRow | null>;
  listEntitiesForMatter(matterId: string, userId: string): Promise<MatterEntityRow[]>;
  patchEntity(id: string, userId: string, patch: EntityPatch): Promise<MatterEntityRow | null>;
  softDeleteEntity(id: string, userId: string): Promise<void>;

  insertContact(row: NewMatterEntityContact): Promise<MatterEntityContactRow>;
  getContactById(id: string, userId: string): Promise<MatterEntityContactRow | null>;
  listContactsForEntity(entityId: string, userId: string): Promise<MatterEntityContactRow[]>;
  patchContact(id: string, userId: string, patch: ContactPatch): Promise<MatterEntityContactRow | null>;
  softDeleteContact(id: string, userId: string): Promise<void>;
}

const drizzleStore: MatterEntityStore = {
  async insertEntity(row: NewMatterEntity): Promise<MatterEntityRow> {
    await db.insert(matterEntity).values(row);
    const created = await this.getEntityById(row.id!, row.userId!);
    if (!created) throw new Error('matter_entity insert did not materialize');
    return created;
  },

  async getEntityById(id: string, userId: string): Promise<MatterEntityRow | null> {
    const rows = await db
      .select()
      .from(matterEntity)
      .where(and(eq(matterEntity.id, id), ownerScope(matterEntity.userId, userId)))
      .limit(1);
    return rows[0] ? parseEntity(rows[0]) : null;
  },

  async listEntitiesForMatter(matterId: string, userId: string): Promise<MatterEntityRow[]> {
    const rows = await db
      .select()
      .from(matterEntity)
      .where(
        and(
          ownerScope(matterEntity.userId, userId),
          eq(matterEntity.matterId, matterId),
          isNull(matterEntity.deletedAt),
        ),
      )
      .orderBy(desc(matterEntity.createdAt));
    return rows.map(parseEntity);
  },

  async patchEntity(id: string, userId: string, patch: EntityPatch): Promise<MatterEntityRow | null> {
    const set: Partial<NewMatterEntity> = {};
    if (patch.entityKind !== undefined) set.entityKind = patch.entityKind;
    if (patch.displayName !== undefined) {
      set.displayName = patch.displayName;
      set.normalizedName = normalizeName(patch.displayName);
    }
    if (patch.legalName !== undefined) set.legalName = patch.legalName;
    if (patch.partyRef !== undefined) set.partyRef = patch.partyRef;
    if (patch.externalIdentityKey !== undefined) set.externalIdentityKey = patch.externalIdentityKey;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length > 0) {
      await db
        .update(matterEntity)
        .set(set)
        .where(and(eq(matterEntity.id, id), ownerScope(matterEntity.userId, userId)));
    }
    return this.getEntityById(id, userId);
  },

  async softDeleteEntity(id: string, userId: string): Promise<void> {
    await db
      .update(matterEntity)
      .set({ deletedAt: new Date() })
      .where(and(eq(matterEntity.id, id), ownerScope(matterEntity.userId, userId)));
  },

  async insertContact(row: NewMatterEntityContact): Promise<MatterEntityContactRow> {
    await db.insert(matterEntityContact).values(row);
    const created = await this.getContactById(row.id!, row.userId!);
    if (!created) throw new Error('matter_entity_contact insert did not materialize');
    return created;
  },

  async getContactById(id: string, userId: string): Promise<MatterEntityContactRow | null> {
    const rows = await db
      .select()
      .from(matterEntityContact)
      .where(and(eq(matterEntityContact.id, id), ownerScope(matterEntityContact.userId, userId)))
      .limit(1);
    return rows[0] ? parseContact(rows[0]) : null;
  },

  async listContactsForEntity(entityId: string, userId: string): Promise<MatterEntityContactRow[]> {
    const rows = await db
      .select()
      .from(matterEntityContact)
      .where(
        and(
          ownerScope(matterEntityContact.userId, userId),
          eq(matterEntityContact.entityId, entityId),
          isNull(matterEntityContact.deletedAt),
        ),
      )
      .orderBy(desc(matterEntityContact.createdAt));
    return rows.map(parseContact);
  },

  async patchContact(id: string, userId: string, patch: ContactPatch): Promise<MatterEntityContactRow | null> {
    const set: Partial<NewMatterEntityContact> = {};
    if (patch.contactType !== undefined) set.contactType = patch.contactType;
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.value !== undefined) set.value = patch.value;
    if (patch.isPrimary !== undefined) set.isPrimary = patch.isPrimary;
    if (Object.keys(set).length > 0) {
      await db
        .update(matterEntityContact)
        .set(set)
        .where(and(eq(matterEntityContact.id, id), ownerScope(matterEntityContact.userId, userId)));
    }
    return this.getContactById(id, userId);
  },

  async softDeleteContact(id: string, userId: string): Promise<void> {
    await db
      .update(matterEntityContact)
      .set({ deletedAt: new Date() })
      .where(and(eq(matterEntityContact.id, id), ownerScope(matterEntityContact.userId, userId)));
  },
};

let _store: MatterEntityStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setMatterEntityStore(store: MatterEntityStore | null): void {
  _store = store;
}
function store(): MatterEntityStore {
  return _store ?? drizzleStore;
}

// ── public query API (owner-scoped; userId always from ctx, never input) ────
export async function createEntity(args: CreateEntityArgs): Promise<MatterEntityRow> {
  const row: NewMatterEntity = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    entityKind: args.entityKind ?? 'unknown',
    displayName: args.displayName,
    normalizedName: normalizeName(args.displayName),
    legalName: args.legalName ?? null,
    partyRef: args.partyRef ?? null,
    externalIdentityKey: args.externalIdentityKey ?? null,
    notes: args.notes ?? null,
  };
  return store().insertEntity(row);
}

export async function getEntityById(id: string, userId: string): Promise<MatterEntityRow | null> {
  return store().getEntityById(id, userId);
}

export async function listEntitiesForMatter(
  matterId: string,
  userId: string,
): Promise<MatterEntityRow[]> {
  return store().listEntitiesForMatter(matterId, userId);
}

export async function updateEntity(
  id: string,
  userId: string,
  patch: EntityPatch,
): Promise<MatterEntityRow | null> {
  return store().patchEntity(id, userId, patch);
}

export async function removeEntity(id: string, userId: string): Promise<void> {
  return store().softDeleteEntity(id, userId);
}

export async function createContact(args: CreateContactArgs): Promise<MatterEntityContactRow> {
  const row: NewMatterEntityContact = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    entityId: args.entityId,
    contactType: args.contactType,
    label: args.label ?? null,
    value: args.value,
    isPrimary: args.isPrimary ?? false,
  };
  return store().insertContact(row);
}

export async function getContactById(
  id: string,
  userId: string,
): Promise<MatterEntityContactRow | null> {
  return store().getContactById(id, userId);
}

export async function listContactsForEntity(
  entityId: string,
  userId: string,
): Promise<MatterEntityContactRow[]> {
  return store().listContactsForEntity(entityId, userId);
}

export async function updateContact(
  id: string,
  userId: string,
  patch: ContactPatch,
): Promise<MatterEntityContactRow | null> {
  return store().patchContact(id, userId, patch);
}

export async function removeContact(id: string, userId: string): Promise<void> {
  return store().softDeleteContact(id, userId);
}
