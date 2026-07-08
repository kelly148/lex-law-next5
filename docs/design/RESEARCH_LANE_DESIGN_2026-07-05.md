# Primary-source research lane — design brief (planning doc; NEW SCOPE, gated)

**Cowork, 2026-07-05. This is the one genuinely new external-egress contract on the board (Ricky-thread trace, gap #5). Under standing governance it is a scope expansion (new integration/egress) → its own engagement + expected §3.1 FIRE. NOT authorized by any existing disposition. This doc is the design position for that future packet.**

## What it is

The conversation (and later the memo/KB pipeline) can invoke **fetch-and-verify against primary legal sources** — the Ricky-thread behavior ("verified against LIS", "confirmed verbatim against eCFR") as platform capability instead of ad-hoc model browsing. The zero-hallucination protocol from that thread is the spec: a citation is either **verified against a captured primary-source snapshot** or it is **flagged unverified and cannot green** — and unverifiable citations get dropped, not propagated.

## Architecture position

**R1 — Own egress surface through the existing broker.** A new `research` surface in `egressClient` with its own allowlist (`RESEARCH_SOURCE_ALLOWLIST` — domains, not providers: `law.lis.virginia.gov`, `ecfr.gov`, `law.justia.com` NO — keep it primary-source only at v1: LIS, eCFR, govinfo, the specific county DTA/land-records domains Kelly names). Fail-closed: empty allowlist = lane inert. Every fetch audited (URL, matter, trigger) in the same append-only pattern as chat_egress_events.

**R2 — The NPI-outbound rule (the GLBA heart of the packet).** Requests to research sources carry **law terms only — never client identifiers**. Structural enforcement, not intent: the research request object has no free-text passthrough from conversation; the query is built from statute cites / doctrinal terms extracted into a typed request, and a scrubber rejects anything matching matter-party names, addresses, parcel/loan identifiers. (A Google-able query containing "Ricky <surname> disabled veteran <address>" is the failure mode; "Va. Code 58.1-3219.5 proration spouse" is the pattern.)

**R3 — Fetch = snapshot into the KB-PROVENANCE-1 registry.** Every retrieved source lands as an `authority_source` row + captured snapshot (`authoritySnapshotId`), with retrieval date. Citations in any deliverable verify against snapshots, not live pages — that's what makes "verified as of <date>" honest, feeds `reviewBy`/staleness, and means the SAME authority fetched once serves every future matter (the registry is durable and owner-scoped, deliberately not matter-purged).

**R4 — Verification is a distinct act from retrieval.** The lane returns (a) the snapshot and (b) a machine check that quoted language appears in it. "Verified" chips render only from (b). The model never self-certifies verification (NC-3e discipline extended platform-wide — the unverified-citation render-block from title-exam becomes the global rule at memo/KB adoption).

**R5 — Staged rollout.** Stage R1: attorney-invoked only ("verify this cite" / "pull this statute" chips), results visible, nothing auto-fetches. Stage R2 (separate later decision): the model may *propose* fetches (chip to approve), never auto-fetch. No Stage where retrieval happens silently.

## What v1 excludes

Secondary sources, commercial databases (Westlaw/Lexis — different contract class entirely), case-law search (citator risk — flag as explicitly out), web search generally, county sites with session/login walls. Each is a later allowlist decision, not a design change.

## FIRE packet skeleton (when opened)

Decision under review: opening a controlled outbound research egress. Prongs: hard-to-reverse (attorneys will build verification habits on it), not CI-caught, confidentiality risk (NPI-outbound). Options to put: (A) no lane — model browsing stays out-of-platform (status quo: the verification work happens in claude.ai, unaudited); (B) this design; (C) B minus snapshots (verify-only, no registry) — rejected in draft because snapshots are what make verification durable and reusable. Key questions: R2 scrubber sufficiency; allowlist governance (who adds a domain — operator-only); whether research egress events surface in Supervision (they should — same page, new kind).

## Sequencing update (operator ruling, 2026-07-06)

Per the ratified product thesis (misalignment #8): verify-before-assert is CORE in the 234-thread census, and substantive errors were self-caught only where a verification step existed. **The §3.1 triad review of this design is SCHEDULED immediately after C.4–C.6 closes**, ahead of practice-area expansion. The FIRE gate is unchanged — no implementation before disposition.

## Dependencies / sequencing

Independent of C.4–C.6 (the verify verb ships panel-only first — C.4 brief OQ3). Natural order: after the conversational page soaks, because the research chips live there. The KB-PROVENANCE-1 schema it writes to is already merged and on prod.
