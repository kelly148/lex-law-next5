# INSTR-2C — Written deferral records (R11)

INSTR-2C (Phase C, master injection into judgment-bearing non-draft roles) is dispositioned **outline-only** (triad 3/3 APPROVE WITH CHANGES; operator 2026-06-12). Two other judgment-bearing non-draft roles were **deferred**. Per the operator disposition, the deferral posture is **presumed permanently-legacy unless affirmatively re-proven** via the role's own §3.1 review.

This file is the standing record. **No code enables either role** — the INSTR-2C R1 allowlist (`MASTER_COMPOSABLE_CALLROLES` = `{draft, regenerate, chat, outline}` in `src/server/llm/assemblePrompt.ts`) excludes both by construction (their callRoles `analysis` and `matrix` are not in the set), and there is no flag that would enable them.

---

## Deferred — `matter_analysis` (callRole `analysis`)

**Status: deferred — presumed permanently-legacy. Re-entry requires its own §3.1 review.**

Dispatch: `matterIntake.generateAnalysis` (`src/server/procedures/matterIntake.ts`), `PRIMARY_DRAFTER_MODEL`, hardcoded non-decisional/non-sendable prompt; output is the internal, categorically non-sendable `matter_analysis` row that backs the conflicts-gated `lockPlan`.

**Disqualifying problems (why a firm "you are counsel" master must not be injected here):**
1. **Circular conflict-gate bind.** The analysis is an *input to establishing* conflict clearance (it backs `lockPlan`), not downstream of it — so the CHAT-INJ-1 / INSTR-2C R5 "inject only when the gate is cleared" precondition cannot apply non-circularly.
2. **Conflicts-disposition contamination.** The prompt deliberately enumerates this matter's parties and tags unconfirmed ones with `UNCONFIRMED_PARTY_PROMPT_MARKER` to prevent identity laundering. A master asserting representation of "our client" could cause the analysis to treat an unconfirmed party as a vouched client, contaminating the conflicts disposition `lockPlan` depends on.
3. **Non-decisional-framing collision.** The prompt is explicitly "you surface options, you do NOT decide; the attorney decides." A representational/advocacy master invites the model to render conclusions, colliding with the attorney-is-final-decision-maker posture and the plan-lock gate.

## Deferred — `information_request` / matrix (callRole `matrix`)

**Status: deferred — presumed permanently-legacy. Likely terminal state is a bounded non-advocacy intake assistant, never a firm-counsel master. Re-entry requires its own §3.1 review.**

Dispatch: `informationRequest.generate` (`src/server/procedures/informationRequest.ts`), `PRIMARY_DRAFTER_MODEL`, bounded "legal assistant" prompt; output is a question list the attorney edits and **exports / adds to client materials** — the only non-draft artifact designed to leave the firm and reach the client.

**Disqualifying problems:**
1. **Client-send / UPL.** A "you are counsel" persona on a client-bound artifact risks shifting neutral intake questions toward advice-bearing or commitment-implying phrasing in text the client receives.
2. **Premature attorney-client relationship.** A firm-counsel master may imply representations / an attorney-client relationship the firm has not vetted, in an outbound channel.
3. **Confidentiality.** A firm-wide master risks importing firm-internal framing or other-matter posture into questions sent outward.

---

## Permanently excluded (not "deferred") — `review` / `reviewer_feedback` / `evaluator`

Calibrated-reviewer roles are **permanently and structurally excluded** (not candidates for re-entry): the R1 allowlist makes their callRoles (`review`, `evaluator`) unreachable under any flag, and the MR-CAL calibration test pins (`src/server/llm/__tests__/instr_2b_core_master_selection.test.ts`, `src/server/llm/__tests__/instr_2b_title_routing.test.ts` — "calibration-preserving") are retained. A firm-advocacy master would corrupt the measured calibration baseline and break the reviewer/evaluator role-separation (surface options, never decide).
