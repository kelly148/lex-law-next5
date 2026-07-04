# D3-SIGNOFF — source-anchored deed sign-off, Phase-A plan v1.1 (triad-adopted; build-ready)

**Supersedes for build purposes** `D3-SIGNOFF_packet.md` (v1.0). Append-only. **Disposition adopted 2026-07-03**
(`D3-SIGNOFF_consolidated_disposition_2026-07-03.md`): **PROCEED-WITH-NAMED-CHANGES**, unanimous. **OQ1 → ship
Fork A now (honestly labeled); Fork B = follow-on ticket D3B. OQ2 → OBSERVE → ENFORCE via a named operator
activation event; D3 ENFORCE is NOT gated on A.6** (operator decision on the record — A.6 runs THROUGH the
enforced gate, so gating D3 on A.6 would deadlock both).

## The central insight the triad added (drives the honest framing)

Fork A's comparator is **largely tautological against OCR error**: the draft's legal description is
extraction-verbatim, so an extraction error appears identically on both sides and passes. What Fork A genuinely
catches — and is worth shipping for — is **downstream divergence**: assembly bugs, manual edits, stale facts
after re-upload, version/hash drift. The control against extraction-vs-true-instrument error stays the
**attorney's comparison against the original document**, preserved as an explicit attestation (NC-D3-1), not
silently retired.

## Named changes (NC-D3-1 .. NC-D3-7) — the binding build directives

**NC-D3-1 (LOAD-BEARING) — Honest labeling + dual-prong attestation.** The left pane is labeled **"extracted
source text / facts"** — never "source document" / "source of record" — with provenance (file, extraction
timestamp, OCR-derived / manual / withheld) and a stronger warning on OCR-derived legal descriptions. The
existing **not-OCR-only attestation is RETAINED** as a second prong. The sign-off record carries BOTH: (a) the
deterministic comparator passed, (b) the attorney attests comparison against the **original instrument**. The
control is renamed **"source-extracted facts sign-off."**

**NC-D3-2 — Egress perimeter enumeration.** Before ENFORCE, audit every path assembled deed content can leave —
alternate export formats, print/PDF, bulk export, chat-copilot / egress surfaces — and gate or record each.
Name the ungatable residual (on-screen copy-paste) explicitly in the design record.

**NC-D3-3 — Three-tier block structure with a designed, non-swallowing override** (MISSING ≠ MISMATCHED):
- **HARD BLOCK, no ordinary override:** legal-description MISMATCH; missing draft fields; version/content-hash
  mismatch; comparator error. (Legal description is the non-overridable core.)
- **BLOCK UNLESS high-friction, audit-logged override:** genuinely absent/withheld source facts (no prior
  instrument, first conveyance, honesty-floor withheld), parcel unavailable, OCR-confidence problems. Override =
  affirmative attestation + structured reason + durable `audit_events` disposition, content-hash-bound,
  superseded on version change.
- **EXPLICIT NOT-APPLICABLE:** no parcel expected on the instrument face; role-mapping cases per NC-D3-5.

**NC-D3-4 — Normalization spec + real-OCR corpus + comparator versioning + export-route coverage.**
Normalization is a **pure deterministic string transform**, specified explicitly (never a model, never
fuzzy/semantic). Test corpus from **real OCR output** of actual recorded instruments (metes-and-bounds, "thence"
continuations, "et ux/et vir", condo units, multi-parcel, hyphenation/line-wrap). Integration tests on the
**export route itself** (409 matrix, supersession, withheld, multiset parties, flag both ways, no-finalize-
bypass) + property-based determinism tests. **Comparator version stamped into every sign-off record** so a later
normalization change cannot retroactively launder old sign-offs. False-fails are treated as seriously as
false-passes.

**NC-D3-5 — Party role-mapping semantics.** C2 must not naively compare source grantor/grantee to draft
grantor/grantee: in an ordinary conveyance the PRIOR deed's grantee (current owner) maps to the NEW deed's
grantor; the new grantee may have no source-side equivalent. **Role mapping is explicit per deed category**
before C2 becomes a blocker; capacity/authority checked separately.

**NC-D3-6 — Thickened disposition row + comparison snapshot.** The record carries: matter/document/version IDs;
assembled-deed content hash; source-facts hash; source material IDs; per-field comparator results +
confirmations; hashes of the actual compared values; comparator version; fork provenance
(`source=extracted-text/Fork-A`); both NC-D3-1 attestation prongs; per-value provenance class; override reason;
attorney identity; timestamp; gate mode at sign-off; supersession events; and a **snapshot (or hash) of the
displayed comparison** so what the attorney saw is reconstructable. **NC-1 guards:** comparator inputs restricted
to approved provenance classes; the comparator **never emits corrected text**; the mismatch UI **never offers
"replace with this"**; gate-row free text is excluded from the assembly path.

**NC-D3-7 — Production activation invariant (three-state flag).** `D3_SIGNOFF_MODE` = **OFF** (dev only) →
**OBSERVE** (compute + log a would-block; bounded; measures the false-fail rate; does NOT count as D3 complete)
→ **ENFORCE** (default-block). ENFORCE requires a **named operator activation event**, an audit-visible
enforcement indicator, a **runtime warning if prod serves deed exports without enforcement**, and a **named
flag-removal date** so the gate ends structural, not conditional. **D3 closes only at ENFORCE in prod** (or a
recorded observe-only operator decision).

## A.1 build increments (build-ready under this v1.1 plan)

- **A.1 Inc 1 — data core (this begins now):** the thickened sign-off record table (NC-D3-6) + Zod Wall + the
  `D3_SIGNOFF_MODE` three-state flag (default OFF) + the stamped comparator-version constant + additive
  migration. Flag-dark, no behavior change. Accept-gated (schema-bearing).
- **A.1 Inc 2 — the deterministic comparator:** reuse the dormant `checkLegalDescription` (C1) +
  `checkRequiredParties` (C2) with the NC-D3-5 role-mapping and the NC-D3-4 normalization spec; the NC-D3-3
  three-tier classification; pure, fixture-tested (real-OCR corpus). NC-1 guards enforced.
- **A.1 Inc 3 — export-route wiring in OBSERVE:** compute + log the would-block at the deed export chokepoint
  (mirror the fail-closed conflicts gate, not the sendability fail-to-warn); the NC-D3-2 egress enumeration; the
  409 matrix integration tests. No enforcement yet (OBSERVE).
- **A.1 Inc 4 — UI:** the "source-extracted facts sign-off" panel with NC-D3-1 honest labeling + dual-prong
  attestation + the mismatch view (never "replace with this").
- **Activation:** OBSERVE on live self-use matters → named operator `D3_SIGNOFF_MODE=enforce` flip → A.6
  five-deed protocol runs THROUGH the enforced gate → A.6 pass opens C.4–C.6.

## Follow-on

**D3B** (`docs/engagements/D3B-source-image-signoff-ticket.md`): source-image retention + image-side
verification (blob storage, retention, PII/access controls). Additive; no rework of the gate when it lands.
