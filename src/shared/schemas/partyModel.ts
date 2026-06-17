/**
 * Party / entity / contact data model schemas (Zod Wall) — FOLD-PM-3.
 *
 * An ADDITIVE, OWNER+MATTER-scoped entity/contact model that underpins conflicts +
 * persistent reference and unblocks FOLD-DEED-1 (grantor/grantee contact detail).
 *
 * Relationship to the existing model: this does NOT replace or alter matter_parties
 * (the thin conflicts party — FOLD-L0-1 Fork B). A matter_entity is a RICHER record
 * that can optionally reference a matter_parties row WITHIN THE SAME MATTER via
 * `partyRef` (nullable; a same-matter soft link, NOT a DB FK). matter_entity_contact
 * rows hang off a matter_entity (one entity, many contact points).
 *
 * SCOPE FENCE (FOLD-PM-3): WITHIN-MATTER only. `externalIdentityKey` is a stable,
 * owner-scoped, OPAQUE grouping string DEFINED here so a FUTURE cross-matter identity
 * resolver CAN group entities later — but NO cross-matter read/match/join is written
 * now. There is no procedure, query, or join that reads an entity across two matters.
 *
 * This is the single source of truth for the entity-kind + contact-type enums:
 * schema.ts (the Drizzle tables) imports the *_VALUES from here so the column enums
 * and the Zod Wall can never drift (the repo convention used by matterDeliverables /
 * reviewerLaneState). The feature is additive and ships behind PARTY_MODEL_ENABLED
 * (default OFF).
 */

import { z } from 'zod';

// What KIND of legal actor a matter_entity is. 'unknown' is the safe default (mirrors
// matter_parties.partyType which has no opinion until the attorney records one).
export const MATTER_ENTITY_KIND_VALUES = [
  'person',
  'organization',
  'trust',
  'government',
  'unknown',
] as const;
export type MatterEntityKind = (typeof MATTER_ENTITY_KIND_VALUES)[number];

// Contact-point channel. address = a postal/legal-notice address held in `value`
// (free text, single column — structured address fields are a deliberate later add).
export const MATTER_ENTITY_CONTACT_TYPE_VALUES = [
  'email',
  'phone',
  'address',
  'other',
] as const;
export type MatterEntityContactType = (typeof MATTER_ENTITY_CONTACT_TYPE_VALUES)[number];

// --- matter_entity -------------------------------------------------------------
export const MatterEntityRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  entityKind: z.enum(MATTER_ENTITY_KIND_VALUES),
  // displayName is what the attorney sees; normalizedName is the lower/trim/collapse
  // match key (same normalizeName() the conflicts engine uses) for WITHIN-MATTER lookups.
  displayName: z.string().min(1).max(256),
  normalizedName: z.string().min(1).max(256),
  // legalName: the formal name (e.g. "Acme Holdings, LLC") when it differs from the
  // working displayName. Nullable.
  legalName: z.string().max(256).nullable(),
  // partyRef: an OPTIONAL same-matter soft link to a matter_parties.id, so the rich
  // entity and the thin conflicts party can be associated within ONE matter. Nullable
  // (an entity need not correspond to a recorded conflicts party). NOT a DB FK; NOT
  // cross-matter.
  partyRef: z.string().uuid().nullable(),
  // externalIdentityKey: a stable, owner-scoped, opaque grouping string. DEFINED for a
  // FUTURE cross-matter identity resolver to group entities on; NO cross-matter read is
  // written in FOLD-PM-3. Nullable (unset until a later identity feature assigns it).
  externalIdentityKey: z.string().max(128).nullable(),
  notes: z.string().max(8000).nullable(),
  // Soft-delete (mirrors matter_parties.deletedAt). null = active; a soft-deleted
  // entity drops out of list reads.
  deletedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MatterEntityRow = z.infer<typeof MatterEntityRowSchema>;

// --- matter_entity_contact -----------------------------------------------------
export const MatterEntityContactRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  // entityId binds a contact point to its matter_entity (same owner + same matter).
  entityId: z.string().uuid(),
  contactType: z.enum(MATTER_ENTITY_CONTACT_TYPE_VALUES),
  // label: an optional human tag, e.g. "work", "closing notices". Nullable.
  label: z.string().max(128).nullable(),
  // value: the contact value itself (the email / phone / address text).
  value: z.string().min(1).max(1024),
  // isPrimary: marks the preferred contact of its type for the entity (advisory; not
  // enforced unique — an entity may legitimately have several of a type).
  isPrimary: z.boolean(),
  deletedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MatterEntityContactRow = z.infer<typeof MatterEntityContactRowSchema>;
