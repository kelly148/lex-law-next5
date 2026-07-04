# Client-facing preconditions — ULTRABUILD-1 W8 / W9 (run-sheet G.2)

**One place** that lists every condition that must hold before ANY lane goes client-facing. Until every OPEN
item below is closed, the posture is **self-use only** (as today). Each item is marked DONE / OPEN with its
in-repo evidence. Fold-track and deed-track conditions are labeled — do not conflate them.

| # | Precondition | Track | State | Evidence |
|---|---|---|---|---|
| 1 | **Conflicts-at-intake (FOLD-L0-1) live-verified** | fold | **DONE** | `docs/STATE.md` 2026-06-03 entry (FOLD-L0-1 DEPLOYED + LIVE-VERIFIED; "self-use-only … CLEARED"); conflicts full-cycle UAT PASS |
| 2 | **Self-use-only waiver reversed on client lanes** | fold | **DONE** (for the FOLD-L0 gate) | `docs/STATE.md` (the FOLD-L0-1 clearance). *Distinct* from the AUTH-1/GOV-1 FIRE-review waiver — `docs/reviews/AUTH-1_GOV-1_review-record-note_2026-06-16.md` |
| 3 | **Deed-track S5 (Confirmation survivorship review) closed** | deed | **OPEN** | Deed release gate HELD; S5 review packet prepared in ULTRABUILD-1 W3b (`docs/engagements/ULTRABUILD-1-S5-review-packet.md`) — Kelly reviews |
| 4 | **Deed-track B6 (export-chokepoint / annotation-leak allowlist gate) verified across all 7 categories** | deed | **OPEN** | `docs/reviews/DEED-DRAFT-AGENT-1_FIRE_disposition.md` (B6 allowlist gate wired); per-category verification is ULTRABUILD-1 W3a |
| 5 | **D3 — source-anchored deed sign-off live** | deed | **OPEN** | "D3" = the audit's source-anchored sign-off (side-by-side legal description / parties / parcel vs the source image at finalize; NC-1 red line). §3.1 FIRE design plan + packet in ULTRABUILD-1 W10b; build + live-verify follow the triad |
| 6 | **Sendability: warn-only EXCEPT `wrong_matter_id` hard stop, with recorded override** | fold | **OPEN (enforcement flip is operator-gated)** | QA-5 as amended 2026-07-03; `docs/reviews/FOLD-SEND-1_disposition.md` decisions 1–9 (v1 hard-stops only `wrong_matter_id`; typed-confirm + content-hash-bound append-only override; fail-to-warn). Enforcement-capable code = ULTRABUILD-1 W4; the prod flag flip stays operator-gated |
| 7 | **F-2 affirmative confirmation — no code path touches wire instructions or disbursement figures** | scope-fence | **DONE / CONFIRMED** | See the F-2 confirmation block below (ULTRABUILD-1 W9) |

## F-2 confirmation (ULTRABUILD-1 W9) — recorded, not inferred

**"F-2"** is the Phase-0 baseline catastrophic-failure containment F-2 (wire/disbursement fraud or error): *the
AI system has no write access to wire instructions or disbursement figures, ever.* The audit added this as an
**affirmative, recorded** precondition — verified by search, not assumed from the scope fence.

**Finding — CONFIRMED by code inspection, 2026-07-03:** No wire/disbursement/payoff/settlement-money
**production** or **money-movement** code path exists anywhere in `src/` (server + client + shared). No code
generates wire instructions, computes disbursement figures, produces payoff amounts, assembles a settlement
statement / closing disclosure / net sheet / CDA / HUD-1, or moves money.

- **Search terms (case-insensitive, exhaustive over `src/`):** wire · disburs · payoff · settlement · escrow ·
  wiring · ABA · routing number · trust account · CDA · HUD · ALTA · closing disclosure · net sheet · proceeds;
  plus money-movement sweeps: IOLTA · ACH · wire transfer · funds transfer · net proceeds · seller proceeds ·
  trust ledger · swift code · remit · disbursement figure · payoff amount · beneficiary bank · bank account.
- **Every hit is benign**, in one of these classes: (i) the scope-fence **denylist itself**
  (`src/server/send/exportSafetyScope.ts` — settlement/title/closing_disclosure/hud1/alta/escrow EXCLUDED from
  the export gate); (ii) **NPI never-persist / default-withhold** lists (`chatCopilotPolicy.ts`,
  `chatCopilotConfig.ts` — wire/account/routing/payoff field names enumerated only to be dropped); (iii) a
  **capacity role label** (`title_settlement_agent`); (iv) **fail-closed title-signal routing** (route a
  title/settlement matter AWAY from the representational master); (v) a **flag-dark, read-only intake
  extractor** that *recognizes* settlement-statement money fields for classification (`documentTypeParsers.ts`
  + `materialExtraction.ts`, `DOCUMENT_EXTRACTION_ENABLED` **default OFF**) — reads uploaded material, produces
  and moves nothing; (vi) **static deed boilerplate** clause text; (vii) **test fixtures**.
- **Evidence class:** *confirmed by code inspection* (not "not established"). The single closest-to-fence item
  (the flag-dark, read-only FOLD-PM-2 intake extractor) is within-fence intake classification, not
  settlement/wire/disbursement production — **not a scope breach.**

## Notes

- Tracks are labeled because the list mixes **fold-track** (FOLD-L0, sendability) and separate **deed-track**
  (S5, B6, D3) conditions with independent numbering.
- "D3" and "F-2" are the audit's decision labels (source-anchored sign-off; Phase-0 wire-containment) — recorded
  here explicitly so a reader never has to guess them.
