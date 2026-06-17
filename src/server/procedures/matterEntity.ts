/**
 * matterEntity router — FOLD-PM-3 (party / entity / contact data model).
 *
 * Owner+matter-scoped CRUD over matter_entity + matter_entity_contact. WITHIN-MATTER
 * ONLY: every op takes a matterId (or an entityId resolved within the matter) and
 * verifies matter ownership via the owner-scoped getMatterById before any write. There
 * is NO cross-matter procedure — no read/match/join of an entity across two matters.
 * Mirrors the matterDeliverable router conventions: protectedProcedure everywhere; an
 * assertEnabled() flag gate (PARTY_MODEL_ENABLED, default OFF) on every op except the
 * ungated isEnabled probe; userId is ALWAYS ctx.userId, NEVER read from input (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isPartyModelEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { getMatterPartyById } from '../db/queries/matterParties.js';
import {
  createEntity,
  getEntityById,
  listEntitiesForMatter,
  updateEntity,
  removeEntity,
  createContact,
  listContactsForEntity,
  updateContact,
  removeContact,
} from '../db/queries/matterEntities.js';
import {
  MATTER_ENTITY_KIND_VALUES,
  MATTER_ENTITY_CONTACT_TYPE_VALUES,
} from '../../shared/schemas/partyModel.js';

const DISPLAY_NAME = z.string().min(1).max(256);
const LEGAL_NAME = z.string().max(256);
const EXTERNAL_KEY = z.string().max(128);
const NOTES = z.string().max(8000);
const LABEL = z.string().max(128);
const VALUE = z.string().min(1).max(1024);

function assertEnabled(): void {
  if (!isPartyModelEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PARTY_MODEL_DISABLED' });
  }
}

async function assertOwnsMatter(matterId: string, userId: string): Promise<void> {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

/** Owner-scoped entity resolution: NOT_FOUND if missing OR not owned. Returns the matterId. */
async function assertOwnsEntity(entityId: string, userId: string): Promise<string> {
  const e = await getEntityById(entityId, userId);
  if (!e) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity not found' });
  return e.matterId;
}

/**
 * If a same-matter partyRef is supplied, verify the referenced matter_parties row is
 * owned by the caller AND lives in the SAME matter. This keeps the link within-matter
 * (it is NOT a cross-matter reference). Owner-scoped via getMatterPartyById.
 */
async function assertValidPartyRef(
  partyRef: string | null | undefined,
  matterId: string,
  userId: string,
): Promise<void> {
  if (partyRef == null) return;
  const party = await getMatterPartyById(partyRef, userId);
  if (!party || party.matterId !== matterId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'partyRef not found in this matter' });
  }
}

export const matterEntityRouter = router({
  // Ungated probe so the client can decide whether to mount the surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isPartyModelEnabled() })),

  // ── Entity reads ─────────────────────────────────────────────────────────
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return listEntitiesForMatter(input.matterId, ctx.userId);
    }),

  // ── Entity mutations ──────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        entityKind: z.enum(MATTER_ENTITY_KIND_VALUES).optional(),
        displayName: DISPLAY_NAME,
        legalName: LEGAL_NAME.nullable().optional(),
        partyRef: z.string().uuid().nullable().optional(),
        externalIdentityKey: EXTERNAL_KEY.nullable().optional(),
        notes: NOTES.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      await assertValidPartyRef(input.partyRef, input.matterId, ctx.userId);
      const args: Parameters<typeof createEntity>[0] = {
        userId: ctx.userId,
        matterId: input.matterId,
        displayName: input.displayName,
      };
      if (input.entityKind !== undefined) args.entityKind = input.entityKind;
      if (input.legalName !== undefined) args.legalName = input.legalName;
      if (input.partyRef !== undefined) args.partyRef = input.partyRef;
      if (input.externalIdentityKey !== undefined) args.externalIdentityKey = input.externalIdentityKey;
      if (input.notes !== undefined) args.notes = input.notes;
      return createEntity(args);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        entityKind: z.enum(MATTER_ENTITY_KIND_VALUES).optional(),
        displayName: DISPLAY_NAME.optional(),
        legalName: LEGAL_NAME.nullable().optional(),
        partyRef: z.string().uuid().nullable().optional(),
        externalIdentityKey: EXTERNAL_KEY.nullable().optional(),
        notes: NOTES.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      // Resolve the entity (owner-scoped) so a partyRef change is validated in-matter.
      const matterId = await assertOwnsEntity(input.id, ctx.userId);
      if (input.partyRef !== undefined) {
        await assertValidPartyRef(input.partyRef, matterId, ctx.userId);
      }
      const patch: Parameters<typeof updateEntity>[2] = {};
      if (input.entityKind !== undefined) patch.entityKind = input.entityKind;
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.legalName !== undefined) patch.legalName = input.legalName;
      if (input.partyRef !== undefined) patch.partyRef = input.partyRef;
      if (input.externalIdentityKey !== undefined) patch.externalIdentityKey = input.externalIdentityKey;
      if (input.notes !== undefined) patch.notes = input.notes;
      const updated = await updateEntity(input.id, ctx.userId, patch);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity not found' });
      return updated;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      // Owner-scoped existence check first (NOT_FOUND if missing/not owned).
      await assertOwnsEntity(input.id, ctx.userId);
      await removeEntity(input.id, ctx.userId);
      return { ok: true };
    }),

  // ── Contact reads ──────────────────────────────────────────────────────────
  listContacts: protectedProcedure
    .input(z.object({ entityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      // Owner-scoped: NOT_FOUND if the entity is missing or not owned.
      await assertOwnsEntity(input.entityId, ctx.userId);
      return listContactsForEntity(input.entityId, ctx.userId);
    }),

  // ── Contact mutations ───────────────────────────────────────────────────────
  addContact: protectedProcedure
    .input(
      z.object({
        entityId: z.string().uuid(),
        contactType: z.enum(MATTER_ENTITY_CONTACT_TYPE_VALUES),
        label: LABEL.nullable().optional(),
        value: VALUE,
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      // Resolve the entity owner-scoped; the contact inherits the entity's matterId so a
      // contact can never be attached across matters/owners.
      const matterId = await assertOwnsEntity(input.entityId, ctx.userId);
      const args: Parameters<typeof createContact>[0] = {
        userId: ctx.userId,
        matterId,
        entityId: input.entityId,
        contactType: input.contactType,
        value: input.value,
      };
      if (input.label !== undefined) args.label = input.label;
      if (input.isPrimary !== undefined) args.isPrimary = input.isPrimary;
      return createContact(args);
    }),

  updateContact: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        contactType: z.enum(MATTER_ENTITY_CONTACT_TYPE_VALUES).optional(),
        label: LABEL.nullable().optional(),
        value: VALUE.optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const patch: Parameters<typeof updateContact>[2] = {};
      if (input.contactType !== undefined) patch.contactType = input.contactType;
      if (input.label !== undefined) patch.label = input.label;
      if (input.value !== undefined) patch.value = input.value;
      if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary;
      const updated = await updateContact(input.id, ctx.userId, patch);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      return updated;
    }),

  removeContact: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await removeContact(input.id, ctx.userId);
      return { ok: true };
    }),
});
