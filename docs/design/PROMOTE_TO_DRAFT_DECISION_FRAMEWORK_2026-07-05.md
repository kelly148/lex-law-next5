# Promote-to-draft from conversation — decision framework (pre-FIRE planning doc)

**Cowork, 2026-07-05. NOT a review packet and NOT implementation authorization — promote-to-draft is a standing future §3.1 FIRE (named in the C1-CONV-DESIGN disposition and every copilot close-out). This doc pre-drafts the decision framework so that when the operator opens the engagement, the packet assembles from a considered position instead of from scratch.**

## The decision under review

Whether, and by what mechanism, text that originated in a matter conversation may become document content. This is the deliberate breach of the No-Shadow-Instrument rule's outer wall (NC-C1-1): today the conversation lane has **no write path to documents/versions, period**. All three FIRE prongs hold: hard to reverse once attorneys habituate to it; not CI-caught (the risk is workflow-shaped, not code-shaped); client-send-safety (conversation text reaching a client document without the drafting layer's gates is the exact laundering path the copilot mitigations exist to prevent).

## Why anyone would want it

The Ricky thread: the synthesized client email was composed IN conversation, then hand-carried out. Post-C.4, the natural user action is "make that the draft." Forcing retype/re-generation of good conversational work product is real friction; the question is which mechanism captures the value without the laundering risk.

## Options

**A — Never promote (status quo made permanent).** Conversation routes to fresh document creation; the drafting layer regenerates from matter state, with the conversation available as grounded context. Cleanest risk posture; the friction is a re-generation step that usually produces comparable text. Cost: attorneys will copy-paste around it, which is WORSE (no provenance at all) — the prohibition doesn't remove the path, it removes the audit trail.

**B — Promote as ordinary draft content via deliberate confirm.** A confirmed promote act creates a document (normal workflow, all gates) whose v1 body is the conversation text, with full provenance (source turns, grounding, models involved) and the promote act on the deliberate-act floor (the NC-C1-5 conditional says it MUST join the floor before shipping). Risk: v1-anchoring — reviewers review what's there; a conversation-born draft skips the drafting layer's structured generation (matter-state injection, template/house-form discipline). Mitigable by forced immediate review session? Partially.

**C — Promote as PROPOSAL, not content.** The promote act creates a document in the normal way (structured generation from matter state) AND attaches the conversation text as a *proposed alternative / reviewer-style suggestion card* against it. The attorney adopts conversationally-drafted language clause-by-clause through the existing disposition machinery. Nothing conversation-born becomes operative text without an adoption event. Slower for the "the email is already perfect" case; strongest provenance and gate integrity; reuses machinery that already exists (cards, adopt ledger, locks).

**D — Hybrid by document class (recommended for the packet's straw position).** Class 1 (correspondence: client letters, emails, info-request cover text): Option B — deliberate confirm, full provenance, sendability pre-flight mandatory before export; these are the Ricky case and the value case. Class 2 (instruments and operative documents: wills, deeds barred outright per LIVE-9, agreements, anything recordable/executable): Option C only — conversation text arrives as proposals against a structurally-generated draft. Class boundary is the existing docTypeConfig taxonomy (correspondence types vs instrument types), which is already load-bearing for subject binding.

## Invariants any option must preserve

LIVE-9 (no deed text path, ever); NC-C1-7 (the promote act, not the chat content, is the decision — audit_events provenance); the deliberate-act floor expansion conditional (NC-C1-5); sendability gate + QA-5 on anything leaving; the one-authoritative-review-path rule (NC-C1-8 — promoted content joins the same disposition machinery, never a parallel channel); honesty about origin (a promoted document's version history shows conversation origin — no laundering into "generated" provenance).

## Questions the triad packet must put

1. Is D's class boundary (correspondence vs instrument) the right cut, and is docTypeConfig the right enforcement point?
2. Does Class-1 promotion require a mandatory review pass before first export, or is the sendability pre-flight + deliberate send enough (two-layer argument, NC-C1-6)?
3. v1-anchoring: does a conversation-born Class-1 draft need a visible "conversation-origin" banner for its lifetime, or is version-history provenance sufficient?
4. Does the copy-paste reality (Option A's failure mode) justify accepting Option B risk for Class 1 — i.e., is the provenance argument dispositive?
5. What joins the deliberate-act floor: the promote act alone, or promote + first-export-after-promote?

## Sequencing

Not before C.6c completes and has soaked in real use — the promote pressure is only observable once the conversational page is the daily surface. Assemble the packet per Rule 13 when opened (this doc becomes the "decision under review" core; add the then-current diffs and the Phase-A plan).
