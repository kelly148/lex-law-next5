# Governance standing rules (index) — ULTRABUILD-1 W8 (run-sheet G.1 / G.3 / G.4)

**This doc is a thin INDEX + the three standing rules the audit added (G.1, G.3, G.4). It does NOT restate the
enforced rules** — those live in `CLAUDE.md` and drift if duplicated (the older `docs/AUTOPILOT_NEXT_SPEC.md`
already drifted from the live CLAUDE.md). **If this doc and `CLAUDE.md` ever conflict, `CLAUDE.md` is
authoritative.**

## Where the enforced governance actually lives (pointers, not copies)

| Concern | Authoritative source |
|---|---|
| Operating Rules 1–18, the two-phase engagement model, hard stops, `/autopilot-next` self-approve lane | **`CLAUDE.md`** (repo root) — the enforced source of truth |
| §3.1 three-prong FIRE criterion, Class-S/Class-T checkpoints, review-packet mechanics | `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1 |
| Fold "Standing constraints (apply to every fold engagement)" | `docs/WHEREAS_FOLD_master_plan.md` §Standing constraints (lines 120–133) |
| Client-facing preconditions | `docs/CLIENT_FACING_PRECONDITIONS.md` (companion, W8) |
| Where client data lives + provider-policy inventory | `docs/WHERE_CLIENT_DATA_LIVES.md` (companion, W8) |

## The three standing rules added by the 2026-07-03 audit

### G.1 — Start-gate rule (a gate for *starting*, not just for shipping)

**No new feature *program* opens while more than 2 flag-dark features await activation.** The build discipline
has accept gates for *shipping*; it lacked one for *starting*. Rationale (audit SP-2): every dark feature is
standing maintenance debt (its tests, migrations, flag interactions) purchased before its value is proven, and
the roadmap widened faster than daily-use evidence. Before opening a new program, count the flag-dark features
awaiting activation; if the count is > 2, close (activate or cut) before starting more. *(Increments that
complete or de-risk an already-open program are exempt; this gates net-new programs.)*

### G.3 — Model-swap ⇒ calibration re-run (+ preview-tier corollary)

**A model-ID change on a calibrated lane triggers a calibration-harness re-run before prod reliance.** Rationale
(audit A-6 / Top-5 #5): CAL-7B calibrated the reviewer lanes against gpt-5 / gemini-2.5-pro / grok-4; the
reviewer models were later modernized (gpt-5.5 / gemini-3.1-pro-preview / grok-4.3) with no re-run, so
"calibrated multi-reviewer" became unverified on the current slugs. **Preview-tier corollary (NEW):** a
`*-preview` slug can be deprecated/replaced by the provider with **no swap event** to trigger this rule, so
**preview lanes are treated as perpetually swap-eligible** — re-run on a fixed cadence *or* move them to GA
ids. The one preview lane today (`google:gemini-3.1-pro-preview`) is marked UNCALIBRATED-until-rerun in code
(ULTRABUILD-1 W5); `isPreviewTierModel(id)` flags it. See `docs/engagements/ULTRABUILD-1-model-pin-memo.md`.

### G.4 — Quarterly "where client data lives" inventory + provider-policy re-check (same cadence)

**Once per quarter:** (a) refresh `docs/WHERE_CLIENT_DATA_LIVES.md` (every location client data touches), and
(b) re-check each provider's current API no-train / retention / ZDR / DPA policy and file the citations.
Rationale (audit QA-1 / A-2 / Part C #5): privileged content flows to four model vendors on unfiled API-tier
defaults, and client-identifying material now lives across the repo, corpus, GitHub, and provider side —
individually reasoned acceptances that nobody has inventoried in aggregate. The quarterly inventory + the filed
provider citations are the RPC 1.6 "reasonable efforts" supervision file. The first pass (the skeleton) is
`WHERE_CLIENT_DATA_LIVES.md`; Kelly fills the `[K]` cells.
