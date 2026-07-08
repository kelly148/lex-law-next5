# Client-level standing configuration — design sketch (planning doc)

**Cowork, 2026-07-05. Evidenced by two real threads the same evening (ONE Residential master-instructions thread; Ink'd GC context memorandum) — Kelly maintains per-client "lean master instructions" by hand today, in duplicate per AI platform. This layer brings them inside Whereas: configure once, every conversation and reviewer pass for that client inherits it. Not yet designed of record; this sketch seeds the eventual engagement.**

## Object model

**`client_profile`** (durable, owner-scoped, NOT matter-purged — same durability class as `authority_source`):
- Identity: client name(s), entity architecture (e.g., HoldCo/OpCo split with which-entity-contracts rules), the relationship posture (entity-only representation, authority screens, personal-matter screens).
- Standing postures: capacity defaults per work type (title hat vs law-firm hat vs outside-GC), conflict/RESPA discipline notes, product-posture non-negotiables (the Ink'd "tech tool only / no UPL / no legal advice" stack), marketing/communication guardrails.
- Style: house style, branding split (which firm's letterhead for which work class — the Mason/Satterwhite split), privilege-header convention.
- Work preferences: how the client likes deliverables (voice, format, escalation habits).
- **Divergence flags**: explicit records of where this client departs from the firm master, each with a why (the sample-2 privilege-header and Mason-fee specializations). Queryable, so a reviewer/conversation can state "this client departs from firm standard on X, deliberately" instead of re-raising it.
- **Live pointers, never live facts**: a small by-reference section (open blockers, active matters) that POINTS to matter state. The staleness doctrine is a hard rule: config holds only what does not go stale; anything transactional lives in matter state and is referenced, not copied.

## Inheritance chain

**Firm master → capacity/hat → client profile → matter state** (updated 2026-07-06 per the ratified thesis: the census shows Kelly's three claude.ai projects map exactly to his three capacities — title agent / law-firm counsel / outside GC — each with its own standing prompt and memory, making **capacity the primary organizing axis above client**), later-overrides-earlier with divergences explicit. Conversations (C.4+) assemble context in that order; reviewer prompts get the relevant slice (e.g., the gift-recital convention is firm-level; the Ink'd no-legal-advice posture is client-level; the specific deed's facts are matter-level).

## Lock semantics at config scope

Decision locks extend beyond documents: a config-scope lock ("privilege header stays ATTORNEY-CLIENT COMMUNICATION for this client — decided, don't re-raise") is visible to reviewers and to the conversation, and Decline-&-lock from any surface can target config scope. Same audit_events projection (Fork C — no new decision store).

## Surfaces

- A Client page (or Settings-adjacent Clients section): profile editor, divergence table, lock list.
- Matter creation: picking a client applies the profile (capacity default pre-selected, style bound).
- Conversation: the profile is ambient context; proposed profile *changes* detected in conversation ("from now on, bill Ink'd at…") surface as proposals → confirm = deliberate act, audited (same D3 mechanic as facts).

## What it kills

The hand-maintained per-platform master-instruction files (two copies per client today) and the "paste the context memorandum into a fresh thread" ritual. Multi-model packaging is the dispatch layer's job.

## Open design questions (for the engagement)

1. Schema: new `client` entity vs. profile keyed on client name strings currently living on matters (probably a real entity + backfill-by-confirmation, additive).
2. Where the firm master itself lives (a distinguished profile? practice-KB doc with config semantics?).
3. Reviewer exposure: full profile vs. scoped slice per review type (privilege/confidentiality argues for scoped).
4. Interaction with conflicts machinery once the gate turns on (client entity unification helps conflicts checking materially — possible Stage-2 synergy).
