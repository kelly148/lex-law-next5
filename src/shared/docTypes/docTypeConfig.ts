/**
 * DOC-CLIENT-TARGET-1 — document-type targeting config (versioned, externalized).
 *
 * The single source of truth for how each document type binds to a matter's parties. A document's
 * relationship to a matter's parties is a ROLE BINDING, not a scalar (the disposition rejects a
 * nullable principalPartyId where null=joint). This config declares, per document type, the
 * required party-role STRUCTURE; document instances bind matter parties into those roles through the
 * `document_party` join table (validated against the roles declared here). Everything downstream —
 * the drafting flow, per-instance enumeration, naming, validation, the finalize-time provenance
 * snapshot — reads from this one place.
 *
 * Pattern mirrors src/server/llm/modelCapabilities.ts (an in-code Readonly registry, "single source
 * of truth") with one addition: DOC_TYPE_CONFIG_VERSION. The config is "versioned + immutably
 * retained" via git history + this version key; finalize snapshots DOC_TYPE_CONFIG_VERSION so the
 * exact role labels used at finalize are reconstructable without per-row denormalization (disposition
 * §6 / §10b). SHARED (src/shared) so both the server validation layer and the client drafting flow
 * read the same contract.
 *
 * Governing record: _brand/DOC-CLIENT-TARGET-1_consolidated_disposition_2026-06-09.md §3 (LOCKED).
 * Legal classification (which type is individual vs joint, the role labels) is an ATTORNEY call,
 * encoded here from the disposition — the builder never asserts a legal classification as fact.
 */

/**
 * The five party-targeting structures. ALL FIVE are present now even though only individual_subject +
 * party_set get drafting flows in v1 (disposition §9): role_sided / derived / non_party_specific are
 * SCHEMA-RESERVED — the bucket exists so the validation + sendability gate have a clean path and the
 * first real deed / cert-of-trust does not force a second migration.
 *   - individual_subject  : binds exactly one `subject` party (POA / will / directive).
 *   - party_set           : binds one role set, >=1, captured at creation (a joint trust's settlors).
 *   - role_sided          : binds >=1 of each of several role groups (deed grantor + grantee).
 *   - derived             : inherits its party binding from a source document (cert/funding <- trust).
 *   - non_party_specific  : binds nothing (cover letters, memos) — the clean "binds nothing" path.
 */
export const TARGET_STRUCTURE_VALUES = [
  'individual_subject',
  'party_set',
  'role_sided',
  'derived',
  'non_party_specific',
] as const;
export type TargetStructure = (typeof TARGET_STRUCTURE_VALUES)[number];

/**
 * A declared party role on a document type. `roleKey` is the stable identifier a `document_party`
 * row's roleKey is validated against. min/max are the cardinality (max null = unbounded). renderLabel
 * is the human label ("Principal", "Testator") derived from the type — NEVER snapshotted per binding
 * row (the config VERSION carries that provenance at finalize).
 */
export interface RoleSpec {
  roleKey: string;
  min: number;
  max: number | null;
  /** Display label; optional (role_sided deed roles render via their own UI fast-follow). */
  renderLabel?: string;
}

export interface DocTypeConfig {
  documentType: string;
  targetStructure: TargetStructure;
  /** When true, the bound `subject` must be a matter CLIENT (the hard Brown rule on EP individual
   *  instruments). False for types that are legitimately ABOUT a non-client (seller affidavit, etc.). */
  subjectMustBeClient: boolean;
  /** Whether this type is created one-per-client in a multi-client matter (drives the pair affordance;
   *  the actual pair trigger is enumeration-gated, §4.3). */
  pairable: boolean;
  /** Roles a document instance MUST bind (validated at write; cardinality enforced at finalize). */
  requiredRoles: RoleSpec[];
  /** RESERVED v1: present in config so designations are structural rows later; NO binding UI yet
   *  (fast-follow). A roleKey here is "declared" (accepted at write) but unused by v1 flows. */
  designationRoles: RoleSpec[];
  /** For `derived` types: the document type this one inherits its party binding from. */
  sourceDocumentType?: string;
}

/**
 * Config version. Bump on ANY change to DOC_TYPE_CONFIGS below (a new type, a changed role/label, a
 * changed structure). This string is what finalize snapshots for provenance — git history is the
 * immutable retention; the snapshot makes the exact config-at-finalize reconstructable. Date-stamped
 * + sequence so a second change on the same day is distinguishable.
 */
export const DOC_TYPE_CONFIG_VERSION = '2026-06-09.2';

/**
 * Per-document-type targeting config, keyed by documentType. KEYS ARE THE APP'S REAL documentType
 * VALUES (the New-Document dropdown in MatterDetail.tsx), not idealized names — a key that does not
 * match a real documentType silently never targets. v1 ships flows for individual_subject + party_set;
 * role_sided (deed) is present so the schema + validation are complete, but its UI is fast-follow.
 * Designation roles are reserved (present, no binding UI). An unregistered documentType resolves to
 * undefined — callers decide (v1 treats an unknown/custom type as requiring classification before
 * generate/finalize/export; the mandatory-subject-pick only applies to individual_subject types).
 *
 * SINGLE SOURCE / SINGLE SEAM: every consumer reads through the accessor functions below
 * (getDocTypeConfig / getTargetStructure / isRoleKeyDeclared / ...), NEVER by importing DOC_TYPE_CONFIGS
 * directly or hardcoding the type list as a fixed enum. This in-code Readonly record is the v1 source;
 * a later follow-on (ADD-DOC-TYPE-1) swaps it for a data-backed registry + a guarded add-type form
 * (a user-added type must declare a valid targetStructure + roles; individual_subject types keep the
 * mandatory subject pick) WITHOUT touching any call site.
 */
export const DOC_TYPE_CONFIGS: Readonly<Record<string, DocTypeConfig>> = {
  durable_poa: {
    documentType: 'durable_poa',
    targetStructure: 'individual_subject',
    subjectMustBeClient: true,
    pairable: true,
    requiredRoles: [{ roleKey: 'subject', min: 1, max: 1, renderLabel: 'Principal' }],
    // RESERVED v1 (no binding UI): Sarah's POA names Greg as agent; as bound rows this makes the
    // fast-follow cross-wire constraint structural instead of a text-diff heuristic.
    designationRoles: [
      { roleKey: 'agent', min: 0, max: null, renderLabel: 'Agent' },
      { roleKey: 'successor_agent', min: 0, max: null, renderLabel: 'Successor Agent' },
    ],
  },
  pour_over_will: {
    documentType: 'pour_over_will',
    targetStructure: 'individual_subject',
    subjectMustBeClient: true,
    pairable: true,
    requiredRoles: [{ roleKey: 'subject', min: 1, max: 1, renderLabel: 'Testator' }],
    designationRoles: [],
  },
  advance_medical_directive: {
    documentType: 'advance_medical_directive',
    targetStructure: 'individual_subject',
    subjectMustBeClient: true,
    pairable: true,
    requiredRoles: [{ roleKey: 'subject', min: 1, max: 1, renderLabel: 'Declarant' }],
    designationRoles: [],
  },
  revocable_living_trust: {
    documentType: 'revocable_living_trust',
    targetStructure: 'party_set',
    subjectMustBeClient: false,
    pairable: false,
    requiredRoles: [{ roleKey: 'settlor', min: 1, max: null, renderLabel: 'Settlor' }],
    designationRoles: [],
  },
  certificate_of_trust: {
    documentType: 'certificate_of_trust',
    targetStructure: 'derived',
    subjectMustBeClient: false,
    pairable: false,
    requiredRoles: [],
    designationRoles: [],
    sourceDocumentType: 'revocable_living_trust',
  },
  deed: {
    documentType: 'deed',
    targetStructure: 'role_sided',
    subjectMustBeClient: false,
    pairable: false,
    // role_sided UI (grantee picker pulling non-clients/entities) is fast-follow; the role STRUCTURE
    // ships now so the bucket + validation are real.
    requiredRoles: [
      { roleKey: 'grantor', min: 1, max: null },
      { roleKey: 'grantee', min: 1, max: null },
    ],
    designationRoles: [],
  },
};

/** Look up a document type's targeting config, or undefined if unregistered (unknown/custom type). */
export function getDocTypeConfig(documentType: string): DocTypeConfig | undefined {
  return DOC_TYPE_CONFIGS[documentType];
}

/** The targetStructure for a type, or undefined if unregistered. */
export function getTargetStructure(documentType: string): TargetStructure | undefined {
  return DOC_TYPE_CONFIGS[documentType]?.targetStructure;
}

/** Does a targetStructure bind any parties at all? (false for non_party_specific.) */
export function targetStructureBindsParties(targetStructure: TargetStructure): boolean {
  return targetStructure !== 'non_party_specific';
}

/** All role keys a type declares — required + designation (reserved). The set a document_party
 *  roleKey is validated against. */
export function getDeclaredRoleKeys(config: DocTypeConfig): string[] {
  return [...config.requiredRoles, ...config.designationRoles].map((r) => r.roleKey);
}

/**
 * Is `roleKey` declared by `documentType`? A role the type does not declare is rejected at write time
 * (typo + nonsense protection without a DB enum; no migration per new role — disposition §2). An
 * UNREGISTERED documentType declares no roles, so every roleKey is rejected — an unknown type cannot
 * silently accept arbitrary bindings.
 */
export function isRoleKeyDeclared(documentType: string, roleKey: string): boolean {
  const config = DOC_TYPE_CONFIGS[documentType];
  if (!config) return false;
  return getDeclaredRoleKeys(config).includes(roleKey);
}
