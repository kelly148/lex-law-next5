# W3a — B6 export-chokepoint verification (run-sheet A.2)

**ULTRABUILD-1 W3a.** Verify that every deed-export path routes through the single audited B6 recordability
annotation-leak chokepoint; identify test gaps; close the residual or report exactly what remains.

## The chokepoint

`checkAnnotationLeak(renderedDeedText): GateResult` — `src/server/deed/deedDraftGates.ts:257`. Deterministic,
no LLM. Denylist `B6_STRAY_CHARS` (206-212) + `B6_MARKERS` (217-222); narrow `RECORDABLE_ALLOWLIST` masking
(229-246) for the condo LCE footnote + §55.1-136(C) TBE NOTE. The module header + each assembler call it "the
single chokepoint."

## Routing — CONFIRMED by code inspection: all 7 built categories route through the chokepoint

The 8 KB keys (`VA_DEED_TYPES`) minus `distribution` (no assembler, not generable) = **7 built assemblers**,
and each calls `checkAnnotationLeak` on its assembled body:

| # | Category | Assembler | B6 call site |
|---|---|---|---|
| 1 | gift | `deedGiftAssembler.ts` | `:338` (→ factsResolved :339) |
| 2 | seller_side (bargain_and_sale) | `deedSellerSideAssembler.ts` | `:377` (→ recordableFloorOk :379) |
| 3 | tod (transfer_on_death) | `deedTodAssembler.ts` | `:400` |
| 4 | into_llc | `deedIntoLlcAssembler.ts` | `:253` |
| 5 | out_of_llc | `deedOutOfLlcAssembler.ts` | `:338` |
| 6 | confirmation | `deedConfirmationAssembler.ts` | `:430` + `:552` (both archetype paths) |
| 7 | into_trust | `deedIntoTrustAssembler.ts` | `:618` + `:740` (both paths) |

**No category bypasses the chokepoint; none re-implements its own leak detector.** `checkAnnotationLeak` is also
reused internally by the C2 comparator (`:190`).

## Design posture (NOT a defect): B6 is ADVISORY across all 7

Every path calls `checkAnnotationLeak` but **none hard-blocks emission** on failure — the result is surfaced as
an advisory boolean (`recordableFloorOk` / `factsResolved`) written into the document NOTES, and the deed still
assembles and flows through the generic `.docx` export (which does not re-run B6). This is the accepted posture
while the surface is flag-dark (`DEED_DRAFT_AGENT_ENABLED` default OFF, attorney-supervised, never
auto-records/sends). Making B6 a HARD export gate is an operator/design decision, not a test fix — related to
the D3-SIGNOFF FIRE plan (which proposes a fail-closed source-anchored gate at export).

## Test coverage — verified, with a precise residual

- **The chokepoint itself** is thoroughly unit-tested (`deed_draft_gates.test.ts` — positive clean deed, every
  denylist char/marker, allowlist masking, case-insensitivity).
- **Happy-path "assembled deed passes the floor"** is asserted for **all 7** categories (each assembler test).
- **Direct negative "B6 fires on this category's assembled body when a marker leaks"** is asserted for **gift**
  and **seller_side** directly. `into_trust` has a stray-token negative via its WITHHELD guard.
- **RESIDUAL (what remains):** `tod`, `into_llc`, `out_of_llc`, `confirmation` have extensive negative fixtures,
  but all fail closed via **category-specific WITHHELD guards** (e.g. LEGAL_DESCRIPTION_TRUNCATED,
  PARTY_NAME_LABEL_BLEED, WARRANTY_MISMATCH, INCOMPLETE_DEVISE_CHAIN) — **none** asserts
  `recordableFloorOk===false` driven by a **B6 denylist token** in an otherwise-OK deed. So B6-firing is not
  directly pinned for those 4 categories (though their routing through the chokepoint is verified above by
  inspection, and the chokepoint itself is exhaustively tested).

## Added by W3a

A **cross-category structural invariant test** (`src/server/__tests__/ub1_w3a_b6_chokepoint.test.ts`) that runs
the B6 chokepoint over each of the 7 categories' characteristic operative text — clean → passes, one shared
injected denylist marker → flags — so the chokepoint's coverage over every category's shape is CI-locked and a
future 8th category (e.g. `distribution`) cannot land a body shape the chokepoint silently misses.

## Recommended follow-up (documented residual, low priority)

Per-category behavioral negative B6 tests for `tod` / `into_llc` / `out_of_llc` / `confirmation` (inject a
denylist marker into a free-text field that reaches `fullText` and is NOT already caught by a WITHHELD guard,
assert `recordableFloorOk===false`). Belt-and-suspenders: the single-chokepoint routing is already verified by
inspection and the chokepoint is exhaustively tested; deferred to keep this reversible-lane item small.

## 7-vs-8 note

`VA_DEED_TYPES` lists 8 keys; `distribution` has **no assembler** and is absent from `WIRED_QUICK_DEED_TYPES` —
it is not generable, so it has no B6 path. Documented here so the 7-vs-8 gap is explicit.
