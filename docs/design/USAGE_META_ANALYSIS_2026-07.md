# Usage meta-analysis — Kelly's claude.ai account (2026-07)

**Cowork, 2026-07-06.** Evidence layer for `PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md`. This document establishes *what Kelly actually uses AI for, in what proportions, with what recurring moves.* It is not the point in itself — every fact here is built to cash out as a product-identity conclusion in the alignment report. Companion inputs: the 71-row requirements trace (`CONV_UI_REQUIREMENTS_TRACE_RICKY_THREAD_2026-07-05.md`), the raw enumeration (`ACCOUNT_CENSUS_RAW_2026-07.md`), and the Title/RE-General/law-firm project memories read in situ during the sweep.

## Method and limitations (read first)

Enumeration is **complete**: all 234 threads across the three primary projects were listed by title, project, and recency (Title 65, Real Estate General 71, law firm 98). Non-project one-off chats were excluded per Kelly's direction (2026-07-06) — they are not practice work.

Classification below is **title-based inference cross-validated by deep reads.** 43 threads have been read in full and distilled (37 in the prior sweep + 6 ranked-leftovers this sweep); the remaining ~191 are classified from their titles and their project's known character. Under R5, treat the **rank-ordering of categories as STRONG** (it is stable across every deep read and matches the project memories' own self-description of Kelly's practice) and the **exact counts as MODERATE** (±~3 per bucket from title ambiguity and threads that span two categories). Counts are assigned by *primary* practice area and *primary* workflow genre; many threads legitimately touch two. Per R1, these are thread counts, not matter counts — several matters span multiple threads (ERGUN = 5, WIOS = 3, HEATHER AMMANN = 2, Logue = 3+, Enterprise Court = 2), so the *matter* population is smaller (~150–170) and more concentrated than the thread count suggests. R10 applies throughout: this is an observational usage dataset, "in this corpus," not a controlled measurement.

---

## (a) Full account census — distribution

### By practice area (of 234 threads, primary area)

| Practice area | Approx. count | Share | Representative threads |
|---|---|---|---|
| **Trusts & estates** (wills, RLTs, POAs, AMDs, certificates of trust, probate, pour-overs) | ~54 | ~23% | TSEEHAY, GAFFNEY WILL, Madigan AMD, Sylvia Ray will, Morris trust, mirror-will template, Debra RLT, David Miller probate |
| **Title examination / settlement / curative** (title-company core) | ~44 | ~19% | HEATHER AMMANN, full title exam & report, abstract review, unreleased-DOT chain, deed-of-correction/UDOT, FIRPTA seller affidavit, Marine Corps Museum pricing |
| **Firm operations & practice management** (invoices, engagement letters as ops artifacts, formatting-only, staff/HR letters, training, SOPs, marketing, status checks) | ~34 | ~15% | AmLaw invoice generation, formatting-style threads, managing-attorney task workflow guide, title-processor training plan, call scripts, "System status check" |
| **Residential RE transactions** (contracts, deeds, closings, POAs for sale) | ~28 | ~12% | TOMITA sales contract, deed of gift, MD residential contract questionnaire, family purchase w/ delayed closing, NVAR changes |
| **Business entity / M&A / asset sales / governance** (LLC formation, operating agreements, business purchases) | ~21 | ~9% | Ink'd GC, Hadjikyriakou business/asset sale, Satterwhite Investments LLC OA, hair-salon asset purchase, Rosalia LLC OA |
| **Seller-financing / private lending** (notes, DOTs, loan packages, wraparounds) | ~20 | ~9% | DAVID JONES note/DOT, John Haar note/DOT, 1319 Custer loan docs, Martine Richardson 3210 Q, wraparound package, commercial loan templates |
| **Commercial RE & leasing** | ~14 | ~6% | ERGUN cluster, CDT/Xtreme commercial lease, WIOS lease, Enterprise Court, tenant-side lease review |
| **1031 exchanges** | ~10 | ~4% | reverse-1031 common-law-trust, 1031 closing deadline, stepped-up-basis, QI engagement-letter template, 1031 knowledge capture |
| **Platform / tooling meta** (prompt engineering, model review, connectors) | ~9 | ~4% | Prompt optimization for ChatGPT, Model conversation review, Integrating Notebook LLM, Optimizing for latest ChatGPT model |
| **Adversarial / disputes** | ~6 | ~3% | Focal Point Homes dispute, property dispute w/ prior owner's family, title objection response, buyer default notice |
| **Employment law** (employer-side) | ~5 | ~2% | ONE RESIDENTIAL EMPLOYMENT, offer-letter compliance, employment letter for Oriana Victor |
| **Land use / misc.** (easements, sewer tie-in, permits) | ~5 | ~2% | Shane Flynn conservation easement, sanitary sewer easement, retroactive permit |

**The shape:** two anchor practice areas (T&E ~23%, title/settlement ~19%) together ~42% of all threads; a transactional-RE middle (residential + commercial + seller-financing + entity/M&A) ~36%; and a long tail of 1031, employment, disputes, land use. **Firm ops/practice management (~15%) is the third-largest slice and is not a practice area at all** — it is Kelly running three offices through the same tool he uses for legal work. That is a product-identity fact (see alignment §e).

### By project character (self-confirming)

- **law firm (98)** — T&E-dominant with entity/M&A and firm-ops: the "Satterwhite Law Firm" legal-work-product project. Highest volume, most drafting.
- **Real Estate General (71)** — transactional RE, commercial leasing, seller-financing, 1031, and the platform-meta threads: the "peer real-estate attorney" project.
- **Title (65)** — title exam, settlement, curative, and title-company operations: the "Universal Title senior managing attorney" project.

The three projects map cleanly onto Kelly's three institutional hats (law firm / real-estate counsel / title-company managing attorney), each with its own system prompt and memory. **The account is already organized the way the product should be: by capacity/hat, not by document type.**

---

## (b) Recurring-move taxonomy (ranked by frequency; corpus counting rules)

Counting by matter/workflow episode per R1, using the frequency labels from R2 (CORE PATTERN = 5+ matters AND 3+ practice areas; PATTERN = 3–4 matters; RECURRING = 2 matters; SINGLETON = 1). Every move below is evidenced across the deep-read set; the practice areas contributing are enumerated per R4. These are the moves that recur often enough to be *product architecture*, not matter-specific behavior.

1. **Operator disposition of model output** — adopt / modify / reject / hold / pass, per-point, "implement all" batch. **CORE PATTERN** (every multi-round thread; all practice areas). The single most-used surface in the corpus. *(trace rows 6, 14, 27, 32, 69)*
2. **Verify-before-assert citation discipline** — refuse to cite from memory; verify against primary source; drop unverifiable cites; self-caught citation errors halt the build. **CORE PATTERN** (title, T&E, 1031, lending, commercial). *(rows 1, 7, 15, 45, 55, 66)*
3. **Unverified-fact-as-provisional-state** — dual-token unknown names, bracketed confirms, "facts I did not guess," refuse-to-memorialize, negative-search honesty. **CORE PATTERN** (title, T&E, RE, lending). *(rows 25, 45, 48, 70; pass-2 synthesis)*
4. **Document / package review and issue-spotting before drafting** — triage an uploaded set, flag blockers/defects/missing instruments, rank by severity. **CORE PATTERN** (title exam, lending packages, commercial, PSA audit). *(rows 19, 33, 49, 70)*
5. **Multi-model review + synthesis** — carry another model's review in, verify its claims, synthesize, disposition per point; reject reviewer authority claims that fail verification. **CORE PATTERN** (title, commercial, 1031, seller-financing, config). *(rows 3, 15, 38, 57, 60, 70)*
6. **Audience-specific output from one analysis** — internal memo vs. client letter vs. counsel letter vs. lender/engineering/agent, capacity-aware, no-advice framing where required. **CORE PATTERN** (all areas). *(rows 4, 12, 16, 21, 70, 71)*
7. **Capacity / hat discipline** — title-agent neutrality vs. law-firm advice vs. outside-GC posture, held without being retold; jurisdiction-lead. **CORE PATTERN** (title, RE, T&E, GC). *(rows 2, 10; the three project prompts)*
8. **Refuse-the-impermissible, deliver-the-lawful-equivalent** — RPC ceilings (1.8(h)), statutory-role impossibility (brain-death determination), illegal instruction from default OR client. **PATTERN→CORE** (T&E ×3, GC, title). *(rows 31, 53, 69)*
9. **Correspondence drafting with tone calibration** — firm↔soft dial, client-counseling that corrects wrong premises while keeping the client heard, protective warnings against self-damaging acts. **CORE PATTERN** (title, RE, commercial, disputes). *(rows 17, 58, 70, 71)*
10. **Suite / cross-document consistency** — defined terms, cross-references, entity-name/brand sweep across a document family; regeneration re-flags siblings. **PATTERN** (commercial ×2, seller-financing, entity). *(rows 14, 20, 50, 70)*
11. **Template / knowledge-base capture** — reusable instrument templates, per-PA master prompts, structured knowledge-capture interviews that gate rule activation, adopted-clause sync back to the library. **PATTERN** (T&E templates, 1031 capture, commercial loan templates, ops SOPs). *(rows 24, 35, 36, 65, 67)*
12. **Handoff / staleness reconciliation** — cross-check pasted context notes against primary evidence; live/uploaded docs outrank memory; the "thread got too big → generate a handoff note" ritual. **PATTERN** (commercial, T&E, config). *(rows 12, 28, 42, 70)*
13. **Computation as arbitration** — back-solve amortization/proceeds/per-diem/transfer tax; reject a proposed figure on the math; deadline computation with roll/no-roll rules. **PATTERN** (lending, settlement, 1031, commercial). *(rows 35, 45, 49, 59)*
14. **Attorney/self-interest and role-boundary scan** — flag the drafting attorney's own appearance in an instrument; record executor-vs-author provenance. **RECURRING** (seller-financing, 1031). *(rows 22, 37)*
15. **Cross-platform prompt maintenance** — parallel per-model prompt copies kept in sync by hand; per-model failure-mode engineering. **PATTERN** (platform-meta ×3–4). *(rows 10, 33, 57, 68)*

Moves 1–7 clear the CORE PATTERN bar decisively (5+ matters, 3+ practice areas, consistent across every deep read). This is the same saturation the prior sweep reported; the second sweep did not dislodge the ranking.

---

## (c) Workflow archetypes — the canonical thread shapes

Six archetypes cover ~90% of usage. Each is named with exemplar threads. This is the design-critical cut: **the platform must do the top archetypes exceptionally, the middle ones adequately, and should refuse to become primarily the ones lower down.**

**A1 — Draft-an-instrument-from-intake (~33% of threads; the plurality, not the majority).**
Questionnaire / transcript / template → structured instrument with open-items page, bracketed placeholders, drafter notes → feedback rounds → execution-ready copy. Exemplars: TSEEHAY estate plan, DAVID JONES note/DOT, VA RLT-from-questionnaire, GAFFNEY will, deed of gift. This is what people *assume* the tool is for. It is the largest single genre but a minority of the whole.

**A2 — Review-an-artifact-and-spot-issues (~21%).**
An existing document or **set** arrives (upload, connector, counterparty paper) → inventory, cross-document consistency, blocker/defect triage → cure menu. Often *precedes* or entirely *replaces* drafting. Exemplars: title exams, ERGUN 17-file Drive review, ENTERPRISE COURT executed-PSA audit, wraparound package review, handoff-note audit. **This archetype opens with an artifact to react to, not an instruction to generate.**

**A3 — Advisory / research memo (~12%).**
A doctrinal question (often the attorney's own paste-in research) → verified analysis → memo, with authority-weight tiering and honest-limitation surfacing. Exemplars: reverse-1031 transfer-tax, executor power of sale, FIRPTA substantial-presence, 1031 stepped-up basis, MIPAP.

**A4 — Correspondence in a specific voice (~15%).**
Facts → client / counsel / agent / lender email or letter, capacity-aware, tone-calibrated, often as variants and sometimes deadline-armed. Exemplars: anti-fraud letter, broker concession, client-counseling emails (ERGUN, Madigan), title-transfer letter, demand/objection letters. Frequently the *terminal deliverable* of an A1/A2/A3 thread.

**A5 — Firm operations & practice management (~15%).**
Not legal work: invoices, engagement letters as artifacts, formatting/branding, staff and training documents, SOP capture, marketing, status checks. Exemplars: AmLaw invoice generation, task-workflow guide, processor training plan, call scripts, formatting threads. **Kelly runs three offices through the same surface** — this is a real, sustained slice, not noise.

**A6 — Template & knowledge capture (~7%, high leverage).**
Build a reusable asset: instrument templates, per-PA master prompts, knowledge-capture interviews that gate rule activation, per-model prompt ports. Exemplars: VA RLT / mirror-will templates, commercial loan templates, 1031 knowledge capture, NotebookLM stack assembly, ChatGPT prompt port. Low frequency, disproportionate strategic weight — this is Kelly building the practice's durable infrastructure.

**Two structural facts across archetypes:** (i) **~40–45% of threads open with an artifact to react to (A2 + A4-in-reply + A3 paste-in), not a blank-page instruction to draft.** (ii) **Every multi-round thread contains at least one operator correction of the model** — the disposition surface (move 1) is universal.

---

## (d) What Kelly does that no current spec covers

Drawn from the deep reads; each is a candidate scope item, evidence-strength labeled (R5), mapping-not-prioritization (R11).

1. **Firm-operations surface (A5).** ~15% of usage is invoices, staff letters, training, SOPs, formatting, status checks — none of it in the 6-layer architecture, which is entirely matter-centric. **STRONG** (34 threads, every project). The platform silently assumes all work is matter work; it isn't.
2. **Live-connector matter materials at scale.** ERGUN pulled a 17-file Google Drive folder and reviewed it; the NotebookLM thread is Kelly trying to wire Drive as the shared document layer. Matter-State grounding from a live connector, not paste-in. **MODERATE** (2 deep threads, but both explicit and load-bearing).
3. **Context-window overflow as the driver of the handoff ritual.** ERGUN: "the other thread got too big, and I couldn't generate a context note." The manual matter-state hand-roll is caused by a hard technical limit, not preference. **MODERATE→STRONG** (named in situ; the Matter-State Engine's whole value proposition).
4. **Authority-weight tiering** (published opinion > advice memo > secondary source) as an output distinct from verified/unverified. **THIN** (1 deep thread, reverse-1031) — but a clean refinement to source-of-truth tiering.
5. **Client-counseling that protects the client from a self-damaging instruction.** ERGUN (default-and-evict → wrongful-eviction exposure); Madigan (impossible family-determination). Distinct from business-decision separation: the model actively talks the *principal* down. **PATTERN** (2+ matters).
6. **Task-appropriate model routing by the operator.** Sonnet 4.6 Low for routine correspondence; Opus 4.8 for the hard commercial-lease analysis; model upgrades mid-matter. Kelly already routes by task difficulty — the Dispatch layer should own this. **MODERATE**.
7. **Deadline computation as a recurring sub-skill across practice areas** — 1031 (roll/no-roll), probate (4/16-month clocks), employment (final-wage timing, SB 170), adversarial (cure/termination windows), commercial (business-day rolls). **STRONG** (5+ areas) — the deadlines engine has broad, cross-area demand, not just 1031.

---

## (e) Failure-mode census (every model error observed, who caught it, which mechanism would have)

| Failure mode | Exemplar | Who caught it | Platform mechanism that addresses it |
|---|---|---|---|
| **Confident wrongness from asymmetric inputs** — alleged a peer model hallucinated when it had simply seen the full record | AMMANN title exam (row 38) | Kelly (supplied the PDFs) | Input-parity manifest per lane (Multi-Model Dispatch); arbiter cites what it checked |
| **Wrong-section citation** (neighboring but wrong statute) | reverse-1031 (row 66); David Jones (row 45) | Reviewer / Kelly, then self-verified against primary text | Research lane: cite greens only against a captured snapshot |
| **Overlay / comparison artifact read as operative text** → phantom findings | WIOS Litera overlay (row 62) | Self-caught on verification | Comparison artifacts typed as VIEWS, never ingested as operative text |
| **Regeneration corruption / rejected terms resurfacing across versions** | CDT/Xtreme v6 (row 48); ENTERPRISE COURT (row 49) | External reviewer | Cross-version diffing + "rejected-term must not reappear" lock |
| **Suite non-conformance after a mid-stream fact change** | Adjahoe (row 50); ERGUN (row 70) | External reviewer (twice) | Suite object: a change re-flags siblings until conformant |
| **Stale / erroneous handoff note relied upon** | LOGUE 2 (row 42); ERGUN handoff (row 70) | Self, cross-checking primary docs | Matter-State Engine replaces the note; imported context reconciles against source |
| **Render-environment bug** (page-number field, orphaned placeholder) | GAFFNEY (row 53); Madigan (row 69) | Self / Kelly | Render-test gate in the client's actual renderer |
| **Self-caught substantive legal error mid-build, halted** | Wraparound Reg Z inversion (row 55); reverse-1031 cite (row 66) | Self, via primary-source check | Verify-verb + honest-halt protocol (the desired behavior, working) |
| **Client-supplied AI drafts that are affirmatively dangerous** | Poteet (row 64) | Self, flagged as hazard | Materials origin-type = client-supplied-AI, triaged with suspicion |
| **Pipeline / generation environment down** | Cairn (row 34); Madigan (row 69) | Self, degraded gracefully | Graceful-degradation protocol (working) |

**Pattern in the failure census:** the model *self-caught* the substantive errors (Reg Z, overlay phantom, cite verification) when a verification step existed, but the **cross-version / suite-conformance / stale-input failures were caught by external reviewers or Kelly, not the generator.** That is the sharpest evidence-based prioritization signal in the corpus: the platform's highest-value guardrails are the ones covering the failures the generator *cannot catch about itself* — cross-version diffing, suite conformance, and input-parity — because those are exactly where a second reviewer, not self-verification, did the catching.

---

*Counts are corpus observations under R10 ("in this corpus"), title-inferred at MODERATE precision and STRONG rank-order, traceable to the named threads in `ACCOUNT_CENSUS_RAW_2026-07.md` and the 71-row trace. No count is asserted as a controlled measurement.*
