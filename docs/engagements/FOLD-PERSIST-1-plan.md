# FOLD-PERSIST-1 — Phase-A Plan + Build (retention/DR posture + minimal mechanism)

Engagement: FOLD-PERSIST-1 (Whereas fold Phase 1 / F.3). Type: Implementation. Checkpoint: §3.1 — **SKIP** for this narrowed scope (operator decision; see §4). Status: plan accepted; built under CLAUDE.md Rule 8 (reversible build-and-PR), halting at the accept gate.
Date: 2026-06-02. Repo: main 563b84a.

## 1. Scope (operator-approved Option a)
NOT "complete the 14-object schema." Instead:
1. A documented **retention / deletion / client-file-return / DR-backup posture scaffold** for the existing matter-state spine (`docs/retention_dr_posture.md`) — all values `PENDING ATTORNEY SIGN-OFF`.
2. A **minimal, default-safe retention/deletion mechanism** on the existing spine (`src/server/config/retentionPolicy.ts` + `src/server/retention/retentionService.ts`): placeholder policy; read-only purge-eligibility (POLICY_PENDING until sign-off); soft-delete/archive leveraged from existing columns; **hard-delete operator-gated, no destructive SQL, never auto-run**.
3. **No mass creation** of the seven remaining per-object schemas now.

## 2. Object → owning-engagement deferral map
Each remaining object's table is created by the engagement that defines its shape (the AuditEvent/GOV-1a precedent):

| Object | Deferred to |
| :-- | :-- |
| **Source** | source-authority / tiered-source engagement (FOLD-L1). **Carries the standing tier-name-collision constraint:** context-priority "tier" (`assembleContext` → now `contextPriority`, FOLD-TIER-1) vs source-of-truth authority "tier (1–8)" must be disambiguated in the data model before the Source schema is written. |
| **Provision** | provision-provenance / drafting-layer engagement (FOLD-DRAFT) |
| **Package** | package-bundle / package-closure engagement (FOLD-DRAFT) |
| **OpenItem** | open-item / sendability / matter-state engagement (FOLD-L1) |
| **LibraryEntry** | practice-knowledge-base engagement (FOLD-KB) |
| **JurisdictionRule** | jurisdiction-currency / rules-library engagement (FOLD-SEND) |
| **SendabilityRule** | sendability-rule-engine engagement (FOLD-SEND) |
| AuditEvent | ✅ already built (FOLD-GOV-1a) |

## 3. Revised acceptance (replaces "schema complete")
FOLD-PERSIST-1 claims ONLY: documented retention/client-file-return/DR **posture scaffold**; a **minimal retention/deletion mechanism**; **soft-delete / default-safe** behavior; and a **clear deferral map** for the remaining per-object schemas. It does **not** claim schema complete.

## 4. Triad: SKIP (operator) — two substitutes
- **(1)** Retention **policy values require Kelly's attorney/RPC/records sign-off**, not model selection — built as placeholders (`PENDING ATTORNEY SIGN-OFF`); no final periods chosen.
- **(2)** Deletion mechanism is **soft-delete/guarded**; any **hard-delete is an explicit operator-approved action excluded from auto-advance** — built as a guard with no destructive SQL.

## 5. Build
- `src/server/config/retentionPolicy.ts` — placeholder policy (periods null; `signoffStatus: PENDING_ATTORNEY_SIGN_OFF`; `audit_events` permanent).
- `src/server/retention/retentionService.ts` — `describePurgeEligibility` (read-only, POLICY_PENDING) + `assertHardDeleteApproved` (operator-token guard; no destructive SQL).
- `docs/retention_dr_posture.md` — the posture scaffold.
- `src/server/__tests__/mr_fold_persist_1.test.ts` — placeholders/permanent + default-safe-guard + no-destructive-SQL.
- No schema/migration; no destructive capability shipped.

## 6. Carryforwards
- Retention policy values + DR posture values → **attorney sign-off** (then flip `signoffStatus` to `SIGNED_OFF`).
- Actual purge/hard-delete → future operator-approved cleanup engagement.
- Per-object schemas → their owning engagements (§2 map).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
