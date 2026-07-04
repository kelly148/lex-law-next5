# De-identification scrub rule — structural identifiers (ULTRABUILD-1 W2a / run-sheet 0.4)

**Status:** governance rule, adopted 2026-07-03. Committed + PII-free. The anonymized UAT corpus itself
(`deed-materials/_anonymized/`) is gitignored real-client-adjacent material and lives only locally; this doc is
the durable, reviewable statement of the rule that governs how it is scrubbed.

## Why this exists

The Fable audit (2026-07-03, Top-5 #4) found that the "zero real-PII leaks" corpus retained a **real parcel's
verbatim legal description** — a Lot/Section/subdivision string carried over unchanged under a "Fake
identifiers" heading. It slipped through because the corpus was verified only by scanning outputs against a
**blocklist of known real tokens (names, numbers)**. A token-blocklist scan structurally **cannot** catch a
real *structural identifier* that was never enumerated in the token list: a verbatim legal description, an
instrument number, a book/page cite, a parcel/tax-map id, or a file number is re-identifying on its own (it
resolves to the property, and via land records to the client) even with every name removed.

## The rule

De-identification of any deed/title source material MUST scrub **structural identifiers**, not just named
tokens. Before a file is treated as anonymized, every occurrence of each of the following must be replaced with
a **fabricated, same-shape** value (never carried over verbatim, never merely partially masked):

1. **Legal descriptions** — Lot / Section / Block / Phase / Unit numbers, subdivision / condominium names, and
   metes-and-bounds text.
2. **Instrument references** — deed book & page, instrument numbers, corrected-certificate / prior-instrument
   cites embedded in a BEING/derivation recital or inside a legal description.
3. **Parcel / tax identifiers** — GPIN, parcel id, tax-map number, RPC number.
4. **Recording locality + property address** where they combine with the above to re-identify a specific parcel.
5. **File / matter numbers** and fiduciary / estate case numbers.
6. Everything the existing token-blocklist already covers (party names, entity names, dates of death, SSNs/TINs).

## The verification standard

A corpus may be asserted "no real-PII leaks" **only after** BOTH:

- (a) the token-blocklist scan of outputs against the full real-token list (the existing method); **AND**
- (b) a **structural-shape review** — a human (or a shape-matching pass) confirms that no legal description,
  instrument reference, parcel id, or file number is a verbatim carry-over from a real source. Because (b)
  cannot be done by a name/number blocklist, it is a distinct, required step.

Attorney confirmation of de-identification is required **before** any file enters the corpus or is uploaded to
the live app.

## Precondition note (run-sheet 0.4)

Fixing the existing corpus leak and this scrub standard are a **blocking precondition to any deed-generalization
I0 corpus-mining work** — I0 mines the same corpus, so a structural-identifier leak there propagates. The
actual re-scrub of the affected local file (regenerating the `ANON_*` source so the real legal description is
gone from the document itself, not only from the manifest) requires the sandbox real→fake mapping tooling that
is deliberately **not** stored in the repo, and is therefore an operator/sandbox task tracked separately.
