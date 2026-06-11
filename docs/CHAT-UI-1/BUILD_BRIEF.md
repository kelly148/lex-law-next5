# CHAT-UI-1 — Build Brief v2 (build-ready)
Date: 2026-06-11. Supersedes the v1 design brief. Lane: Cowork authored (propose-never-commit); build is Code/Ultracode's.

## 0. Governing principle
A conversation thread is the primary surface. Structure appears as inline, glanceable affordances the conversation throws off - never as forms the attorney fills first. The product must feel as fluid as consumer web chat, minus copy-paste between tools and minus loss of context between turns.

THE HARD-STOP FLOOR (renamed from "five acts"). Certain acts always require an explicit, recorded human confirm at every autonomy-slider position, including full Auto-Act. Eight members in three groups:
- Original five: lock; tier a source; disposition a finding; send; matter identity.
- Posture trio (promoted in v2 - the v1 defect fix): issuer identity; privilege status; recipient class.
No slider position, natural-language phrasing, or clerical-floor inference may cross this floor.

## 1. The v1 defect being corrected
v1 filed issuer identity among "infer and proceed" and applied posture properties silently. That was wrong. Issuer, privilege status, and recipient class are posture-determinative - they decide whether a document is "privileged advice from counsel to our client" or "a non-privileged directive from the company to an adverse party." Same words, opposite legal exposure. A natural-language formatting request ("firm style, no branding, from the owners") must never silently set them. Posture props are propose-only and confirmed; cosmetic/structural props (doc type, typography, margins) remain infer-and-apply.

## 2. The posture-confirm rule (load-bearing spec)
Three posture properties carry a confirmed state per deliverable: issuer, privilege status, recipient class.
2.1 Per-property trigger (no significance classifier): privilege (boolean) and recipient class (closed enum) confirm on ANY value change - no classifier. Issuer (open-valued) confirms on change EXCEPT a provably cosmetic change, defined structurally as same legal entity AND same signing capacity.
2.2 Every confirm renders the FULL {issuer, privilege, recipient} triple and runs a coherence check on the whole triple, not just the changed field (the dangerous case is the field that did NOT change - e.g. privilege left "on" while recipient flips to adverse).
2.3 Egress backstop: send and lock run a coherence check on the resolved triple vs resolved recipient (a coherence check, not a drift-diff). The send ceremony separately re-surfaces actual recipients.
2.4 Recipient taxonomy (outward-exposure): internal/client -> co-counsel/agent -> neutral third party -> regulator/court -> adverse -> public. Any outward move re-confirms; an adverse recipient escalates to affirmative re-acknowledgment of the full triple.
2.5 Composition: a regenerate that moves posture and the posture confirm collapse into ONE bundled posture-diff confirmation package (no double-prompt). Provenance ledger records meaningful accepts only - actor, slider position, timestamp, trigger source, prior->new triple, resolved recipient at egress; log non-blocking dirty->confirmed transitions.
2.6 OPERATOR DECISIONS:
 - D1 = QUEUED. In Auto-Act, posture confirms stack ("N posture confirms waiting") for batch clearing.
 - D2 = SHIP IN v1. Build the full ~8-row incoherence table as enumerated data (auditable, unit-testable - not a classifier), each row HARD (block) or SOFT (warn); run it at every confirm and at the send/lock egress check, in addition to the forced full-triple display.
 - D1 CARVE-OUT (pending operator ratification - ask before finalizing): any set/transition to recipient = adverse/third-party interrupts INDIVIDUALLY and cannot be batch-cleared or "confirm-all'd," even though other posture confirms queue. Incoherent combos (e.g. privileged x adverse) are already HARD-blocked by the table.
2.7 Slider invariance: the floor holds at every slider position; egress checks bind to send/lock, which already hard-stop at full Auto-Act.

## 3. Design laws
1. Infer/surface/confirm - never gate - for cosmetic props only. Posture props are propose-only, never silently applied.
2. Structure is emergent, not entry. No form-first flows.
3. The hard-stop acts are the only hard stops: lock, tier, disposition, send, matter identity, issuer, privilege, recipient class.
4. Latency is shown, not hidden; the reviewer surface requires a trustworthy async substrate (Gate 0).
5. Advisory != instrument. Deliverables ledger + per-deliverable docs; closure = all dispositioned/sent.
6. Consequence-tier rendering discipline (load-bearing): any control that is a hard-stop act OR sets a posture prop renders as a visibly distinct, recorded, deliberate confirm, unreachable by clerical inference or chat phrasing. One shared component enforces this - the spine of Workstream 1.

## 4. Layout (3 zones, conversation-dominant)
Center = the thread (unified composer; messages; collapsible working-traces; deliverable cards; disposition cards); conversation-dominant even with the doc panel open - opening a document squeezes the LEFT rail, not the thread; thread keeps a strong min width; resizable; peek/overlay mode. Left rail = matter spine, glanceable read-only system-of-record with status badges; clicking jumps to the thread moment, never opens a form; distinguish facts from conclusions (mark inferred legal conclusions provisional until their input lands); the ledger stays in the rail. Right = focused deliverable; slides out and squeezes (does not cover) the thread; document, versions/diff, posture strip, sendability pre-flight (with the 2.3 coherence check), export.

## 5. Workstreams (build order)
GATE 0 (PREREQUISITE; build cannot start before it): JOB-RECOVERY-1 + trustworthy async reviewer display/fan-in (REVIEWER-ASYNC-DISPLAY-1) + durable execution (DISPATCHER-COMPLETE-1). Confirm landed/real before W1.
W1: consequence-tier rendering discipline + the section-2 posture model (closes the three BLOCKERs). Build the shared confirm component first. Also closes disposition-as-hard-stop (severity-graded; batch-acknowledge convergent low-severity), send-ceremony spec-lock (no NL-triggered send), source tier-vs-fetch split, disposition-aware regenerate. VERIFY THE ISSUER SCENARIO FIRST.
W2: provenance/audit ledger (PROVENANCE-LEDGER-1) - durable exportable per-act record + "human confirmed" badges surviving export/archival.
W3: context integrity - matter-identity ingestion confirm; undo semantics by band (UNDO-SEMANTICS-1); concurrency/stale-preview guard (CONCURRENCY-GUARD-1; block send on stale preview).
W4: review-session integrity - visible review-session contract; late results reopen an open item, never silently append/vanish; disposition-aware regenerate; finding cards carry ID, history, rationale, raw reviewer text, applied-version, supersession.
W5: missing-states + consolidation fidelity - attachment failure first-class AND taints the deliverable; research/source lane depth; DOCX/export render-validation; every card ships empty/loading/error/partial/stale/offline; consolidation-fidelity checklist (Preserved/Degraded/Lost) - nothing from the source multi-tool workflow silently Lost.
W6: fluidity & scale - doc-open thread dominance + resizable split; per-deliverable ledger rollup + advisory-package view; slider scope legible at the control (fixed "hard-stop acts always confirmed" end-stop; rename "Auto-Act" so it doesn't imply auto-send); accessibility + full-document focus mode with persistent chat dock.

## 6. Closed decisions (do NOT relitigate)
Thread-centric; one thread per matter; documents squeeze from the right. Autonomy slider ships (both behaviors); default Propose-and-Confirm for new matters. Deliverables ledger stays in the left rail (removal was rejected - affordance fix only). The hard-stop floor is uncrossable by slider, inference, or chat phrasing. D1 = queued; D2 = full incoherence table ships in v1 (HARD/SOFT rows); D3 = "hard-stop acts" rename. One D1 carve-out for adverse-recipient pending operator ratification.

## 7. Scope fence
Gated behind Gate 0 (confirmed real/landed) and operator ratification of the 2.6 D1 carve-out. Cowork does not commit; you are the sole committer; merges/deploys/flag-flips are operator-gated. Fresh branch off origin/main; never touch local main, review-report, or .claude/settings.json. Flag CHAT_UI_1_ENABLED, default OFF.

## 8. Open items
1. Gate 0 reality check - confirm JOB-RECOVERY-1 / REVIEWER-ASYNC-DISPLAY-1 / DISPATCHER-COMPLETE-1 status.
2. D1 carve-out (adverse-recipient individual interrupt) - ratify or strike.
3. D2 = SHIP (resolved).
4. Flag name CHAT_UI_1_ENABLED, default OFF.
