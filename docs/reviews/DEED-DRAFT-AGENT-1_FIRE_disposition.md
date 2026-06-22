# Consolidated FIRE Disposition — DEED-DRAFT-AGENT-1 §3.1 Gate

**Ruling of record.** Seller-side conveyance profile (§2.1).
**Date:** June 22, 2026
**Seats:** GPT, Grok, Claude (triad) + supervising-attorney ruling on B1 (K. Satterwhite).
**Lane:** Cowork proposed/specced/grounded; CLI commits; deploy operator-gated.

## Disposition summary
- **§2.1 merge into `DEED_KB_SEED.md`: CLEARS.** Flag-dark Phase-1 work (golden fixtures + QA lint) may proceed.
- **Client-facing build: HELD.** Releases to CLI only after the dependencies **and** the encoded gates below land.
- No standing HOLD on the merge. Two reviewer HOLDs (C1, C2) block **client-facing** build until encoded.

---

## B-item rulings (final, reconciled)

**B1 — Estate warranty style → APPROVE-WITH-CHANGES (supervising-attorney ruling).**
Triad was 2–1 (Grok: GWD default+override; GPT: GWD scoped-narrow; Claude: flip to special-warranty default). **Supervising attorney rules: General Warranty Deed is the Mason house default for seller-side conveyances, including testate-estate-with-power-of-sale, with a `warranty_type` override** to special/fiduciary warranty on explicit instruction (commitment, contract, fiduciary authority, seller counsel, or attorney reviewer). This is a deliberate risk-acceptance decision, on the record — **not** a corpus inference. Attach the standing risk note: *"General warranty from a fiduciary exposes the estate to pre-existing (pre-decedent) title defects and a claims-tail surviving distribution; confirm risk tolerance, and select special/fiduciary warranty where the fiduciary or counsel requires it."* When the override is selected, the granting clause + authority recital switch to the special/fiduciary variant.

**B2 — Power-of-sale tree → APPROVE (GPT ruling controlling; hard fail-closed).**
Author and authority-map the inverse branches, but **automated drafting is limited to the grounded branch only: testate estate + qualified fiduciary + express power of sale + estate-as-seller.** Every other branch — no power of sale (devisees convey, PR joinder per VA Code §64.2 debt-subjection), intestate (administrator authority + heirs, §64.2-200), estate distributed/closed (heirs convey directly), co-fiduciary / successor / non-qualified PR, foreign will / ancillary administration — **remains blocked until separately authority-mapped and cleared.** Until a branch is mapped, the agent **fails closed**: refuse and escalate; never improvise a grantor block. (VA real property vests in heirs/devisees at death and routes through the PR only on a power of sale or debt-subjection — guessing drafts a void or chain-gapping deed.)

**B3 — Fiduciary name precedence → APPROVE (with Claude's split-track clarification).**
Two distinct resolution tracks, kept separate:
- **Fiduciary signer name** (capacity): **Certificate of Qualification > prior deed > commitment**, all material variants via `a/k/a`. Commitment caption is not authoritative.
- **Decedent / estate-caption name:** **prior vesting deed controls**; death-cert/probate variants carried via `a/k/a`. The "Estate of [decedent]" caption must stay on the chain of title.
On detecting an estate matter, the Certificate of Qualification is a **mandatory ingest**; if absent, force a human-review gate before finalizing the grantor block.

**B4 — Grantor name-change → APPROVE-WITH-CHANGES (evidence rule wired).**
Ratify "current legal name + formerly of record as [record name]." The agent may assert the link **only** with affirmative corroboration, in order of preference: (1) marriage certificate or court order (name-change/divorce/restoration); (2) the commitment/underwriter **expressly reciting** the name-change requirement (acceptable — insurer carries the risk); (3) explicit client/settlement-agent confirmation. **Name similarity alone is never sufficient**, and the link may not be inferred from the commitment caption alone. Absent corroboration → "name reconciliation — verification required" flag, fail-closed to human review.

**B5 — Grantor/recordation tax → APPROVE (off-deed only; reject on-deed field).**
The agent owns accurate **consideration + assessed value** (the inputs) on the Mason skeleton. It does **not** compute or print §58.1-802 (or the NoVA regional add-on, §58.1-802.3) on the recordable face of the deed. An **optional, clearly-labeled off-deed advisory estimate** is permitted solely as a cross-check against the settlement statement — never rendered on the deed or inserted into closing figures. Final tax treatment and payment allocation remain with the settlement agent. (§58.1-802: $0.50 per $500 or fraction where consideration/value > $100, grantor pays subject to contrary agreement — verify live rate/pin cites per normal practice.)

**B6 — Annotation-leak QA → APPROVE (deterministic allowlist gate).**
Implement an **allowlist render gate** (only known-good deed sections/tokens render) with a **deterministic denylist floor** that must at minimum fail on `NOTE:`, `TODO`, `[bracketed]`/unresolved placeholders, `{{ }}`, `<!-- -->`, and residual markdown (pipes, asterisks). **No LLM-as-judge inside the gate** — a recordability lint must be reproducible. Any unresolved token → fail-closed. Cross-file the known `NOTE:` leak (36-2026-6684) to **EXPORT-FORMAT-FIX-1** as the single deterministic chokepoint assertion, applied to **every** deed category.

---

## Reviewer HOLDs — recordability gates (block client-facing build)

**C1 — Two-prong legal-description verification → HARD GATE (was doctrine only).**
Elevate from §2.1.4(d) doctrine to a hard §2.1.6 constraint: the agent must affirmatively verify the legal description was (a) taken **verbatim** from commitment Exhibit A **and** (b) reconciled to the prior vesting deed; any divergence forces human resolution before emission. Condos: Declaration + Plat instrument numbers must match **exactly** (corpus already shows a botched plat-instrument citation). **Fail-closed.**

**C2 — Required-party / authority reconciliation → HARD GATE (was unenforced).**
Add a deterministic gate asserting **{grantor set on the draft} == {required-party set from Sch. B-I Req. 4}**, each grantor carrying a recorded authority basis, before emission. A missing required grantor = a void/unrecordable deed or a chain gap. (Henderson only worked because a human caught the Schedule-A-vs-B mismatch.) **Fail-closed.**

*Rationale for elevating both:* §2.1.6 as merged is formatting/typo-level QA. The two checks that actually decide whether a deed **records and insures** — right parties, right legal — were not enforced. That is inverted risk and must be corrected before any client-facing draft.

## Minor flags (non-blocking, fold into seed)
- **Signing venue:** pull from the closing-location field or leave blank for execution; the agent must not infer venue (e.g., Alexandria) at draft time.
- **Grantee TBE:** TBE requires a valid marriage between named grantees — confirm from Sch. B-I; do not infer from a shared surname (B4 evidence-discipline applied to the grantee side).

---

## Gate checklist
- [x] B1–B6 ruled (B1, B4 = APPROVE-WITH-CHANGES; B2, B3, B5, B6 = APPROVE w/ conditions)
- [x] C1, C2 recorded as hard recordability gates (reviewer HOLD on client-facing)
- [x] §2.1 patch approved to merge into `DEED_KB_SEED.md` — incorporate B1 (warranty config + risk note), B3 (split tracks), B4 (evidence rule), B5 (off-deed), B6 (allowlist), C1, C2, and the minors **before merge**
- [x] Flag-dark Phase-1 (fixtures + lint) may proceed
- [ ] **Client-facing build HELD** — releases only after all of: OCR (B1) · EXPORT-FORMAT-FIX-1 · copilot-with-KB substrate land **AND** C1 + C2 encoded (fail-closed) · B2 fail-closed wired · B4 evidence rule wired · B6 allowlist+denylist wired · updated §2.1 merged

## Conditions to clear client-facing build (the release gate)
1. OCR (B1) landed.
2. EXPORT-FORMAT-FIX-1 deployed (annotation strip + final-format path).
3. Copilot-with-KB substrate live.
4. C1 + C2 encoded as hard, fail-closed §2.1.6 gates.
5. B2 fail-closed scope-limit wired (grounded branch only).
6. B4 evidence rule + B6 allowlist/denylist gate wired.
7. Updated §2.1 (with all rulings) merged into `DEED_KB_SEED.md`.

## Governance notes
- **B1 is the only ruling overriding corpus rather than refining it.** Resolved on the record by the supervising attorney as house style + override + risk note — not passed silently.
- **C1/C2 were raised by one seat; the other two did not rule against them (they did not see them).** Silence is not adoption; they are carried as hard gates by attorney direction.
- **Next corpus priorities (future FIRE gates):** entity-out (LLC), trustee-out (trust), intestate/no-power estate, seller-side TODD — each returns with its own triad packet when corpus exists.

---
*Cowork lane — disposition prepared for the record; no commit, no deploy. Encoded into `DEED_KB_SEED__2.1_seller-side.md` (v2) and `DEED-DRAFT-AGENT-1_CLI_prompt.md` (v2).*

---

*Placed into the repo by the CLI lane (sole committer) as the durable §3.1 ruling of record for DEED-DRAFT-AGENT-1. The disposition itself was prepared and returned by the operator from the Cowork/triad lane; the CLI did not run, review, or approve the triad — it records the operator-returned ruling and proceeds only with the flag-dark Phase-1 scope the disposition CLEARS.*
