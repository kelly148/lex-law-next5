# FL-7 — Assessed-value extraction miss (investigation, findings-only)

**Engagement:** FL-MEDIUM-1 item FL-7 (INVESTIGATION ONLY — no extraction-behavior change).
**Date:** 2026-07-06. All conclusions **confirmed by code inspection**.
**Files:** `src/server/deed/deedIngestExtract.ts` (extraction), `src/server/deed/deedSourceFacts.ts` (pairing).

## Symptom
The tax-record extraction/pairing skipped `assessedValue` — the field resolved absent/withheld even when a tax record was uploaded.

## How assessed value is extracted today
`extractTaxRecord` (deedIngestExtract.ts ~943–956) calls `extractMoney(text, S.assessedValue, /\b(?:total\s+)?assessed\s+value\s*[:#]/i)` (primary label), with `total assessment` and `(new) total value` fallbacks (~949/952). `extractMoney` (~642–649) delegates to `labeledLineValue` (~588–600), which pairs a label to a value **only when the label is immediately followed by `:` or `#`** and the value sits **on the same physical line** (cut at the first newline or the first 2+-space column gap).

## Root cause — three converging, extraction-behavior causes (any one produces an absent/withheld value)

1. **Label/layout mismatch (most likely).** County tax / GIS printouts render "Assessed Value" as a table **header** or column label with the dollar figure in an adjacent cell, on the next line, or with no colon/hash. The strict `[:#]`-anchored, same-line matcher then finds no value (`labeledLineValue` → `null` → `notFound`). OCR of a two-column assessment table (label above/left of the number) systematically defeats same-line pairing.

2. **Multiple-amounts withhold.** `extractMoney` returns `withheld(['multiple_amounts'])` when the matched line carries more than one distinct dollar token. Layouts printing "Land … Improvements … Total …" on one line yield ≥2 amounts → withheld. Critically, the `total assessment` / `total value` fallbacks (~949/952) are **guarded by `!assessed.withheld`**, so once the primary label matches-but-withholds, the cleaner "Total …" fallback is **skipped** — the figure stays withheld even when a usable total label exists later.

3. **Classification / pairing gate — no fallback.** `extractDeedIngest` runs exactly one extractor chosen by `classifyDeedDocType`. The pairing in `deedSourceFacts.ts:199` picks `assessedValue` from **only** `{ type: 'tax_record', key: 'assessedValue' }` — unlike `parcelId` (~192–196), which has `vesting_deed`/`title_commitment` fallbacks. So if the tax record **misclassifies** (a known failure mode the code itself documents — a bare "Administrator"/"Website Administrator" token misclassifying a tax record as probate, comments ~499–517), `extractTaxRecord` never runs and `pickFact` finds no `tax_record`-typed material → `assessedValue` = `ABSENT_FACT`, even though the vesting-deed extractor also has an assessedValue capture (~837) that is never consulted for this fact.

## Most probable single cause
The assessed-value label in the OCR'd record did not present as `Assessed Value:` with the figure on the same line (colon/hash-anchored, single amount) — so `labeledLineValue` returned null and the field fell through to absent; the no-fallback pairing (cause 3) means any tax-record misclassification produces the same result.

## Recommended follow-up (a SEPARATE, reviewed engagement — NOT this batch)
An extraction-behavior change would be needed, e.g.: (a) a next-line / column-cell pairing fallback for the assessed-value label (relax the same-line, colon-anchored constraint for this specific field); (b) let the `total assessment`/`total value` fallbacks run even when the primary label withheld on `multiple_amounts`; (c) add a `vesting_deed` fallback preference for `assessedValue` in `deedSourceFacts.ts` (mirroring `parcelId`). Each touches extraction/pairing behavior on a legally-load-bearing field and should get its own review. **No change made here.**

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
