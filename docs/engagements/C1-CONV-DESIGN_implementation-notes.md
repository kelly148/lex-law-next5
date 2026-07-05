# C1-CONV-DESIGN — implementation notes (build inputs to carry forward)

Append-only notes for the C.4–C.6 conversational build and the Copilot UI so decisions are not rediscovered.

## UI posture — adopt UI-ATTORNEY-SWEEP-1's G1–G5 as BUILD INPUTS (recorded 2026-07-05, per the sweep brief §S10)

The conversation and Copilot surfaces are preview/flag-gated, so they were NOT reworked in UI-ATTORNEY-SWEEP-1.
But when they are built, they must be built to the same attorney-audience principle from the start — do not
recreate the supervision-tone/teaching-prose posture the sweep removed everywhere else. **The user is an
attorney; she decides what is finished, recordable, and sendable, and can tell at a glance. The machinery's
value is safeguards and evidence at the right altitude: terse neutral status, one-click expansion, no teaching
prose, no supervision tone. Keep every safeguard; fix its posture.**

Concretely, apply these as design inputs to the conversational + Copilot UI:

- **G1 — no "auto-record" disclaimers.** Never narrate "never auto-recorded / auto-recorded or sent." Auto-
  recording is not a product capability (recording is a human act at the courthouse); disclaiming a nonexistent
  capability is noise. Where a real send/export boundary exists, the export pre-flight already says what matters.
- **G2 — yellow boxes are for action-now only.** Standing-policy explanations become one muted line + an
  expandable detail, never a persistent warning box.
- **G3 — explainers move behind the UI** (tooltip / expanded-section footnote / Settings), stated once. No
  first-person lecture lines ("You are responsible for monitoring…").
- **G4 — assume the attorney.** No "Attorney decision required" labels on every substantive card in a single-
  attorney product — every disposition is hers; compress to the escalation chip (same always-escalate class
  underneath; semantics unchanged).
- **G5 — neutral counts over verdict banners** (e.g. "Recording checklist: 14 open", not "Recordable: NO").

**Preserved unchanged (do NOT strip when carrying the posture forward):** attestation/checkbox language, cure-
card content, reviewer-card issue/recommend/revision structure, N-of-M honesty banners, the "Advisory only —
you decide" line, and all audit trails. The sweep is display posture only; it never changes what is gated,
recorded, escalated, or blocked.
