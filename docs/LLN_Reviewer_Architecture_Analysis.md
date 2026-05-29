# LLN Reviewer Architecture Analysis

**Phase 0 Inventory · Phase 1 Master Prompt Audit · Phase 2 Corpus Cross-Read · Phase 3 LLN Delta · Phase 4 Severity Reconciliation · Phase 9 Gap Inventory**

Author: Claude (Anthropic) for Kelly Satterwhite

---

## v1.2 UPDATE BANNER (read first)

This document was initially produced for the v1.0 prompt run on May 26, 2026. A v1.2 prompt run on the same date introduced non-negotiable architectural principles that materially change the Phase 5 design. The body of this document below is preserved unchanged so the audit trail is intact, but readers should be aware of the following supersessions:

**v1.0 design choices retracted by v1.2:**

1. **Model specialization removed.** v1.0 hard-routed Grok to research-validator only, Gemini to second-opinion / structural cross-check only, Claude to evaluator + drafter, and GPT to primary reviewer. v1.2 architectural principles require capability symmetry across all four reviewer tracks. All four models must support the full reviewer function. Historical usage patterns (NLF-2 Grok-as-research-validator) become routing-hint defaults surfaced in LLN UI, not capability constraints in the architecture.

2. **Lite/Full equivalence.** v1.0 scoped reviewer prompt specifications to Lite tracks only. v1.2 specifies that Lite and Full versions of each track share the same reviewer prompt. Differences are tier choices the attorney makes (speed vs. depth), not capability differences.

3. **Construction tuning ≠ capability tuning.** Each model's reviewer prompt is tuned to its construction conventions to elicit best output (Claude XML; GPT bullets-and-headers; Grok markdown; Gemini per its conventions). All four prompts instruct equivalent functional behavior.

4. **Routing hints, not hard routes.** v1.2 §5e requires routing recommendations to be defaults with attorney override, never architectural constraints that lock a model out of a role.

5. **Future-proofing for new model generations.** New model releases must be addable to LLN without architectural change. Capability ceilings in current-generation models are reported, not designed around.

6. **No automatic incorporation of feedback.** v1.2 explicitly bans auto-incorporation except for pre-authorized mechanical formatting in formatting-only mode.

7. **Legal-review vs formatting-only mode distinction.** LLN's Upload & Format workflow is structurally distinct from drafting/review. Reviewer prompts must accept a mode parameter.

**Where to find current architecture:**

- **Phase 5 spec (build-ready):** `LLN_Reviewer_Prompt_Specifications.docx` (v1.2) — this is the authoritative current architecture. Replaces all Phase 5 narrative in the body of this md.
- **Phase 8 test plan (v1.2):** `LLN_Reviewer_Calibration_Test_Plan.docx` — 4-model × 12-test grid framing.
- **Phase 6 prompt updates (v1.2):** `Manual_Workflow_Prompt_Updates_v3.docx` — includes Grok practice-area variants per v1.2 (v1.0 recommendation to skip Grok variants is retracted).
- **Phase 7 taxonomies (v1.2):** `Reference_Taxonomies_v1_3_Proposal.docx` — Reviewer Role axis now functional, not model-locked.

**What in this md is still accurate:**

- Phase 0 inventory (unchanged)
- Phase 1 INDIRECT audit findings — seven missing rules cross-prompt comparison (unchanged)
- Phase 2 corpus cross-read of T-0120 and T-CG-0070 (unchanged)
- Phase 3 LLN-output capture plan (unchanged in substance; stratified sample now should cover Lite AND Full per v1.2)
- Phase 4 severity taxonomy reconciliation (unchanged)
- Phase 9 gap inventory (mostly accurate; reorder priorities per v1.2 below)

**v1.2 Phase 9 priority adjustments:**

1. Master prompt direct audit (replace INDIRECT) — unchanged top priority
2. LLN Lite AND Full output capture per stratified sample — Full was not in v1.0 priority; added per v1.2 Lite/Full equivalence requirement
3. Gemini sweep — elevated; Gemini outputs absent from ledger, but per v1.2 Gemini must support full reviewer function so corpus capture is necessary to inform tuning
4. Grok practice-area variant drafting — new priority; v1.0 recommended skipping, v1.2 requires
5. Test bench live run against four-track grid — new priority per v1.2 test plan structure
6. D6 cross-model disagreement, D5 persistence semantics, D1 high-utility language clustering — unchanged

---
Run: LLN Reviewer Tuning v1.0 · May 26, 2026
Companion deliverables: LLN_Reviewer_Prompt_Specifications.docx (Phase 5); LLN_Reviewer_Calibration_Test_Plan.docx (Phase 8); Manual_Workflow_Prompt_Updates_v3.docx (Phase 6); Reference_Taxonomies_v1_3_Proposal.docx (Phase 7)

---

## Bottom line

The corpus and Phase 2 synthesis are strong enough to specify Phase 5 (LLN reviewer prompt specs) with build-ready confidence on Real Estate / Title / T&E and with calibrated caveats elsewhere. Phase 1 (master prompt structural audit) and Phase 3 (LLN reviewer Lite output delta) cannot run with verified-direct evidence because (a) the master prompt files are not in project knowledge, and (b) no LLN Lite outputs have been captured. Both run as INDIRECT — derived from the v1.0 prompt's own descriptions of those prompts and from the existing corpus-side evidence of what manual workflow patterns LLN should reproduce. The Phase 0 gate did not trip (ledger + Phase 2 outputs are present), so the analytical run proceeded.

Headline analytical takeaway: the seven missing rules identified in the v1.0 prompt (execution-blanks suppression; substantive-vs-tone; drafting-vs-business; matter-memory awareness; persistence counter; cross-model defect complementarity; cumulative state carry-forward) are corpus-evidenced as high-utility behaviors that current master prompts under-encode. Phase 5 bakes all seven into the cross-track template as explicit sections. Phase 6 proposes adding the same seven into Master Instructions v2.1 → v3, GROK v1.2 → v1.3, and the practice-area prompts.

Headline product takeaway: LLN reviewer architecture should be **role-specialized**, not uniform. The corpus shows Grok playing research-validator exclusively (zero reviewer-cycle evidence across 853 conversations); Claude playing evaluator-of-other-reviewers + drafter; ChatGPT playing primary document reviewer; Gemini playing structural-cross-checker with Senior Counsel persona. A "four equal reviewers" LLN architecture would degrade against Kelly's actual workflow. The Phase 5 spec encodes role specialization with cross-track defect complementarity.

---

## Phase 0 — Inventory and Gate Status

### Inventory classification

**Present:**

- Phase 2 synthesis outputs: `executive_synthesis_for_product_design.docx`; `corpus_survey_comparison_appendix.docx`
- Phase 3 coverage reports: `coverage_report.docx` (Claude.ai); `coverage_report_chatgpt.docx`
- Run logs: `00_run_log_md.docx`, `00_run_log_md__1_.docx`, `00_run_log_md__2_.docx`
- Three-platform ledger (filenames; data not directly viewable in chat context but inventoried in synthesis): `feedback_instances.xlsx` + `_1`, `_2`, `.ods`; `chatgpt_thread_inventory.xlsx`; `grok_thread_inventory.xlsx`
- Two deep matter reports (full text):
  - `T-0120_Revocable_trust_document_drafting_Dubin_md.docx` — RLT drafting (4 cycles; Feedback Evaluation Protocol exemplar)
  - `T-CG-0070_ADAM_WHITE_LAKE_HOUSE_SALE_md.docx` — Lake-property seller financing (10 intra-platform iteration cycles; cross-platform companion to Claude T-0002)
- Prior prompts: `Prompt_1B_ChatGPT_Browser_Sweep_Cowork.docx`; `Prompt_1C_Grok_Corpus_Extraction.docx`; `Prompt_2_Post_Sweep_Analytical_Run_v3.docx`; `Prompt_2_Post_Sweep_Analytical_Run_v4.docx`

**Absent (material to this run):**

- All twelve named master prompts: Master Instructions v2.1; GROK v1.2; CLAUDE_TITLE_PROMPT_5-21-26; CLAUDE_REAL_ESTATE_MASTER_PROMPT; GPT_TITLE; GPT_REAL_ESTATE; GPT_TRUSTS_AND_ESTATES; GEMINI_REAL_ESTATE_GENERAL; GEMINI_LAW_FIRM_GENERAL
- LLN reviewer Lite captured outputs (GPT / Grok / Claude / Gemini Lite)
- LLN architecture / product documentation
- Per-matter extraction reports for the matters the v1.0 prompt names as analytical anchors (Logue, Levin Feinberg, 9208 Enterprise Court PSA, Maryland Twisters, Wios, Zara Ayano, Edgelea, Calvert BB2). These appear in `coverage_report.docx` matter inventory and in Prompt 2 v4 Rule 9 as illustrative anchors, but the standalone per-matter Cowork extraction reports are not in project knowledge readable to this run.

**Indirect (derivable from project knowledge):**

- Reference Taxonomies v1.2.1 — referenced throughout Phase 2 outputs; the vocabulary is reconstructible from cited usage but the canonical document is not directly viewable. The v1.0 prompt names the same vocabulary, so usage is consistent.

### Gate result

The v1.0 prompt's Phase 0 gate trips if master prompts AND ledger AND Phase 2 outputs are ALL absent. Ledger and Phase 2 outputs are present → gate does not trip → run proceeds.

Scope notes the v1.0 prompt explicitly authorizes:
- Matter reports IN SCOPE as substantive cross-read input (Phase 2).
- If LLN reviewer outputs are absent, proceed but note Comparison Axis 3 cannot run fully. **Done.** Phase 3 is delivered as an LLN-output capture plan rather than a verified delta.

Scope note this run adds (not in the v1.0 prompt):
- Master prompts are absent. Phase 1 structural audit columns ("Has §6? Has §18? Has Severity Taxonomy?") presuppose direct read of those prompts. Two options: (a) defer Phase 1 entirely; (b) run Phase 1 as INDIRECT analysis using the v1.0 prompt's own description of each prompt's contents as paraphrase-evidence about what the prompts say. Option (b) is chosen because Kelly authored both the master prompts and the v1.0 prompt; the prompt's descriptions are likely high-fidelity paraphrase. All Phase 1 findings are labeled INDIRECT.

### Recursive-critique provenance flag

The Phase 2 outputs (`executive_synthesis_for_product_design.docx`; `corpus_survey_comparison_appendix.docx`) were shaped by multiple rounds of ChatGPT critique on prior prompts (Prompt 2 v3 → v4 evolution; ChatGPT participated in critique). Treat ChatGPT-sourced material in those documents with awareness of anchoring effects. The deep matter reports (T-0120; T-CG-0070) are Cowork (Claude) products with their own model-inferred caveats acknowledged in the reports themselves.

---

## Phase 1 — Master Prompt Structural Audit (INDIRECT)

### Method

Because the master prompt files are absent, Phase 1 runs as paraphrase-based inference. The v1.0 prompt's "Master Prompt Inventory (input #1)" section names each prompt and identifies key sections (e.g., "Master Instructions v2.1 (Claude, comprehensive — 18 sections including §6 Feedback Evaluation Protocol, §11 Firm Entity Routing, §18 Output Preferences)"; "Master Instructions GROK v1.2 (Grok, 15 sections; §6 includes stronger pushback rule)"). Phase 1 treats these descriptions as paraphrase-evidence about what each prompt contains and absent. All findings are INDIRECT.

When Kelly uploads the actual prompt files, Phase 1 should be re-run against the files. Current findings establish what to look for and what the seven-missing-rules audit predicts.

### Audit summary table (INDIRECT)

| Prompt | Platform | Practice Area | §6 Eval Protocol? | §18 Regen Rule? | Severity Taxonomy? | Severity Categories | Jurisdiction Anchor? | Zero-Hallucination Rule? | Source Hierarchy? | Escalation Triggers? | Audience Discipline? | Entity Routing? | Output Format Specified? | Construction Quality |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Master Instructions v2.1 | Claude | Cross-cutting | YES (§6) | YES (§18) | YES (§5C) | Critical / Major / Moderate | partial | partial | partial | partial | partial | YES (§11) | YES (§18) | HIGH |
| Master Instructions GROK v1.2 | Grok | Cross-cutting | YES (§6) with stronger §6.4 pushback | likely partial | YES (§5C) | Critical / Major / Moderate | partial | partial | partial | partial | partial | unclear | partial | HIGH |
| CLAUDE_TITLE_PROMPT_5-21-26 | Claude | Title | inherits from Master | inherits | inherits | inherits | YES (XML-style sections) | inherits | inherits | inherits | inherits | inherits | YES | HIGH |
| CLAUDE_REAL_ESTATE_MASTER_PROMPT | Claude | Real Estate | inherits | inherits | inherits | inherits | partial | inherits | inherits | inherits | inherits | inherits | partial | MEDIUM |
| GPT_TITLE_PROMPT | ChatGPT | Title | N/A (reviewer side, not evaluator) | N/A | not specified | none | partial | partial | partial | partial | partial | unclear | partial | MEDIUM |
| GPT_REAL_ESTATE_PROMPT | ChatGPT | Real Estate | N/A | N/A | not specified | none | partial | partial | partial | partial | partial | unclear | partial | MEDIUM |
| GPT_TRUSTS_AND_ESTATES_PROMPT | ChatGPT | T&E | N/A | N/A | YES (§9) | Critical / Improvements / Optional | partial | partial | partial | partial | partial | unclear | YES (§9 modes) | MEDIUM-HIGH |
| GEMINI_REAL_ESTATE_GENERAL_PROMPT | Gemini | Real Estate | N/A | N/A | unclear | none specified | partial | partial | partial | partial | partial | unclear | partial | LOW-MEDIUM |
| GEMINI_LAW_FIRM_GENERAL_PROMPT | Gemini | General | N/A | N/A | unclear | none specified | partial | partial | partial | partial | partial | unclear | partial | LOW-MEDIUM |

"inherits" = inherits from cross-cutting Master Instructions; "partial" = present but not corpus-evidenced as rigorously specified; "unclear" = INDIRECT evidence base does not establish.

### Seven missing rules — cross-prompt comparison (INDIRECT)

| Rule | Master v2.1 | GROK v1.2 | CLAUDE_TITLE | CLAUDE_RE | GPT_TITLE | GPT_RE | GPT_T&E | GEMINI_RE | GEMINI_GEN |
|---|---|---|---|---|---|---|---|---|---|
| 1. Execution-blanks suppression | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 2. Substantive-vs-tone classification | ABSENT | partial (via §6.4 pushback) | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 3. Drafting-decision vs. business-decision separation | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 4. Matter-memory awareness (don't flag locked decisions) | partial (Feedback Eval Protocol assumes context) | partial | partial | partial | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 5. Reviewer-persistence counter (rejection-then-re-raise) | partial (Eval Protocol handles ad hoc) | partial | partial | partial | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 6. Cross-model defect complementarity acknowledgment | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| 7. Cumulative state carry-forward across iterations | partial (§18 regen) | partial | partial | partial | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |

Note: "partial" here means the corpus shows the behavior emerging in Claude's evaluator-side practice (T-0120 exemplifies all seven on the evaluator side), but the rule is not encoded as an explicit prompt section. The corpus evidence + the v1.0 prompt's own audit converge on the same conclusion: these seven rules are corpus-evidenced as high-utility behaviors that the master prompts do not explicitly require.

### Strongest sections (HIGH-utility prompt content; preserve and replicate)

- Master Instructions v2.1 §6 Feedback Evaluation Protocol — corpus-evidenced as the highest-utility prompt section across all matters with reviewer cycles. Per-item Adopt/Modify/Pass with rationale is the canonical disposition vocabulary.
- Master Instructions v2.1 §18 Regenerate-not-piecemeal — corpus-evidenced via T-0120 v1 → v2 regeneration after attorney directive; T-CG-0070 v1 through v6 FINAL regeneration discipline.
- Master Instructions GROK v1.2 §6.4 stronger pushback rule — corpus-evidenced via T-0120 Round 1 Gemini perpetuities pushback ("Gemini is wrong here") and Round 2 Trust Protector persistence rejection.
- CLAUDE_TITLE_PROMPT_5-21-26 XML-style sectioning — corpus-evidenced as the structural template that produces the most consistent reviewer-side output format. Used as the structural template for Phase 5 cross-track template.
- GPT_TRUSTS_AND_ESTATES §9 Document Review Mode — first severity taxonomy outside cross-cutting Masters; Critical / Improvements / Optional is a real attempt but mis-calibrated (the Improvements / Optional split confuses SUBSTANTIVE-DRAFTING with PRECISION).

### Weakest sections (LOW-utility or absent patterns producing known failure modes)

- ALL master prompts: no explicit execution-blanks suppression rule. Corpus negative evidence: reviewer feedback flagging signature-line blanks consumes attorney triage capacity for zero return.
- ALL master prompts: no substantive-vs-tone classification rule. Corpus negative evidence: T-CG-0070 Msg 21 type events (Grayson softening) without explicit substance-affecting flag risk silent dilution of substantively correct positions.
- ALL master prompts: no drafting-vs-business separation rule. Corpus negative evidence: Path-A/Path-B framing in T-CG-0070 came from ChatGPT's emergent practice, not from prompt instruction; could degrade with prompt drift.
- GPT prompts (TITLE, RE, T&E): no zero-hallucination rule explicitly enforced; no source hierarchy; no escalation triggers explicitly defined.
- Gemini prompts: corpus-evidenced citation errors (T-0120 perpetuities) suggest jurisdiction discipline + citation verification are under-encoded.
- ALL master prompts: no cross-model defect complementarity acknowledgment. Each prompt is single-platform; none acknowledges that the platform has known failure modes that other platforms address.

---

## Phase 2 — Corpus Cross-Read: What the Prompts Actually Produced

### Method

Per the v1.0 prompt's Phase 2 directive, audit each substantive reviewer cycle in the corpus for delta against the master prompt that produced it. Source data: two full extraction reports (T-0120 Dubin; T-CG-0070 Adam White), plus secondary references to other matters via `coverage_report.docx` matter inventory and `executive_synthesis_for_product_design.docx`. The v1.0 prompt names "Logue 4 cycles; 9208 Enterprise Court PSA 12 cycles; Levin Feinberg 3 cycles; Adam Seller Financing 2 cycles; Maryland Twisters; Wios; Zara Ayano; Edgelea; Calvert BB2; others" — only T-0120 (4 cycles) and T-CG-0070 (10 cycles) have full per-cycle data in project knowledge. The other matters are referenced but not directly auditable in this run.

### Cycle-by-cycle audit

#### T-0120 Dubin RLT — Round 1 (Gemini + Reviewer 2 inferred GPT-4)

- **Reviewer source:** Gemini (stated; Senior Counsel persona) + Reviewer 2 (inferred GPT-4)
- **Source-likely master prompt:** GEMINI_REAL_ESTATE_GENERAL (closest available; T&E variant not specified)
- **Output format match:** YES for Gemini (enumerated, prioritized critique); partial for Reviewer 2 (less structured)
- **High-utility behaviors observed:**
  - Severity discipline (implicit; not explicit labels)
  - Jurisdiction anchoring (Va. Code § 64.2-799(b); USRAP)
  - Critique-of-critique (Claude pushed back on Gemini perpetuities cite)
  - Disposition vocabulary (Adopt/Modify/Pass with rationale)
- **Behaviors prompt required but output lacked:**
  - Citation verification — Gemini produced wrong perpetuities citation (§ 55.1-125 wrong; USRAP correct). The Gemini RE General prompt presumably did not require citation verification.
  - Severity labels — neither reviewer used explicit severity tiers
- **Behaviors emergent (not prompted):**
  - Multi-reviewer consolidation by Claude (merged Spouse-side overlap; Middle name overlap)
  - Persistence detection (Trust Protector reached count 2 in Round 2)
- **Failure modes observed:**
  - Reviewer flagged locked-decision item (Trust Protector in Round 2 — matter-memory false positive)
  - Wrong-citation produced (Gemini perpetuities) — substantively wrong feedback type

#### T-0120 Dubin RLT — Round 2 (Reviewer 2 second pass)

- **Reviewer source:** Reviewer 2 (inferred GPT-4; identity inferred-MED)
- **Output format match:** partial
- **High-utility behaviors observed:**
  - Internal-consistency observation (new in Round 2: IV(B)(2)(b) / IV(B)(3) collapse-then-charity tension)
- **Behaviors prompt required but output lacked:**
  - Acknowledgment of Round 1 disposition (locked decision on Trust Protector)
  - Persistence count
- **Failure modes:**
  - Stale persistence (Trust Protector re-raised without acknowledgment of attorney election + new Conflict Waiver artifact)
  - Reviewer ignored prior-cycle dispositions

#### T-CG-0070 Adam White — Rounds 1-9 (intra-platform ChatGPT iteration on memo + addendum)

- **Reviewer source:** ChatGPT (inferred GPT-5; identity inferred-MED throughout)
- **Source-likely master prompt:** GPT_REAL_ESTATE_PROMPT (matter is residential RE with seller-financing; loaded under ChatGPT Real Estate Law project)
- **Output format match:** partial (response content not fully retrieved due to context budget per the extraction report; format presumed substantive prose review)
- **High-utility behaviors observed:**
  - Iterative drafting tracker discipline (v1 → v2 → v3 → v4 → v6 FINAL on client memo; v1 → v2 → v3 on addendum)
  - Path-A/Path-B option structuring (recourse with senior-debt cap vs. non-recourse) — corpus exemplar of drafting-vs-business separation done well
  - "Review and provide feedback" as the standard iterative-drafting prompt
- **Behaviors prompt required but output lacked:**
  - Explicit severity labels (none used)
  - Explicit drafting-vs-business classification (Path-A/Path-B emerged organically, not from prompt instruction)

#### T-CG-0070 Adam White — Round 10 (critique-of-drafting on Grayson agent-commission language)

- **Reviewer source:** ChatGPT
- **High-utility behaviors observed:**
  - Substance-affecting tone recommendation surfaced with explicit rationale ("I would not put it that bluntly in writing" — relationship-risk flag)
- **Behaviors prompt required but output lacked:**
  - Explicit TONE-ONLY vs. SUBSTANCE-AFFECTING classification (the recommendation softens substantively-correct record-creating language)
  - Audience-split option (preserve in internal file note; soften in client memo) — third option that Kelly's actual workflow produces but reviewer prompts do not require
- **Failure modes:**
  - Potential silent over-softening of substantively correct position (mitigated by Kelly's actual workflow but not by prompt)

### Other matters (referenced; not directly auditable in this run)

The following matters appear in `coverage_report.docx` matter inventory and in Phase 2 synthesis, but per-cycle audit data is not in project knowledge:

- **Logue** (18 threads): largest matter cluster in the corpus by thread count. Per v1.0 prompt §16, illustrates MM-5 matter-memory awareness pattern. Audit deferred until per-matter extraction report is available.
- **Levin Feinberg** (2 threads; named in coverage_report.docx + v1.0 prompt §16): Patterns A (cross-model defect complementarity), D (reviewer-persistence counter), E (drafting-vs-business separation), F (cumulative state carry-forward). Audit deferred.
- **9208 Enterprise Court PSA** (12 cycles per v1.0 prompt): 1 thread per coverage_report.docx matter inventory. Audit deferred.
- **Maryland Twisters** (5 threads), **Wios / Walney** (6 threads), **Zara Ayano** (7 threads), **Edgelea** (2 threads), **Calvert** (2 threads): audit deferred.

### Behavior-frequency-by-platform (partial)

From the two auditable matters + Phase 2 synthesis + coverage report stated-source data (Gemini 50; ChatGPT 38; NotebookLM 10; Grok 1 stated as reviewer in Claude corpus):

| Behavior | Manual Workflow Frequency (auditable) | Notes |
|---|---|---|
| Severity discipline (explicit labels) | LOW across platforms — emergent in Claude evaluator, absent in reviewer-side outputs | Phase 5 fix: require explicit severity in feedback card schema |
| Drafting-vs-business separation | MEDIUM in ChatGPT (Path-A/Path-B); LOW elsewhere | Phase 5 fix: explicit §1.7 in cross-track template + severity_subtype field |
| Substance-vs-tone classification | LOW across all platforms (emergent in ChatGPT T-CG-0070 Msg 21 but not labeled) | Phase 5 fix: explicit §1.6 + classification mandatory when softening is recommended |
| Matter-memory awareness | MEDIUM in Claude evaluator (T-0120 closures); LOW in reviewers | Phase 5 fix: matter_memory context block + suppression rules |
| Persistence count | MEDIUM in Claude evaluator (T-0120 "two independent ways"); LOW in reviewers | Phase 5 fix: persistence_count + persistence_chain fields; explicit §1.9 |
| Citation verification | LOW in Gemini (T-0120 perpetuities wrong); MEDIUM in Claude (Claude caught Gemini) | Phase 5 fix: §1.3 jurisdiction discipline + Gemini-track specific tuning |
| Cumulative state carry-forward | MEDIUM in Claude drafter (T-0120 v1→v2 + Conflict Waiver + engagement letter package) | Phase 5 fix: §3.3 drafter-side carry-forward enforcement |
| Output format consistency | HIGH in Gemini (Senior Counsel enumerated); MEDIUM in ChatGPT (substantive prose, not always structured); HIGH in Claude evaluator (disposition tables) | Phase 5 fix: §1.12 mandatory output format with memo + structured cards |

---

## Phase 3 — LLN Reviewer Lite Output Audit

### Status: LLN reviewer Lite outputs ABSENT

No captured LLN Lite outputs in project knowledge. Comparison Axis 3 (corpus-to-LLN delta) cannot run. Phase 3 is delivered as a capture plan.

### LLN-Output Capture Plan

The minimum test set needed to complete the corpus-to-LLN delta:

**Document types to capture (priority order based on corpus coverage):**

1. Residential PSA + addendum (Real Estate / Title; STRONG corpus coverage)
2. Revocable Living Trust + Conflict Waiver + engagement letter package (T&E; STRONG corpus coverage)
3. Commercial lease (Wios / Walney corpus cluster; MODERATE)
4. Title commitment review (Title; STRONG corpus coverage)
5. Loan commitment / mortgage / note package (RE financing; MODERATE)
6. Deed (Real Estate / Title; STRONG)
7. SaaS TOS (T-GR-0250 cluster; PATTERN)
8. Engagement letter (cross-cutting; STRONG)

**Reviewer tracks to exercise (all four; per the §5.3 routing logic in Phase 5 spec):**

- GPT Lite as primary reviewer
- Claude Lite as evaluator (after at least one GPT Lite + Gemini Lite output)
- Gemini Lite as structural cross-checker
- Grok Lite as current-law validator (invoked on demand)

**Per-cycle expected inputs:**

- Document or document package
- Matter memory block (locked decisions; prior dispositions; current source-of-truth tier; bracketed-fact open items; audience-scope flags)
- Cycle context (prior reviewer cards if this is Round 2+; attorney directive if any)
- Practice area + matter type + jurisdiction tags
- Reviewer track selection (per §5.2 routing decision tree)

**Per-cycle expected outputs (scoring criteria):**

For each captured output, score against Phase 2 high-utility behavior checklist:

| Scoring criterion | Pass condition | Source-evidence |
|---|---|---|
| Output format matches §1.12 of Phase 5 spec | Memo + structured cards both present; memo has Jurisdiction / Bottom line / Executive Feedback / Doc-by-doc / Final Assessment sections | Phase 5 §1.12 |
| Severity labels per §0 unified taxonomy | Every card has severity ∈ {BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH}; SUBSTANTIVE has severity_subtype | Phase 5 §0 + §6 |
| Execution-blanks suppression | Routine blanks emit cards with suppress_by_default=true and routine_blank_flag=true | Phase 5 §1.5 + example 1 |
| Substance-vs-tone classification | Softening recommendations include explicit TONE-ONLY vs. SUBSTANCE-AFFECTING flag | Phase 5 §1.6 |
| Drafting-vs-business separation | SUBSTANTIVE items have severity_subtype set; BUSINESS items surface options instead of recommendation | Phase 5 §1.7 + §6 schema |
| Matter-memory awareness | Locked-decision items emit cards with persistence_count > 0 if present + ALREADY_ADDRESSED disposition_options | Phase 5 §1.8 + example 4 |
| Persistence counter | Re-raised items have persistence_count and persistence_chain populated | Phase 5 §1.9 + §6 schema |
| Cross-model defect complementarity | Where applicable, complementarity_recommendation field populated | Phase 5 §1.10 + §6 schema |
| Cumulative state carry-forward (drafter side) | Regenerated draft preserves prior-cycle adopts; redline shows only intended new changes | Phase 5 §3.3 |
| Citation discipline | Statute citations include source basis; INFERRED CITATION label when unverified | Phase 5 §1.3 |
| Audience routing | audience_affected field populated; PRESERVE_INTERNALLY items not in client/counterparty drafts | Phase 5 §1.6 + §6 schema |
| Output discipline (no/over-flagging) | Card count proportional to document length; no flooding of trivial items; no missing of BLOCKERS | Phase 5 §1.4 |

**Sample size target:** Minimum stratified sample of 3 cycles per practice area × 4 tracks = 12 cycles per practice area. For Real Estate / T&E / Loan Docs at MODERATE-STRONG corpus coverage = ~36 captured cycles needed for verifiable delta.

**When capture is complete, Phase 3 corpus-to-LLN delta runs as:**

| Behavior | Manual Workflow Frequency | LLN Frequency | Delta | Likely Cause |
|---|---|---|---|---|
| (one row per scored criterion above) |

Likely cause candidates: missing prompt instruction (Phase 5 spec covers); missing practice-area routing (Phase 5 §5 covers); missing matter-memory context (Phase 5 §1.8 covers); missing severity taxonomy (Phase 5 §0 covers); missing post-processing (LLN architecture); model-platform inherent difference.

---

## Phase 4 — Severity Taxonomy Reconciliation

### Cross-walk of severity categories across master prompts and corpus

| Severity Term | Source Prompt | Definition (paraphrased; INDIRECT) | Equivalents |
|---|---|---|---|
| Critical | Claude Master v2.1 §5C; GROK v1.2 §5C; GPT_T&E §9 | Must-fix or document fails to function | maps to unified BLOCKER (severe end) + SUBSTANTIVE (lower end) |
| Major | Claude Master v2.1 §5C; GROK v1.2 §5C | Significant deficiency; should fix before sending | maps to unified SUBSTANTIVE-DRAFTING + STRUCTURAL |
| Moderate | Claude Master v2.1 §5C; GROK v1.2 §5C | Minor issue; polish | maps to unified PRECISION + POLISH |
| Improvements | GPT_T&E §9 | Recommended changes | maps to unified SUBSTANTIVE-DRAFTING + STRUCTURAL + PRECISION |
| Optional | GPT_T&E §9 | Polish / style | maps to unified POLISH |
| (no taxonomy) | GPT_TITLE, GPT_RE, GEMINI_RE, GEMINI_GEN, CLAUDE_TITLE, CLAUDE_RE | reviewer produces severity implicitly through prose framing | not crosswalked; treat as missing |

### Proposed unified taxonomy (full specification in Phase 5 spec §0)

Five tiers: BLOCKER / SUBSTANTIVE (with mandatory DRAFTING / BUSINESS sub-classification) / STRUCTURAL / PRECISION / POLISH.

Rationale for five tiers vs. three:

- Three-tier (Critical / Major / Moderate or Critical / Improvements / Optional) collapses BLOCKER into Critical and dilutes the sendability-gate signal. A reviewer that produces 8 "Critical" items in one cycle (some of which are sendability fails, some of which are substantive but not sendability-blocking) makes triage harder, not easier.
- Five-tier separates the sendability gate (BLOCKER) from material legal issues (SUBSTANTIVE) from structural defects (STRUCTURAL) from drafting precision (PRECISION) from polish (POLISH). Each tier maps to distinct evaluator behavior.
- The mandatory DRAFTING / BUSINESS sub-classification on SUBSTANTIVE encodes the attorney-judgment control layer at the data layer. Reviewer that flags SUBSTANTIVE-BUSINESS is bound to surface options rather than recommend disposition.

### Working with reviewer side AND evaluator side

The unified taxonomy works for both because:

- **Reviewer side (producing feedback):** severity is the reviewer's calibrated assessment of how the issue affects sendability, legal correctness, structural integrity, drafting precision, or polish. Severity determines disposition_options on the card (e.g., BLOCKER cannot be DEFER; PRECISION can be REJECT).
- **Evaluator side (classifying for adopt/modify/pass):** severity is the input to the evaluator's prioritization. BLOCKERs are evaluated first; SUBSTANTIVE-BUSINESS items require attorney decision; POLISH defaults to defer in time-pressed cycles.

### Crosswalk to Reference Taxonomies dispositions

| Severity | Permitted dispositions | Notes |
|---|---|---|
| BLOCKER | ADOPT, UNRESOLVED | Cannot REJECT or DEFER; cannot send until disposed |
| SUBSTANTIVE-DRAFTING | ADOPT, MODIFY, REJECT, DEFER, PRESERVE_INTERNALLY, ALREADY_ADDRESSED, SUPERSEDED | Full disposition space |
| SUBSTANTIVE-BUSINESS | ADOPT, MODIFY, REJECT, DEFER, PRESERVE_INTERNALLY, UNRESOLVED | Attorney decision required; reviewer surfaces options |
| STRUCTURAL | ADOPT, MODIFY, REJECT, DEFER, ALREADY_ADDRESSED | Defaults to ADOPT or MODIFY unless attorney preserves current structure |
| PRECISION | ADOPT, MODIFY, REJECT, DEFER, PRESERVE_INTERNALLY | Substance/tone discipline determines REJECT behavior |
| POLISH | ADOPT, MODIFY, DEFER, ALREADY_ADDRESSED | Defer permitted; suppress in time-pressed cycles |

### Accommodation of the substantive-vs-tone axis

PRECISION tier has the substance/tone discipline baked in: substantively correct positions are not softened to POLISH unless audience or relationship-risk justifies. The §1.6 substance/tone rule in Phase 5 cross-track template enforces this for the reviewer; the evaluator (Claude Lite) enforces it at evaluation time.

### Accommodation of the drafting-vs-business axis

SUBSTANTIVE tier has the DRAFTING / BUSINESS sub-classification mandatory. The §1.7 drafting/business rule in Phase 5 enforces this for the reviewer. The schema requires severity_subtype to be set for severity=SUBSTANTIVE; cards without sub-classification are rejected by the evaluator as malformed.

---

## Phase 9 — Gap Inventory and Priority-Ordered Next Analytical Work

### Feedback-architecture gaps remaining after this run

Per v1.0 prompt Phase 9 inventory:

- **D1 high-utility feedback language clustering** — closure path: verified-row language extraction across 200-500 ledger rows tagged HIGH usefulness; cluster on source_quote field; produce top-50 cluster inventory.
- **D5 reviewer-persistence semantic effectiveness** — closure path: verified-row persistence cluster classification (useful vs. stale) once persistence rows accumulate.
- **D6 cross-model disagreement taxonomy** — closure path: verified extraction of disagreement instances with attorney-confirmed correctness adjudication. Highest-value for three-way arbitration UI design; 'lex 12' triangle is the singleton anchor.
- **LLN reviewer output capture** — HIGHEST PRIORITY new gap. Phase 3 cannot complete without LLN-side captured outputs. Capture plan in Phase 3 above identifies minimum stratified sample.
- **Gemini sweep** — Gemini Lite is in LLN scope but Gemini outputs are absent from feedback ledger (50 stated instances in Claude corpus only). A dedicated Gemini sweep would surface more Gemini-side patterns.
- **"Lex 12" three-platform triangle SINGLETON** — needs expansion or singleton acknowledgment. The 'lex 12' triangle (T-GR-0054 = T-0033 = T-CG-0062) is the only verified three-platform topology in the corpus. Either expand the corpus capture or treat the triangle as the singleton it is for now.
- **Practice-area thin evidence:** 1031 (ABSENT), pure business entity formation (THIN), trust-account RPC (ABSENT), M&A (THIN). Phase 5 §4 flags these as RESEARCH NEEDED. Targeted corpus capture in these areas would unblock practice-area variant specification.
- **Recursive critique provenance tracking** — when prompts are critiqued by other models and revised, that critique-revision history is itself workflow evidence. Currently not captured systematically.
- **Attorney-override rationale capture structured format** — overrides are captured but the rationale is in free-form prose. Structured rationale capture (with type tags per the v3 D7 attorney-override taxonomy categories: STRUCTURAL / DEAL-EXPERIENCE / CLIENT-KNOWLEDGE / SCOPE / TONE-CALIBRATION / RISK-ALLOCATION / AUDIENCE-SPECIFIC / PROFESSIONAL-RESPONSIBILITY) would feed Phase 5 spec calibration.

### Priority-ordered next analytical work

This ordering is analytical, not build order (Rule 11).

**Tier 1 — Required to complete the LLN reviewer-tuning analytical loop:**

1. **LLN reviewer Lite output capture.** Per Phase 3 capture plan. Without LLN-side captured outputs, the corpus-to-LLN delta is incomplete and the Phase 8 calibration test plan cannot be validated against real LLN behavior. Stratified sample: 3 cycles × 4 tracks × 3 practice areas (RE / T&E / Loan Docs) = 36 cycles minimum.

2. **Pilot revised Phase 5 reviewer prompt spec against held-out corpus sample.** Take 2-3 corpus matters with known reviewer-cycle outcomes (T-0120 Round 1 with Gemini + Reviewer 2; T-CG-0070 Msg 21 critique-of-drafting). Run the matters through LLN reviewer tracks configured per Phase 5 spec. Score outputs against expected behavior on the seven missing rules. Calibrate.

3. **Master prompt upload.** Upload Master Instructions v2.1; GROK v1.2; CLAUDE_TITLE_PROMPT_5-21-26; CLAUDE_REAL_ESTATE_MASTER_PROMPT; the three GPT prompts; the two Gemini prompts. Re-run Phase 1 audit as DIRECT against the actual files. Validate or revise the INDIRECT findings.

**Tier 2 — Higher-resolution corpus evidence:**

4. **D6 cross-model disagreement semantic extraction** + corpus-survey-with-direct-report-read. Highest-value evidence for three-way arbitration UI design.

5. **D5 reviewer-persistence semantic analysis.** Distinguish useful from stale persistence at corpus scale.

6. **D1 high-utility feedback language clustering.** Top-25 to top-50 formulation principles from verified-row source quotes; each principle is a candidate for explicit prompt instruction.

7. **Verification sampling on top feedback-related rule-based counts.** The ~23,000 Claude rule-based feedback rows have 71.9% in "unresolved" disposition because rule-based detection cannot infer disposition without semantic context. Sample 200-500 rows; verify dispositions; recompute aggregate adoption rates.

**Tier 3 — Practice-area / coverage expansion:**

8. **Gemini sweep for feedback behavior.** Dedicated Gemini-platform corpus capture. Gemini practice-area variants beyond RE/T&E are RESEARCH NEEDED in Phase 5 §4.

9. **Three-platform triangle expansion search.** Beyond 'lex 12', search for matters with all three of Claude + ChatGPT + Grok activity. Per Phase 2, semantic matter-level matching across the 30,439-row ledger would likely surface 2-5x more clusters.

10. **Underrepresented practice area capture.** 1031 exchange; pure business entity formation; M&A / asset sale; trust-account RPC; litigation. Each practice area target: 2-3 matters with full cycle history.

### Dependencies

| Next work | Dependency |
|---|---|
| 1. LLN output capture | Working LLN Lite tracks; matter fixtures |
| 2. Phase 5 pilot | Item 1; selected corpus matter fixtures |
| 3. Master prompt upload | Kelly action |
| 4. D6 extraction | Item 1 + verified rows |
| 5. D5 analysis | Verified rows on persistence-tagged items |
| 6. D1 clustering | Verified rows on HIGH-usefulness items |
| 7. Verification sampling | Verified-row labor capacity |
| 8. Gemini sweep | Gemini export accessible |
| 9. Three-platform expansion | Semantic matching tooling |
| 10. Practice-area capture | Matter selection; extraction labor capacity |

### Expected deliverables (when next work runs)

- Tier 1.1: `lln_output_capture.xlsx` (36+ scored cycles); `lln_capture_scoring_report.docx`
- Tier 1.2: `phase5_pilot_results.docx`; revised Phase 5 spec if calibration requires
- Tier 1.3: revised Phase 1 audit as DIRECT; revised Phase 6 v3 updates as DIRECT
- Tier 2.4-7: D6 / D5 / D1 / verification deliverables per v3 / v4 Prompt 2 spec
- Tier 3.8-10: practice-area variant specifications for unblock areas; expanded cross-platform topology

---

## Appendix — Provenance Note

This analytical document and its companion deliverables (Phase 5 spec; Phase 6 manual workflow updates; Phase 7 Reference Taxonomies update; Phase 8 calibration test plan) are produced by Claude as part of LLN Reviewer Tuning run v1.0. Per Rule 8 (project operating rules) Claude is the analyst; per Rule 2 attorney judgment is the control layer. The substantive findings should be reviewed and adjudicated by Kelly before integration into Lex Law Next.

Citations throughout cite by matter ID, report section, and v1.0 prompt section number where applicable. INDIRECT labels denote evidence derived from the v1.0 prompt's description of master prompts rather than from direct read of the prompt files. When the prompt files are uploaded, every INDIRECT finding should be revalidated.

End of Phase 0-4 + 9 analysis. See companion deliverables for Phase 5 (LLN reviewer prompt specs — primary deliverable), Phase 6 (manual workflow v3 updates), Phase 7 (Reference Taxonomies v1.3 proposal), and Phase 8 (calibration test plan).
