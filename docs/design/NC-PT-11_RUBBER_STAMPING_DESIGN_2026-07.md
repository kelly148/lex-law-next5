# NC-PT-11 — Anti-rubber-stamping safeguard design (Stage-2 second-attorney)

**Date:** 2026-07-07
**Author:** Cowork/CLI (OVERNIGHT-2026-07-07 item 5)
**Status:** DESIGN ONLY — not a build authorization. No code is written or implied here. See §7.
**Controlling source:** `docs/reviews/PRODUCT-THESIS-1_consolidated_disposition_2026-07-06.md` (NC-PT-11), read with `docs/design/PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md`. Where those differ, the disposition controls.

---

## 1. Context and the exact NC-PT-11 requirement

PRODUCT-THESIS-1 was adopted 3/3 (ADOPT-WITH-NAMED-CHANGES) on 2026-07-06. The disposition scopes the product in two stages that this design depends on:

- **Stage-1** is the single operator — Kelly. The thesis and its architecture "build unapologetically on Kelly's corpus" (disposition §1.5). Claims validated against that corpus are tagged **K (Kelly-validated)**.
- **Stage-2** is the first additional user. Generalizations beyond Kelly's own practice are tagged **G (generalization pending Stage-2 evidence)** and "require revalidation before governing Stage-2 decisions" (disposition NC-PT-11). NC-PT-4 makes the drafting parity gate "release-blocking per instrument type ... Binds before any Stage-2 user."

NC-PT-11 is quoted here in full, because this design exists to discharge it:

> **NC-PT-11 — K/G claim register:** thesis and architecture claims tagged K (Kelly-validated) or G (generalization pending Stage-2 evidence); G-claims require revalidation before governing Stage-2 decisions. The **rubber-stamping risk is named**: a Stage-2 user may click-through dispositions, converting the judgment surface into liability theater — a design answer (forced-choice friction, sampling audits, or disposition-quality signals) is required *before* Stage 2, not after.

Three facts anchor everything below:

1. **The judgment surface is the product's center of gravity.** The disposition loop (adopt/modify/reject/hold/pass) is "the only truly universal surface" in the corpus and "should be the most optimized surface in the product" (thesis §a.1). The whole thesis is that the attorney's *judgment* is the value-add; the product "automates the labor around attorney judgment and never the judgment itself" (thesis v1.1, disposition §3).
2. **Rubber-stamping attacks exactly that surface.** If a disposition can be produced without the judgment it is supposed to record, the product's most-optimized surface becomes "liability theater" — an audit trail that looks like supervision but records reflex. The threat is not incidental; it is the failure mode that hollows out the core claim.
3. **The safeguard is a precondition, not a follow-on.** NC-PT-11 says the design answer is "required *before* Stage 2, not after." This is consistent with the platform's governing principle from `CLAUDE.md`: the attorney is *always* the final decision-maker, and reviewers/AI "surface options and issues; they never make business decisions or treat business choices as drafting defects." A disposition surface that can be defaulted-through violates that principle silently.

The disposition names three candidate design answers — **forced-choice friction, sampling audits, and disposition-quality signals** — without ranking or specifying them. This document develops all three into concrete mechanisms, ties each to a specific failure mode, and surfaces the operator decisions that must be made before any of it is built.

A scope note the disposition forces: NC-PT-11 is currently a **G-claim about a risk**. The rubber-stamping failure mode has *not* been observed in the corpus — the corpus is single-operator (Kelly), and Kelly is the person whose corrections define the judgment surface in the first place. The threat model in §2 is therefore an inference about a second, less-engaged user who does not yet exist. That inference is exactly what NC-PT-11 asks us to design against pre-emptively; it should be revalidated against real Stage-2 behavior, not treated as settled.

---

## 2. Threat model — Stage-2 rubber-stamping failure modes

"Rubber-stamping" here means: a disposition (adopt / modify / reject / hold, or an approval-to-export / sign-off) is recorded **without the genuine independent attorney review it is supposed to attest to.** The record says a judgment happened; no judgment happened. Each mode below is a distinct path to that outcome. The named mitigations in §4 are keyed back to these IDs.

**RS-1 — Approve-without-reading.** The second attorney clicks adopt/approve on model or reviewer output without reading the underlying material. The disposition record is created; the review it certifies did not occur. This is the base case NC-PT-11 names ("click-through dispositions").

**RS-2 — Approval-by-default / pre-checked state.** The UI presents adopt (or "accept all reviewer suggestions") as the pre-selected, one-gesture default. The path of least resistance *is* approval, so approval happens whether or not judgment was applied. This is the mechanical enabler of RS-1: it is not that the attorney chooses to skip review, it is that the interface never required a choice.

**RS-3 — Velocity pressure / batch sweep.** Under volume (Stage-2 exists precisely because one attorney's throughput was the constraint), the second attorney "adopts all" or sweeps a batch to clear a queue. Batch disposition is a *feature* the thesis endorses ("per-point and batch, every act audited," thesis §a.1) — so the threat is that a legitimate efficiency tool becomes an undifferentiated rubber stamp when every item in the batch is approved with one uninspected gesture.

**RS-4 — Over-trust in an "the AI already reviewed it" signal.** The platform runs multi-model review and an advisory sendability/evaluator layer. If the second attorney reads "3 reviewers passed" or "sendability: clear" as *permission not to review*, the AI's pass substitutes for attorney judgment. This inverts the thesis: reviewer output is meant to be *screened for verification, sycophancy, and citation provenance before it reaches disposition* (thesis §b), not to pre-authorize the disposition. The disposition itself explicitly rejects anything that "auto-applies a disposition, synthesis, or fetch" — RS-4 is the human-side version of auto-apply: the human applies it, but the AI's signal did the deciding.

**RS-5 — Diffusion of responsibility between two attorneys.** With a drafter-attorney and a second (approver) attorney, each may assume the other exercised the real judgment. The drafter thinks "the approver will catch it"; the approver thinks "the drafter already vetted it, and the reviewers passed it." Genuine review falls into the gap. This is the specific *new* risk that Stage-2 introduces and Stage-1 (single operator) structurally cannot have — with one attorney there is no one to defer to.

**RS-6 — Attestation without content.** Even when friction is added, if the attestation is generic ("I have reviewed this document") and does not name *what* was reviewed on *which matter* against *what alternatives*, the record degrades to a signature ritual. The audit trail then documents that a click occurred, not that a judgment was formed — the definition of liability theater. This is the failure mode that makes a naive "add a confirmation dialog" fix worthless.

**RS-7 — Resurrection blindness.** NC-PT-6 requires that a rejected term reappearing be "flagged as a RESURRECTION, never silent." A rubber-stamping second attorney who approves a later draft without noticing a resurrected, previously-rejected term re-admits a decision the matter already settled. Rubber-stamping is not just a per-item risk; it corrodes the *cumulative* integrity of matter-state.

---

## 3. Design principles

These constrain every candidate mechanism in §4. They are derived from the disposition and from the `CLAUDE.md` supervision principles; where a principle goes beyond the disposition text it is marked (inferred).

**P1 — The attorney is always the final decision-maker; the tool never is.** From `CLAUDE.md` and the thesis: "The product automates the labor around attorney judgment and never the judgment itself." No safeguard may itself decide, nor may any AI signal be allowed to stand in for the attorney's judgment. Safeguards make the judgment *happen and be recorded*; they do not make it.

**P2 — Friction proportional to consequence.** (Inferred, consistent with disposition.) NC-PT-11's "forced-choice friction" must not become uniform ceremony — the disposition's own guard against overbuilding state warns "don't overbuild ceremony ... merely because today's tools force manual ceremony" (§1.7). Friction is spent where a wrong disposition is expensive or hard to reverse (export/send, sign-off, overriding a reviewer blocker, re-admitting a rejected term), and withheld where it would only train click-fatigue (routine, low-consequence, easily-reversible dispositions). Undifferentiated friction produces RS-6, not review.

**P3 — Make genuine review the path of least resistance.** (Inferred.) The strongest anti-rubber-stamp is not a heavier stamp; it is a UI in which the easiest way to proceed is to actually engage the material — the decision-relevant content is in front of the attorney at the moment of disposition, and no single default gesture disposes without it. This directly counters RS-2 and RS-3.

**P4 — Attestations must mean something: name what was reviewed.** An attestation records *this decision, on this matter, over these named alternatives, on this basis* — not a generic "reviewed." This is the difference between NC-PT-6's "malpractice-defense / RPC 5.3 supervision record" and liability theater. An audit trail that cannot answer "what did the approver actually see and choose between?" fails P4.

**P5 — The safeguard is itself auditable and immutable.** Per NC-PT-6, disposition records already get "immutability, timestamps, and export." The anti-rubber-stamp attestation is part of that record: who approved, what they were shown, what basis they gave, and — where sampling is used — whether the item was audited and by whom. The safeguard cannot be a runtime-only nudge that leaves no trace.

**P6 — Separate the drafter from the approver where consequence warrants.** (Inferred from RS-5; supported by the dual-hat/RPC-5.5 segregation logic the disposition already relies on in §1.4.) The person who produced or drove a draft should not be the sole recorded reviewer for its highest-consequence gate. Diffusion of responsibility is defeated by making each role's contribution distinct and individually attributed, not by adding a second signature to the same undifferentiated act.

**P7 — An AI pass is an input to judgment, never a substitute for it.** Reviewer/evaluator/sendability output is surfaced as *material to be screened*, and is never rendered as permission-to-skip. Directly answers RS-4 and enforces the thesis rule that reviewer output "is screened for verification, sycophancy, and citation provenance before it reaches disposition."

---

## 4. Concrete safeguards (candidate mechanisms)

Each mechanism below is a candidate, keyed to the threats it mitigates and the principles it serves. These develop the three answers NC-PT-11 names (forced-choice friction; sampling audits; disposition-quality signals) plus separation-of-roles. Selection among them is an operator decision (§6) — this section defines the menu, not the final build.

### 4.1 Consequence-tiered forced-choice affirmations (answers RS-1, RS-2, RS-6; serves P1, P2, P3, P4)

- **Tiering.** Classify each disposition/approval by consequence: Tier 0 (routine, reversible per-point dispositions) — no added friction; Tier 1 (settled-term changes, reviewer-blocker overrides, disposition of a substantive issue) — a forced choice; Tier 2 (approve-to-export, client-send sign-off, re-admitting a rejected term) — a forced choice **plus** a named-basis attestation and, where §4.4 applies, a second attributed reviewer.
- **Forced choice, not confirmation.** At Tier 1+, the action is presented as a genuine choice among the real options the matter has (e.g. adopt / modify / reject / hold — the corpus's own verbs), with **no option pre-selected** (kills RS-2). The attorney must actively pick; there is no single default gesture that disposes.
- **Specificity: "you are approving X on matter Y."** The affirmation names the concrete object: the instrument, the matter, and — for a disposition — the specific term/issue and the alternative(s) being declined. Generic "I have reviewed this" is prohibited (kills RS-6, serves P4). Example content pattern: *"You are approving the non-recourse structure on Matter 24-0112 (Smith refinance), declining the recourse alternative the reviewer flagged. This will govern future drafts (NC-PT-6)."*
- **Basis capture at Tier 2.** For export/send/sign-off, a short structured basis is captured (a reason code and/or free text). This is the content that makes the record a supervision record rather than a signature.

### 4.2 What-was-reviewed capture (answers RS-1, RS-6; serves P4, P5)

- Bind each disposition to a **snapshot of what the attorney was shown at decision time** — the specific draft version, the reviewer suggestion(s) in scope, and the input manifest (per NC-PT-5, "no cross-model comparison ... without a per-lane source manifest"). The record then answers "what did the approver actually see?" — the P4 test. Without this, an attestation cannot be distinguished from a click.

### 4.3 Anti-default-approval UX (answers RS-2, RS-3; serves P3)

- **No pre-checked approvals**; no "accept all" as the resting default at Tier 1+.
- **Batch discipline.** Batch disposition remains available (it is an endorsed feature), but a batch "adopt all" at Tier 1+ must itemize what is in the batch and require an affirmative sweep the attorney cannot produce by a single reflex on a pre-selected control. Consider surfacing the *heterogeneity* of a batch (e.g. "3 of these 12 items change settled terms") so a uniform sweep cannot silently carry a high-consequence item. (Kills RS-3's undifferentiated sweep while preserving the legitimate efficiency tool.)

### 4.4 Separation of drafter and approver roles (answers RS-5; serves P6)

- At Tier 2 (export/send/sign-off), the recorded approver should, where staffing allows, be distinct from the drafter-attorney, and **each role's act is individually attributed** in the record. Where the same attorney must do both (small firm; the realistic Stage-2 case), the record makes the dual role explicit rather than hiding it, so the audit trail never *implies* an independent second review that did not occur.
- This is a **policy-plus-record** mechanism, not a hard technical lock: the platform cannot manufacture a second attorney. Its job is to (a) support the separation when it exists and (b) never launder its absence.

### 4.5 Neutralize the "AI already reviewed it" signal (answers RS-4; serves P1, P7)

- Reviewer/evaluator/sendability output is presented as **material to be screened**, never as an approval gate the attorney merely countersigns. Language and layout must not read as permission-to-skip. A reviewer "pass" or "sendability: clear" is shown as *what the model concluded and why*, adjacent to the material, so the attorney disposes of the reviewer output rather than inheriting its verdict.
- Explicitly: a green AI signal never pre-selects, unlocks, or lowers the tier of an attorney affirmation. (P7.) If anything, a *unanimous reviewer pass on a high-consequence instrument* is a candidate trigger for §4.6 sampling, not a candidate for reduced friction — because that is exactly where over-trust is most tempting.

### 4.6 Sampling audits (answers RS-1, RS-3, RS-4, RS-7; serves P5)

- A configurable fraction of dispositions/approvals is flagged for **second-look audit** — either by a designated supervising attorney (RPC 5.3 supervision, echoing NC-PT-6) or by a scheduled self-audit queue. The point is not to re-review everything (that defeats the throughput reason Stage-2 exists) but to make rubber-stamping *detectable*, so that the attestation carries real expected accountability rather than none.
- Audit outcomes feed §4.7 signals and are themselves recorded immutably (P5).
- Sampling is the disposition's named third answer and is the natural home for catching RS-7 resurrection blindness: resurrected-term approvals are a high-value sampling stratum.

### 4.7 Disposition-quality signals (answers RS-1, RS-3, RS-6, RS-7; serves P4, P5; ties to NC-PT-9)

- Instrument the *disposition act itself* and surface quality signals, not just outcomes. Candidate signals: time-on-material before disposition (a floor-of-attention proxy, used carefully — see caveats), rate of pure "adopt-all" batch sweeps, fraction of dispositions that carry a named basis vs. generic, resurrection-approval rate (approving a draft containing a previously-rejected term without flag acknowledgement, per NC-PT-6/RS-7), and reviewer-override-without-basis rate.
- These connect directly to NC-PT-9's Stage-2 companion metrics — **rework rate, reopened-settled-issues, artifact acceptance rate, package inconsistency rate** — which are, in effect, the *downstream* evidence that rubber-stamping is or is not happening. A rising reopened-settled-issues rate is a lagging rubber-stamp indicator; the §4.7 signals are the leading indicators.
- **Caveat (inferred, important):** any per-act metric (especially time-on-task) is gameable and can itself become theater if it becomes a target — an attorney can idle a timer. Signals are for detection and supervision review, **not** as an automated gate that blocks or approves (that would violate P1 by letting a metric decide). This must be stated in the build spec so signals are never wired into the approval path.

### 4.8 Visible audit trail of who-approved-what-and-on-what-basis (answers all; serves P4, P5)

- Consolidate the above into the record NC-PT-6 already mandates: for each disposition/approval — **who** approved, **what** they were shown (§4.2), **which options** they chose among, **on what basis** (§4.1 Tier 2), **whether** it was sampled/audited and by whom (§4.6), and the immutable timestamp. This is the "malpractice-defense / RPC 5.3 supervision record" made rubber-stamp-resistant: it does not merely prove a decision was recorded; it preserves enough to show a *judgment* was formed.

---

## 5. Stage-1 out of scope; Stage-2 required

NC-PT-11 says the design answer is required "before Stage 2, not after." That is a scoping instruction, not a build-now instruction. The split:

**Explicitly OUT of scope for Stage-1 (single operator — Kelly):**

- The full anti-rubber-stamp machinery (§4.1 tiered affirmations, §4.4 role separation, §4.6 sampling audits, §4.7 quality signals) is **not required to operate** at Stage-1. Stage-1 has one attorney who is the source of the judgment standard; there is no second, less-engaged approver to defend against, and no diffusion-of-responsibility gap (RS-5 is structurally impossible with one user). Imposing the full ceremony on the single operator would be exactly the over-built ceremony §1.7 warns against and P2 prohibits.
- What Stage-1 *should* still have (because it is load-bearing regardless and NC-PT-6 already requires it): the immutable, timestamped, exportable disposition record with what-was-reviewed capture (§4.2, §4.8) and the resurrection flag (RS-7 / NC-PT-6). These are matter-state integrity features, not multi-user safeguards; they happen to be the substrate the Stage-2 safeguards attach to, so building them Stage-1-clean avoids a retrofit.

**REQUIRED at Stage-2 (first additional user), before that user is added:**

- A concrete, operator-selected instantiation of the NC-PT-11 answer — at minimum one mechanism from each of the three named families (forced-choice friction §4.1/§4.3, sampling audits §4.6, disposition-quality signals §4.7) plus the neutralized AI-signal treatment §4.5, since RS-4 arrives with the first user who did not build the reviewer trust themselves.
- This binds alongside NC-PT-4 (the drafting parity gate, also "before any Stage-2 user"): both are Stage-2 entry gates. A second user should not be added until (a) the parity gate passes per instrument and (b) the anti-rubber-stamp design is built and live. Sequencing the two is an operator decision (§6).
- Per NC-PT-11, the G-tagged assumptions in this design (the whole §2 threat model is an inference about a not-yet-existing user) must be **revalidated against real Stage-2 behavior** and not left as permanently-assumed truth.

---

## 6. Open questions and operator decisions required before implementation

None of these should be resolved by Cowork/CLI; each is a business, legal, or product-owner call for Kelly.

1. **Consequence tiering.** What is the authoritative mapping of disposition/approval types to Tier 0/1/2? Specifically: which acts are "export/send/sign-off" Tier 2, and does re-admitting a rejected term always force Tier 2? (Drives §4.1.)
2. **Which of the three named answers, and how much of each?** NC-PT-11 lists forced-choice friction, sampling audits, and disposition-quality signals as alternatives ("or"). Does Stage-2 require all three, or a chosen subset? This design recommends at least one from each family, but the disposition permits fewer — an operator call.
3. **Sampling rate and auditor.** If sampling audits are adopted (§4.6): what fraction, and who audits — a designated supervising attorney (RPC 5.3), a rotating self-audit, or an external check? Does the rate vary by tier/instrument?
4. **Role separation feasibility.** In the realistic first Stage-2 configuration (likely a small firm where the same attorney may draft and approve), is drafter/approver separation (§4.4) a *requirement*, a *when-available* support, or deferred? The platform cannot manufacture a second attorney; the operator decides how hard to push separation vs. how honestly to record its absence.
5. **Signals as detection only — confirm the non-gate rule.** §4.7 caveat proposes that quality signals never automatically block or approve (P1). Confirm this is the intended posture, and confirm whether time-on-material is even collected (privacy/theater tradeoff).
6. **Gate sequencing with NC-PT-4.** Both this safeguard and the parity gate bind "before any Stage-2 user." In what order, and can a Stage-2 user be added before both are complete under any condition? (Recommended: no.)
7. **RPC / ethics review.** Because this is the malpractice-defense / supervision record (RPC 5.3) and touches how supervision is documented, does the design itself warrant outside ethics-counsel review before build? (Flagged, not decided — an anti-rubber-stamp design that is itself wrong could create false assurance.)
8. **Revalidation trigger (NC-PT-11 G-claims).** What real Stage-2 evidence would confirm or refute the §2 threat model, and at what point is it collected? The threat model must not calcify into an assumed truth.

---

## 7. Status of this document

This is a **DESIGN document only.** It contains no code, no schema, no migration, and no build steps. It does not authorize implementation. It does not satisfy, trigger, or waive any §3.1 external-triad-review checkpoint, and it does not itself constitute that review. Building any mechanism described in §4 is a separate, future engagement that must clear its own scope, gate, and — given the access-control / supervision / client-send-safety surface this touches — its own §3.1 triad-review determination before any code is written. The safeguards here are candidates for the operator to choose among (§6), not a committed plan.

Everything in §2's threat model and any principle or mechanism marked "(inferred)" goes beyond the literal disposition text and is offered as reasoned extension of NC-PT-11, not as adopted requirement; the adopted requirement is the NC-PT-11 quotation in §1. Where this document and the disposition differ, the disposition controls.
