/**
 * In-memory MatterEntityStore for FOLD-PM-3 tests (NO .test suffix — vitest does not
 * collect this file). Backed by plain arrays; EVERY read filters by userId, exactly
 * mirroring ownerScope(), so cross-owner reads naturally return null/empty and the
 * isolation tests pass without a database. Soft-deleted rows are excluded from list
 * reads (mirroring the isNull(deletedAt) filter).
 */

import type {
  MatterEntityStore,
  EntityPatch,
  ContactPatch,
} from '../db/queries/matterEntities.js';
import type { NewMatterEntity, NewMatterEntityContact } from '../db/schema.js';
import type {
  MatterEntityRow,
  MatterEntityContactRow,
} from '../../shared/schemas/partyModel.js';

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function createInMemoryMatterEntityStore(
  now: () => Date = () => new Date('2026-06-17T12:00:00.000Z'),
): MatterEntityStore {
  const entities: MatterEntityRow[] = [];
  const contacts: MatterEntityContactRow[] = [];

  return {
    insertEntity(row: NewMatterEntity): Promise<MatterEntityRow> {
      const r: MatterEntityRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        entityKind: row.entityKind ?? 'unknown',
        displayName: row.displayName!,
        normalizedName: row.normalizedName!,
        legalName: row.legalName ?? null,
        partyRef: row.partyRef ?? null,
        externalIdentityKey: row.externalIdentityKey ?? null,
        notes: row.notes ?? null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      entities.push(r);
      return Promise.resolve({ ...r });
    },

    getEntityById(id: string, userId: string): Promise<MatterEntityRow | null> {
      const r = entities.find((x) => x.id === id && x.userId === userId);
      return Promise.resolve(r ? { ...r } : null);
    },

    listEntitiesForMatter(matterId: string, userId: string): Promise<MatterEntityRow[]> {
      return Promise.resolve(
        entities
          .filter((x) => x.userId === userId && x.matterId === matterId && !x.deletedAt)
          .map((x) => ({ ...x })),
      );
    },

    patchEntity(id: string, userId: string, patch: EntityPatch): Promise<MatterEntityRow | null> {
      const r = entities.find((x) => x.id === id && x.userId === userId);
      if (!r) return Promise.resolve(null);
      if (patch.entityKind !== undefined) r.entityKind = patch.entityKind;
      if (patch.displayName !== undefined) {
        r.displayName = patch.displayName;
        r.normalizedName = normalize(patch.displayName);
      }
      if (patch.legalName !== undefined) r.legalName = patch.legalName;
      if (patch.partyRef !== undefined) r.partyRef = patch.partyRef;
      if (patch.externalIdentityKey !== undefined) r.externalIdentityKey = patch.externalIdentityKey;
      if (patch.notes !== undefined) r.notes = patch.notes;
      r.updatedAt = now();
      return Promise.resolve({ ...r });
    },

    softDeleteEntity(id: string, userId: string): Promise<void> {
      const r = entities.find((x) => x.id === id && x.userId === userId);
      if (r) r.deletedAt = now();
      return Promise.resolve();
    },

    insertContact(row: NewMatterEntityContact): Promise<MatterEntityContactRow> {
      const r: MatterEntityContactRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        entityId: row.entityId!,
        contactType: row.contactType!,
        label: row.label ?? null,
        value: row.value!,
        isPrimary: row.isPrimary ?? false,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      contacts.push(r);
      return Promise.resolve({ ...r });
    },

    getContactById(id: string, userId: string): Promise<MatterEntityContactRow | null> {
      const r = contacts.find((x) => x.id === id && x.userId === userId);
      return Promise.resolve(r ? { ...r } : null);
    },

    listContactsForEntity(entityId: string, userId: string): Promise<MatterEntityContactRow[]> {
      return Promise.resolve(
        contacts
          .filter((x) => x.userId === userId && x.entityId === entityId && !x.deletedAt)
          .map((x) => ({ ...x })),
      );
    },

    patchContact(id: string, userId: string, patch: ContactPatch): Promise<MatterEntityContactRow | null> {
      const r = contacts.find((x) => x.id === id && x.userId === userId);
      if (!r) return Promise.resolve(null);
      if (patch.contactType !== undefined) r.contactType = patch.contactType;
      if (patch.label !== undefined) r.label = patch.label;
      if (patch.value !== undefined) r.value = patch.value;
      if (patch.isPrimary !== undefined) r.isPrimary = patch.isPrimary;
      r.updatedAt = now();
      return Promise.resolve({ ...r });
    },

    softDeleteContact(id: string, userId: string): Promise<void> {
      const r = contacts.find((x) => x.id === id && x.userId === userId);
      if (r) r.deletedAt = now();
      return Promise.resolve();
    },
  };
}
