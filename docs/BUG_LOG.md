# BUG_LOG — Lex Law Next

Defect log, newest-first. One entry per operator-confirmed defect: symptom, root cause, fix, verification, status.

---

## REVIEW-PANE-SCROLL-1 — review pane unscrollable to the bottom once secondary panels expand

- **Date:** 2026-06-08 · **Severity:** release blocker · **Status:** FIXED (build complete, CI-green; live UAT pending) · **Branch/PR:** `lex-next/review-pane-scroll-1`
- **Symptom (operator-confirmed, prod):** In a review session, the RIGHT review pane could not scroll to the bottom once the secondary panels below the feedback area were expanded — content below the viewport fold (panels + footer actions) was unreachable. The LEFT document pane scrolled correctly (the reference pattern to copy).
- **Root cause:** In `ActiveSessionView` (`src/client/components/ReviewPane.tsx`), the scroll container (`flex-1 overflow-y-auto`) wrapped ONLY the feedback cards. The eight secondary panels (Orchestration, Locked Decisions, Adopt Ledger, Sendability, Provision Provenance, LDD, Export Safety, History) and the footer were SIBLINGS placed after it, inside an `h-full` root whose parent was `overflow-hidden`. When a panel expanded, the total content exceeded the fixed-height root; only the feedback cards' own scroll could move, so the expanded panels and footer overflowed and were clipped (unreachable).
- **Fix:** Made the review pane a single scroll container, mirroring the left `DocumentReferencePane` (a single `overflow-y-auto` body). ONE scroll body (`flex-1 min-h-0 overflow-y-auto`, `data-testid="review-scroll-body"`) now wraps the feedback area AND every secondary panel; the session-info header stays fixed above it; the footer action strip (`flex-shrink-0`) sits OUTSIDE it; a bottom spacer (`h-20` ≥ footer height) lets the last control clear the footer. No nested scroll containers inside the panels. Root gained `min-h-0` for the flex chain.
- **Verification:** tsc + eslint clean; a source-audit regression test (`reviewPaneScroll1.test.tsx`) pins panels-inside / footer-outside; all 117 client render tests pass (incl. the ActiveSessionView survivability/clarity suites). **LIVE acceptance is operator-driven** (jsdom does no layout/scroll): with all secondary panels expanded AND 5+ suggestion cards (one expanded), the last focusable control must be reachable and visible above the footer at 100% and 125% browser zoom via wheel / trackpad / keyboard-tab.
- **Scope:** standalone defect fix, independent of REVIEW-UX-REDESIGN-1; build only, NOT deployed (env flips rebuild latest `main` — diff main vs prod before any flip).
