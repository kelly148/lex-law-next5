# Retention / Deletion / Client-File-Return / DR Posture (FOLD-PERSIST-1 scaffold)

Status: SCAFFOLD. **All retention values below are `PENDING ATTORNEY SIGN-OFF`** — they are placeholders, not settled firm policy, and must not be treated as final legal/ethics retention periods. Values are an RPC / records-management decision for the attorney (Kelly), not model-selected. Machine-readable config: `src/server/config/retentionPolicy.ts`.

## 1. Data classes + retention periods (PENDING ATTORNEY SIGN-OFF)

| Data class | Retention period | Deletable | Notes |
| :-- | :-- | :-- | :-- |
| `matters` | `PENDING ATTORNEY SIGN-OFF` | yes | Matter record; client-file-return on close. |
| `documents` + `versions` | `PENDING ATTORNEY SIGN-OFF` | yes | Work product + drafts/versions. |
| `matter_materials` | `PENDING ATTORNEY SIGN-OFF` | yes | Client/source materials; client-file-return implications. |
| `audit_events` | n/a — **PERMANENT** | **no** | Immutable Matter Record (FOLD-GOV-1a). |
| `telemetry_events` | `PENDING ATTORNEY SIGN-OFF` | yes | Operational telemetry; shorter retention likely. |

## 2. Deletable vs permanent
- `audit_events` is **permanent / never hard-deleted** (immutable governance record).
- All other classes are deletable **only** after (a) attorney-signed-off retention periods exist, and (b) an explicit operator-approved hard-delete (see §4).

## 3. Client-file-return (PENDING ATTORNEY SIGN-OFF)
- Process on matter close: `PENDING ATTORNEY SIGN-OFF` (what is returned, format, timing).
- Interaction with retention: returned-then-retained vs returned-then-eligible-for-purge: `PENDING ATTORNEY SIGN-OFF`.

## 4. Deletion mechanism (default-safe; built in FOLD-PERSIST-1)
- **Soft-delete/archive** already exists on the spine (`matters.archivedAt`, `documents.archivedAt`, `matter_materials.deletedAt`) and is the default-safe state.
- **Purge eligibility** (`retentionService.describePurgeEligibility`) is **read-only/advisory** and returns `POLICY_PENDING` until the policy is signed off — it computes/deletes nothing now.
- **Hard-delete is operator-gated**: `assertHardDeleteApproved` throws without an explicit operator confirmation token, refuses permanent classes, and stays blocked while the policy is unsigned. It contains **no destructive SQL** — the actual purge is a **future operator-approved cleanup engagement**, never auto-run, excluded from auto-advance (CLAUDE.md Rule 14).

## 5. DR / backup posture (PENDING ATTORNEY SIGN-OFF)
- TiDB backup cadence / point-in-time recovery: `PENDING — confirm TiDB Cloud backup settings`.
- RPO / RTO targets: `PENDING ATTORNEY SIGN-OFF`.
- Restore-test cadence: `PENDING`.
- (Reviewer §3.5: TiDB quota exhaustion bit once — DR posture must be explicit.)

## 6. Sign-off
Replace each `PENDING ATTORNEY SIGN-OFF` value with the attorney-decided value and flip the corresponding `signoffStatus` in `retentionPolicy.ts` from `PENDING_ATTORNEY_SIGN_OFF` to `SIGNED_OFF`. Only once ALL classes are signed off does `isPolicySignedOff()` return true and purge-eligibility become computable.
