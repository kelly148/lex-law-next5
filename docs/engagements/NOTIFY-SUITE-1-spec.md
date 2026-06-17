# NOTIFY-SUITE-1 — notification extensions (N1 away-digest · N2 deadline alerts · N3 preferences) — spec

**Status:** spec / build-ready. Cowork (propose lane), 2026-06-16. Extends **FOLD-NOTIFY-1** (in-app core: bell + unread badge + per-matter "ready" badge, jobs-terminal event source). **Classification: normal automation (reversible, additive, owner-scoped)** — overnight-batch-eligible as each increment is specced. Depends on NOTIFY-1 core landing first.

## Objective
Turn the NOTIFY-1 completion badge into a day-manager: a digest of what happened while away (N1), deadline/tickler alerts off the **already-built PM-1 engine** (N2), and a preferences panel to control all of it (N3). Informational only — never auto-acts (consistent with "the five explicit acts never become ambient").

## N2 — Deadline / tickler alerts (highest value; build first)
The PM-1 deadline engine already exposes the read surface — this increment surfaces it as notifications.
- **Reuse:** `listDeadlinesForOwner` (cross-matter), `listTicklersForDeadline` / `refreshTicklersForMatter`, `effectiveDueDate` (`src/server/db/queries/deadlines.ts`). No new deadline computation.
- **Build:** a poll/read that, for the current user, finds deadlines/ticklers whose effective due date falls inside a configurable window (e.g. due today / next 7 / next 30) and surfaces them as in-app notifications + a per-matter "deadline approaching" badge. Covers your 1031 45/180-day, closing/recording, trust-funding, corporate-filing ticklers.
- **Additive:** read-only over the deadline engine + the NOTIFY-1 notification store; no schema change beyond (optionally) a per-deadline "notified-at" cursor to avoid re-alerting (additive column or a derived last-seen cursor).
- **Informational only:** a deadline alert never auto-creates/auto-files anything; the attorney acts.
- **Acceptance:** an approaching deadline on a synthetic matter raises an in-app alert + badge within the window; dismissable; owner-scoped; no duplicate spam after dismiss.

## N1 — "While you were away" digest
- **Build:** on return (app focus / login after an idle gap), assemble a single summary of everything that reached a terminal state since the user's last-seen cursor — reviews completed/failed, regenerations, extractions, sendability checks, plus N2 deadlines crossing into-window. Reuses the NOTIFY-1 store + last-seen cursor; derive, don't duplicate.
- **Additive, owner-scoped, informational.** No new authoritative table (read-projection over notifications + jobs terminal state + the cursor).
- **Acceptance:** after backgrounding the app while several synthetic jobs complete, returning shows one coherent digest ("3 matters have results, 1 deadline approaching"), not N separate toasts; clicking an item navigates to it.

## N3 — Notification preferences panel
- **Build:** a Settings panel mirroring the existing `settings.updateReviewerEnablement` pattern over the `UserPreferencesDataSchema` blob: enable/disable per **event type** (review complete / failed / regen / extraction / sendability / deadline), per **channel** (in-app / tab title / OS-when-built), per-matter **watch/mute**, digest on/off, sound on/off. Additive `notificationPreferences` field in the preferences blob; `settings.get` returns it; a `settings.updateNotificationPreferences` mutation (audited like the reviewer-enablement change).
- **Default-safe:** sensible defaults (in-app on, failures on, deadlines on, OS off); nothing surprising on by default.
- **Acceptance:** toggling an event type off suppresses that notification class; per-matter mute silences that matter; choices persist; owner-scoped.

## Dependencies & sequencing
- **NOTIFY-1 core** (in-app store + badge + poll) must land first — N1/N2/N3 build on it.
- N2 needs PM-1 (built). N3 needs the preferences blob (built). N1 needs the NOTIFY-1 cursor.
- **Suggested order:** N2 (highest value, ready engine) → N3 (control surface) → N1 (digest).
- **OS-tier (N4)** is separate — the deferred NOTIFY-1 outer tier with the content-light NPI guardrail; a light privacy review of the OS payload, not part of this reversible suite.

## Do-not-touch
No auto-actions (never auto-adopt/send/file from a notification); no NPI beyond the in-app boundary; no change to PM-1's deadline computation or the reviewer dispatch; owner-scoped strictly (never cross-user).

---
*Reversible/additive spec. Each increment is overnight-batch-eligible once NOTIFY-1 core is merged. Cowork spec — the CLI builds; no commit here.*
