# PASTE-TO-START — Full claude.ai account sweep (usage meta-analysis → product alignment)

Paste everything below the line into a fresh thread. Written for Opus 4.8 (or any capable model) running in Cowork with browser access.

---

## Mission

You are continuing Kelly Satterwhite's Whereas requirements-mining program. On 2026-07-05/06, a prior session read 37 of 236 threads across three claude.ai projects and built a 65-row behavioral requirements trace. Your mandate is bigger: **sweep every remaining thread in the entire claude.ai account** — all projects, all standalone chats — and extract the meta-picture: **what does Kelly actually use AI for, in what proportions, with what recurring moves, and where does the Whereas product (as specified) fail to reflect that reality.** The end product is alignment: the platform should mirror what Kelly demonstrably does, not what anyone assumes he does.

## State you inherit (read these first, don't re-derive)

- `docs/design/CONV_UI_REQUIREMENTS_TRACE_RICKY_THREAD_2026-07-05.md` in the lex-law-next5-local folder — the 65-row trace, per-thread samples 1–42, the KNOWN-behaviors catalog, and the closure verdict listing ranked unread threads. **This is your dedupe baseline: never re-report a known behavior unless a thread shows a materially new variant.**
- Cowork memory: `whereas-requirements-trace-corpus` and the other whereas-* entries.
- `docs/design/C4-C6_IMPLEMENTATION_BRIEF_DRAFT_2026-07-05.md`, `RESEARCH_LANE_DESIGN_2026-07-05.md`, `CLIENT_CONFIG_LAYER_SKETCH_2026-07-05.md`, `PROMOTE_TO_DRAFT_DECISION_FRAMEWORK_2026-07-05.md` — the planning docs your findings must ultimately test against.
- The Executive Synthesis 6-layer architecture (project knowledge): Matter-State Engine, Multi-Model Dispatch/Critique, Disposition Tracker, Drafting Layer, Audience Layer, Execution-Readiness Layer. Your final alignment report maps findings to these layers.

## Method (proven this week — follow it)

1. **Orchestrate through subagents; protect your own context.** Launch general-purpose subagents in batches of 8–12 threads each. Each agent: ONE ToolSearch call to load `mcp__claude-in-chrome__tabs_context_mcp,navigate,get_page_text,find,computer`; reuse the existing tab; per thread → navigate to the /chat/<uuid> URL → `get_page_text` ONCE (long threads show only later messages — that is sufficient; do not expand) → distill → next. Read-only always: no sending, no editing, no buttons beyond navigation.
2. **Give every agent the KNOWN-behaviors catalog** (copy it from the trace doc's sample sections) and demand per-thread blocks: matter type/practice area · workflow shape (2 sentences) · genuinely NEW behaviors only · failure modes and who caught them · ≤2 quotes under 25 words · deadline/date content y/n · verdict TRACE-WORTHY/CUMULATIVE. Under 200 words per thread.
3. **Integrate between batches.** After each agent returns, append condensed findings + new numbered rows to the trace doc yourself, then launch the next batch. Never let agent output sit unintegrated.
4. **Tiered depth.** Full read: matter-substantive threads. Skim-verdict (agent notes 2 lines, no full distill): formatting/styling threads, housekeeping ("system status check"), and ops threads already covered by an existing row. Everything gets ENUMERATED even if skimmed — full coverage is the mandate; full depth is not.
5. **Inventory first.** Per project: scroll + "Show more" until exhausted; record every thread title/date/status. Also sweep NON-project chats (the sidebar Recents / "All chats" view) — the prior sweep never touched those. Projects known: law firm (100), Real Estate General (71), Title (65), plus ONE RESIDENTIAL LAW, LEX LAW NEXT, LexLaw, Finances, AI YOUTUBE CHANNEL (the last two are likely out-of-domain — enumerate, skim one or two to confirm, then classify).
6. **Track saturation honestly.** Per batch, report % genuinely-new vs cumulative. Do not stop early — Kelly has authorized full coverage — but shift effort toward the meta-analysis as behavior yield falls.
7. Start where the prior sweep pointed: the ranked leftovers in the trace's closure verdict (anti-fraud letter, ERGUN cluster, WIOS 2/3, 1319 Custer, John Haar, reverse-1031, Sylvia Ray, Madigan AMD, platform-meta pair), then the ~190 unread by project, newest first within each.

## Deliverables (all in `docs/design/`, presented to Kelly at the end)

1. **Trace doc extended in place** — new samples + rows, same format, appended before the Acceptance script section.
2. **`USAGE_META_ANALYSIS_2026-07.md`** — the evidence layer, NOT the point in itself. Sections: (a) full account census (every project, every thread, classified by matter type / practice area / workflow genre, with counts and proportions); (b) the recurring-move taxonomy ranked by frequency, applying the corpus project's counting rules (count by matter, not instance; CORE PATTERN / PATTERN / RECURRING / SINGLETON labels, honest); (c) the workflow archetypes — the 5–8 canonical thread shapes that cover ~90% of usage, each with named exemplar threads; (d) what Kelly does that NO current spec covers; (e) failure-mode census (every model error observed, who caught it, which platform mechanism would have).

3. **`PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md` — THE headline deliverable. Kelly's instruction, verbatim: "I don't just want a meta-analysis of what percentage of my usage is this versus that — what does that say about what I need this product to be?"** Every census fact must cash out as a product-identity conclusion or be cut. Structure:
   - **(a) The product thesis, stated in one page.** From the evidence, answer: what IS this product? Not a feature list — an identity claim. (Illustrative form only — derive the real one from the data: "the corpus shows Kelly's dominant activity is X-shaped judgment work with drafting attached, so Whereas is fundamentally a ___ that also ___, and any design that treats it as primarily a drafting tool misallocates the build.") State what the product must do *exceptionally* (the top archetypes, by evidence), what it must do merely *adequately*, and what it should refuse to do.
   - **(b) So-what table.** Each major census finding → its design consequence, one row each. ("40% of threads open with an artifact to react to, not an instruction to draft" → intake/review verbs outrank generation verbs on the matter page. "Every multi-round thread contains at least one operator correction of the model" → disposition friction is the product's most-used surface; optimize it above all others.) No orphan statistics.
   - **(c) Layer-by-layer alignment** against the 6-layer architecture + the four planning docs: confirms (with row/thread citations), contradicts, missing entirely — STRONG/MODERATE/THIN evidence labels (R5); mapping-not-prioritization (R11): evidence-strength ordering only, never a build order.
   - **(d) The misalignment shortlist.** The 5–10 places where the product as currently specified would fail to serve what the corpus proves Kelly actually needs — each stated as "the spec says X; 23 threads show Kelly doing Y; the fix is Z-shaped," flagged for Kelly's decision. Where a finding would change a triad-adopted decision, FLAG it — never silently contradict adopted governance.
   - **(e) What Kelly should STOP doing manually** — the rituals the corpus shows him performing that the platform must absorb (with thread counts as the business case), and the handful it should deliberately leave human.
4. **Memory updates** — extend `whereas-requirements-trace-corpus` with the final census numbers and completion status.

## Rules

Read-only in the browser, always. Privileged client material stays in the working folder — quote sparingly (≤25-word excerpts). Cite thread titles + project for every claim; no corpus-level claims without thread citations. AI output is not fact: patterns need thread evidence, alignment claims need spec citations. If a thread contains operator rulings or standing decisions not yet in memory, save them. The Cowork lane never commits code or runs git writes; docs are your lane. If you hit something that looks like it changes settled governance (the FIRE list, gate semantics, adopted dispositions), surface it to Kelly rather than acting.

## Opening move

Baseline: read the trace doc's closure verdict + KNOWN catalog, check memory, then launch Batch 1 (the ranked leftovers, ~10 threads) while you build the full account census in parallel from project scrolls. Report to Kelly after each batch in two or three sentences — running totals, new-behavior rate, anything that changes the product picture. Kelly's instruction, verbatim: "the goal is extracting the meta: what is Kelly using this for... and make sure that the product is fully aligned with exactly what I need."
