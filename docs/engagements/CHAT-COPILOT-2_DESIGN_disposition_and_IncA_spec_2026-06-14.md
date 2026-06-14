# CHAT-COPILOT-2 — Design Triad Disposition + Increment A Build Spec (v2)

**Disposition:** §3.1 design triad — **3/3 APPROVE-WITH-CHANGES.** Architecture, the control-plane-as-spine, front-loading it into Increment A, reuse-over-rebuild, and the increment boundary are all **settled** (3/3 convergence — do not relitigate). The one disagreement (gate external-provider activation, or not) is resolved: **gate it** — Reviewer 1's "no HALT" was the outlier and missed two real holes; two reviewers + the reconciliation converged on gating. This spec folds the reconciled change set into a build contract. Lane: Cowork drafted; the **CLI builds**; operator gates merge/deploy/flag/allowlist. **No external-provider call is enabled until G1–G5 land and are verified.**

IDs preserved for traceability to the triad (G = activation-gating; Q = required-for-complete; RC/H = source finding).

---

## Cross-cutting resolutions (folded in; two flagged for your confirm)

- **Ephemeral = a LOCAL lifecycle property. LOCKED (operator, 2026-06-14): purge at CONVERSATION END** (and immediately on do-not-persist), **except** provenance-referenced attachments, which are pinned/snapshotted (Q6). Provider-side non-retention is a **separate** guarantee carried entirely by the allowlist's ZDR/retention criteria — the text may have left before the local copy expires.
- **Image egress (G4) — LOCKED (operator, 2026-06-14): scanned-document images are NEVER sent to any external provider; only extracted, NPI-minimized TEXT egresses.** Image preview is local-only, for the attorney's visual spot-check. Closes the minimization-blindness hole (text minimization can't see a mangled SSN inside an image). Any future change is a separate gated decision.
- **De-identification = belt-and-suspenders, never the control.** The control is affirmative per-turn selection + the allowlist; de-id is secondary (your prior KB work flagged manual-de-id leak risk — don't let it become load-bearing).
- **The dispositioner has a stake.** Claude dispositions critiques of Claude's own prior work product. Attorney-final covers it; the UX must *frame* it so the attorney calibrates (the dispositioner isn't neutral).
- **Audit guardrail (unanimous):** expand metadata, **never store content** — no raw NPI, no full prompts, no raw provider payloads. By-reference + hashes only; hash over the **minimized** payload, salted/keyed so a low-entropy field (an SSN) isn't recoverable from the hash.

---

## INCREMENT A — control plane + attachments. ACTIVATION-GATING (G1–G5): build HALTS before any external-provider call until all land + are verified.

**G1 — Single, non-bypassable egress broker.** Every provider SDK call (primary, grounding, and later panel) routes through one `egressClient.send()` that **enforces the allowlist gate and writes the `chat_egress_events` audit row in the same transaction.** No provider SDK is importable/reachable anywhere else in the tree — **enforced by an architecture/lint test that fails the build on a raw SDK import outside the chokepoint.** Gate runs **after** final outbound-bundle assembly/classification, **immediately before** dispatch, and **before** any retry/fallback. **No silent provider fallback:** a fallback to a second provider must independently pass the gate and be recorded as a **separate** egress event. Fail-closed (empty/unconfirmable allowlist ⇒ blocked).

**G2 — `holdFlag` is an enum, enforced on the primary path.** `none | no_panel | no_external`. **`no_external` blocks the primary AND grounding egress** (not just panel) — an NDA/own-confidentiality document must not reach any external provider, including the primary, in Increment A.

**G3 — Expanded, append-only audit schema (`chat_egress_events`).** Load-bearing field set: `gateDecisionId`, `allowedOrBlocked` + `blockReason` (**log blocked sends too** — that's the incident-detection evidence Safeguards wants), `allowlistVersion`/policy-snapshot id, `authorizationBasis` (`config_allowlist | panel_confirm`), `minimizationApplied` + profile, `npiCategoriesIncluded`/`npiCategoriesWithheld`, `holdHonored` + `holdExcludedAttachmentIds`, `inputBundleHash` (over the **minimized** payload), `attachmentIds`, `provider`/`model`/`kind`, `region`, `correlationId`/`requestId`, `status`, `failureReason`, `createdAt`/`completedAt`. Plus aggregate query fields `includedAttachmentCount`/`npiWithheldCount`. **Immutable, append-only, outlives the matter, no NPI.** (Drop the marginal fields — `responseHash`, full `panelConfirmText` — storage + sensitive-surface for little gain.)

**G4 — Image-egress resolved (see cross-cutting): images do not egress externally; text-only.** If ever changed, that path is separately gated.

**G5 — OCR cannot silently enter context + title-document quality + matter-mismatch confirm.** Low-confidence/failed extraction never silently becomes context. Title-document quality metadata: page-level extraction status + per-page OCR confidence; skew/rotation/image-quality warnings; handwriting/seal/stamp warning; **legal-description and recording/parcel/instrument-identifier warnings** (the dangerous-middle fields are never authoritative context without an attorney-verify affordance, with the **source image region shown** for spot-check); graphical-document ("this is a drawing; extraction incomplete by nature") flag for plats/surveys; "visual review required" flag. **Matter-mismatch attachment → a logged SOFT attorney confirm** ("this document's parties/parcel don't match this matter — confirm before use"), not a hard block (a hard block on parcel/lender would mis-fire on legitimate refis/repeat parties). *(Hash-match to a material in a DIFFERENT matter stays a harder stop — see Q3.)*

## INCREMENT A — required for "complete" (Q items in A scope)

**Q3 — Cross-matter + intra-matter scoping at the drop event.** Run a conflict/identity check **at attachment time**, not just at assembly: if the dropped file's content/hash matches a material associated with a **different** matter → cross-matter warning before it becomes context (harder stop). Capture **optional party attribution at save-to-matter** (which party a document belongs to) so role-based intra-matter exclusion (buyer-vs-seller financials, insured-vs-lender) is enforceable rather than aspirational.

**Q4 (A-scope UX) — no misleading signals.** Citation chips say **"source present in bundle,"** never **"verified"** (proves grounding, not legal correctness). The **egress indicator** distinguishes: provider configured / provider allowlisted / selected-for-this-turn / excluded-by-hold-NPI-conflict-OCR. A **per-send provenance chip on each assistant message** ("sent to anthropic: this turn + 2 attachments") — the UX face of the audit log. **Three distinct attachment chip states:** extracted-clean / low-confidence (text but suspect) / failed (no text). **Save-to-matter** is labeled as the retention act it is ("becomes part of the matter file"), not a silent convenience.

**Q5 — Accept-with-warning + selected-for-this-turn manifest.** A logged "include anyway (persist warning flag)" affordance for low-confidence title docs that means **"attorney accepted the risk," NOT "the text is correct"** (the warning travels into context and is visible; it never propagates as verified). A dragged-in attachment is **selected-for-this-turn only** — it does not become globally available to the whole matter chat unless saved/pinned.

**Q6 — Provenance pins/snapshots referenced ephemeral attachments; provenance-sufficiency is Increment A's EXIT GATE.** A turn that relies on an ephemeral attachment must keep that attachment defensibly recoverable (pin against purge, or snapshot enough), so a later promote-to-draft chain never points at a deleted object. Everything downstream (B + the roadmap) inherits this — do not thin it.

**Q7 (A-scope) — Queryable supervision.** The audit schema must support oversight queries now (egress by provider + matter + date range + attachment volume), even if the dashboard comes later.

**Q1 (A-scope: hash-at-gate).** `workProductHash`/`inputBundleHash` is computed at the **egress chokepoint over the actual serialized, minimized, hold-filtered payload** — not upstream over the pre-filter selection — so the defensible record proves what actually went out.

---

## INCREMENT B — the review panel (built later; flagged here so Increment A lays the seam)

`CHAT_REVIEW_PANEL_ENABLED` (default OFF) + the egress allowlist (fail-closed). Carries: **Q1 — the `ChatReviewBundle` contract** (work-product text, selected attachment IDs, selected matter-material IDs, thread-window hash, context-source manifest, excluded-source manifest, NPI-minimization result, hold-flag exclusions, extraction-status warnings, final outbound content hash) — and reuse `reviewSession` via an explicit `inputType: 'chat_work_product'` path so the orchestration/evaluator is adapted (not fed a transcript dump). **Q2 — synthesis fidelity is real only if persisted:** store **verbatim raw reviewer output by-reference, distinct from itemized suggestions**, with a reviewer-suggestion hash and **1:1 traceability** (every reviewer suggestion → exactly one dispositioned item, no silent merge/drop) + **per-lane reviewer status** on the run. **Q7 (B-scope) degraded states:** zero reviewers succeed → clear "no reviewers available" message, no partial/empty result misread as agreement; dispositioner (Claude) errors/off-allowlist → attorney sees raw, **undispositioned** suggestions explicitly marked "not yet synthesized," never raw third-party text presented as vetted; "fail closed mid-run" prevents **future** sends in that run but does **not** retract a completed egress (keep the audit truthful); **"flagged" = unverified-against-bundle, NOT discarded** (a reviewer may correctly cite a real VA statute/LEO not in the bundle — flag for verification, don't auto-reject). **Q4 (B-scope):** the panel-confirm shows the **post-minimization, post-hold** set actually transmitting ("going: doc X (minimized), doc Y; excluded: doc Z (hold)"), not the pre-filter selection.

## ROADMAP — promote-to-draft
Its own §3.1 FIRE engagement; inherits the Increment-A provenance (Q6) as a defensible record.

---

## Build structure / flags / migrations / acceptance

- **Increment A** behind `CHAT_COPILOT_ENABLED`; **Increment B** additionally behind `CHAT_REVIEW_PANEL_ENABLED` (default OFF) + the egress allowlist. Nothing deploys; additive migrations (attachments, egress-events, review tables, party-attribution) auto-apply on a future operator deploy — **operator apply items, called out**.
- **Increment A acceptance (blocking):** G1–G5 implemented + tested (incl. the architecture/lint test for G1, the `no_external`-on-primary test for G2, blocked-send logging for G3, the OCR dangerous-middle + matter-mismatch tests for G5); Q3/Q4/Q5/Q6/Q7/Q1-hash present; **provenance-sufficiency exit gate (Q6) passes.** tsc + eslint clean; CI green.
- **Activation stays operator-gated:** even with A complete, external-provider sends require the operator to populate the allowlist (post no-train/GLBA confirmation) + deploy + flip the flag — and the GLBA verification (VSB hotline / E&O) runs in parallel.

## Next
This is the build-ready Increment A contract. On your go, the CLI builds Increment A (control plane + attachments), with G1–G5 as hard gates and the activation chain still yours. Increment B (the panel) follows; promote-to-draft is the deferred roadmap FIRE.

*Assembled by Cowork from the 3/3 design-triad disposition + reconciliation. Pre-build; nothing committed. The GLBA/ethics items remain operator-verified, not Cowork legal advice.*
