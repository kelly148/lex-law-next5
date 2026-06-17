# FOLD-DEED-1 — Pre-FIRE scope memo (operator scope decision recorded)

**Cowork analysis (propose-never-commit). 2026-06-16.** Per the QUEUE-EXEC-PLAN-1 disposition (item 2/5): the deed scope decision is made **before** assembling the DEED-1 FIRE packet, and the held DEED-1 packet is **downgraded to this scope memo**. The full FIRE packet is assembled later — after PM-3's party/entity interface is frozen and this scope boundary is confirmed. This memo records the decision + the boundaries the eventual packet and build must honor.

## Operator scope decision (Kelly, 2026-06-16)
**Deed drafting is IN SCOPE as legal document-assembly work** — the firm drafts legal documents (deeds) for a fee. **Refinement (operator, 2026-06-16):** it is a **hybrid — "half law-firm, half title."** It is genuinely legal work (so it sits with the firm, not the pure title-agent context), **but it does NOT carry the full representational-matter burden** — in particular, **it does not require the complex conflicts-at-intake analysis** that FOLD-L0-1 makes RPC-mandatory for representational matters. In the operator's words: *"that just needs to get done."*

### What this means concretely
- Deeds run as a **document type** in the existing matter → draft → review → sendability workflow (as the spec already frames them) — NOT a separate app, NOT the title/settlement-agent path the platform keeps out of drafting.
- **Conflicts posture is light, not absent.** Deed-drafting work is a **transactional document-assembly class** with a **streamlined / advisory conflicts requirement**, not the full blocking conflicts-at-intake gate. The point is to let the work get done without a heavy intake ceremony — while NOT silently turning off an ethics control.

### The interaction this creates (flag — connects to CONFLICT-TOGGLE-1)
This is exactly the design seam the two QUEUE-EXEC-PLAN-1 reviewers warned about. The safe way to deliver "deeds just get done without complex conflicts" is **NOT** a global conflicts kill-switch — it's a **per-work-type (or per-matter-type) conflicts posture**: representational matters keep the full RPC-mandatory L0-1 gate; transactional document-assembly (deeds, and similar fee-for-drafting work) runs a **lighter, advisory** conflicts posture. That is materially safer than a global on/off and reconciles with both reviewers' concern that an in-app off-switch must never silently disable conflicts checking for work that needs it.

**Recommendation to carry into both engagements:** treat the deed conflicts posture as a **matter-type/work-type attribute** (transactional vs. representational), set deliberately and audited, rather than a global toggle. CONFLICT-TOGGLE-1's FIRE packet and DEED-1's FIRE packet should be **reconciled against each other** on this point — the toggle should express "which conflicts posture applies to this class of work," not "conflicts on/off for everything." *(This is a refinement to surface to CONFLICT-TOGGLE-1's triad; do not pre-decide.)*

## Boundaries the DEED-1 build must honor (unchanged by the lighter conflicts posture)
The lighter conflicts posture does **not** relax the deed-specific safety controls — those are document-correctness, not intake-ceremony:
- **Legal description: NEVER AI-generated or paraphrased** — carried verbatim from the source of record; extraction uncertainty flagged for attorney verification.
- **Vesting/tenancy, marital rights, transfer/recordation tax** remain **attorney decisions**, never inferred; tax rates/recording rules from verified KB, not model memory.
- **Recordability gate** (extends FOLD-SEND-1): legal description present + attorney-verified · acknowledgment correct for the state/locality · tax computed + recital present · recording refs present · grantee tax-bill address present · warranty matches deed type.
- **No auto-recording;** the attorney verifies and signs.

## Build dependencies (sequencing — for the operator/CLI, not the triad)
- **PM-3 (party/entity model) — not built; the build blocker.** Grantor/grantee identity + entity vesting is PM-3's substrate. DEED-1's *final* FIRE packet should be assembled only after PM-3's interface is frozen, so the review isn't against a moving party model (the reviewers' R1 point).
- KB-1 (templates/verified authority), FOLD-L1 (matter state), FOLD-PM-2 (extraction), FOLD-SEND-1 (recordability gate) — all built.
- **Capacity/UPL framing now resolved by the operator:** legal work, firm seat, transactional posture. The remaining narrow open items (jurisdiction granularity; deed-of-trust in/out; RON/e-recording now vs. defer to INTEG; seed scope of deed types × jurisdictions) are normal spec questions, not scope blockers.

## Status / next
- **DEED-1 stays Wave 2 (FIRE), build-after-PM-3.** Not front-loaded (per disposition).
- **Next Cowork action when PM-3 nears interface-freeze:** assemble the DEED-1 FIRE packet from this memo + the spec, with the conflicts-posture reconciliation to CONFLICT-TOGGLE-1 called out explicitly for the triad.
- The DEED-1 FIRE packet drafted earlier this session (`docs/reviews/FOLD-DEED-1_packet.md`) is **HELD — do not run** until PM-3 freeze + this memo's posture is reflected.

---
*Cowork scope memo — not a commit. Records the operator scope decision; the FIRE packet and build follow per the disposition's sequence.*
