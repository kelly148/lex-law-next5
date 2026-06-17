# External Triad-Review Packet — CONFLICT-TOGGLE-1 (in-app conflicts-checking on/off slider)

> **§3.1 FIRE CHECKPOINT — HALT for external triad review (GPT + an independent Claude) BEFORE implementation.** Self-contained: reviewable with **no repo access** — the gate code and the toggle precedent are inlined. Why it FIRES: it moves the only control that can **disable conflicts-checking** from an operator-only server env var to a one-click in-app slider — an **ethics/conflicts + access-control** posture change, hard to reverse in practice (a habit of toggling it off), not catchable by CI. The operator's decision to *add* the control is **firm** (Kelly, 2026-06-16); the FIRE gates only **how**, not **whether**.

- **Owner:** Kelly Satterwhite — managing attorney (VA + MD), title/real-estate + T&E practice; **not a developer**.
- **Builder:** the build CLI. This packet is the FIRE artifact; no code is written until the triad disposition returns.

---

## 1. Decision under review

Today the conflict-clearance gate is controlled only by a Railway **environment variable** `CONFLICT_GATE_ENABLED` (console-only; an operator must change a prod env var and restart). The request is to surface that control as a **persisted, owner-scoped Settings slider** in the app, next to the existing reviewer-enablement toggles. The hazard: a one-click in-app switch makes it materially easier to run the platform with **conflicts checking off**, on a system whose whole intake design (FOLD-L0-1, already live) treats conflicts-at-intake as **RPC-mandatory**. Get this wrong and an attorney can silently disable a malpractice/ethics control. The design must make "off" **deliberate, explicit, audited, default-safe, and reconciled with the mandatory-at-intake rule** — not a quiet switch.

---

## 2. Ready-to-paste reviewer prompt

> You are an independent senior reviewer (one of two different models). You did **not** write this. I'm Kelly — a managing attorney licensed in Virginia and Maryland running a title/real-estate and trusts-&-estates practice; I am **not** a developer. This is an attorney-supervised legal-AI drafting platform ("Whereas"). Pressure-test the design below **before any code is written**. Be adversarial; default to the safer option when unsure. Note: my decision to *add* this control is firm — review **how** to do it safely, not whether to have it.
>
> **What exists:** a deterministic conflict-of-interest check runs at matter intake. A clearance gate blocks four state transitions (disposition-cleared, lock-plan, advance-to-drafting, export/send) unless an affirmative `CLEARED` state holds (a check exists, it included a *confirmed* client party, no undispositioned blocker, and the check is current). That gate is governed by a single server env var `CONFLICT_GATE_ENABLED`; when off, the blocking behavior is bypassed (checks can still run advisory). Separately, the intake layer (already live, self-use) treats running conflicts-at-intake as mandatory.
>
> **Proposed change:** expose an in-app, per-user, persisted **Settings slider** to turn the conflict *gate* on/off, mirroring how reviewer-enablement toggles already work (a `settings.get` / `settings.update…` pattern over a per-user preferences blob, with telemetry on each change).
>
> **Decide and return, in order:**
> 1. **Top risks**, ranked — especially: does an in-app one-click off-switch create an ethics/malpractice exposure (running with conflicts checking disabled) that the console-only env var did not, and how should the design contain it?
> 2. **Persistence & precedence:** persisted DB-backed per-user setting vs. the env var — if both exist, which wins, and should a server-side env "force-on" be able to override a user "off" (an admin lock)? Should the setting be per-user or firm-global given a future second attorney?
> 3. **Audit:** every toggle (who/when/old→new) must be an immutable Matter-Record / settings-audit event given the ethics weight — confirm and specify what's logged.
> 4. **Anti-silent-off:** what labeling + confirm-step + persistent indicator are required so conflicts checking is never *silently* off (e.g., a standing banner while disabled)?
> 5. **Reconciliation with mandatory-at-intake:** is a global "off" a (a) pre-intake/self-use-only control, (b) a permanent operator escape hatch, or (c) something retired once the intake layer is fully client-facing? Pick the safe framing and the default.
> 6. **Scope of "off":** disable only the *blocking gate* (checks still run + record advisory results) vs. disable the whole conflicts feature (no check at all). Which is safe to offer, and should "no check at all" be forbidden?
> 7. **Default-safe behavior:** confirm the gate must default **ON** wherever conflicts data exists, and that "off" cannot be the resting state after, e.g., a data reset.
> 8. **Keep list** — what not to over-engineer for a 1–2 attorney practice.
> 9. **Bottom line:** proceed as-is / proceed with named changes / stop and rethink.
>
> **Constraints to respect (flag any violation):** the attorney is always the final decision-maker; conflicts checking is an ethics control, not a convenience feature; "off" must never be silent or unlogged; the blocking predicate (CLEARED-only) must not be weakened; default-safe (gate ON by default once conflicts data exists); fully reversible; additive only; single-operator now, light multi-user later (no RBAC/org).

---

## 3. Inlined code — the gate and the toggle precedent

### 3a. The env-only control today (`src/server/config/featureFlags.ts`)
```ts
export function isConflictGateEnabled(): boolean {
  return process.env['CONFLICT_GATE_ENABLED'] === 'true';
}
```

### 3b. The affirmative-clearance predicate (`src/server/db/queries/conflicts.ts`, ~235)
```ts
export async function evaluateConflictClearance(matterId, userId): Promise<ConflictClearance> {
  // returns { state: 'CLEARED' | <distinct non-cleared states>, reason }
  // CLEARED ⇔ a check exists ∧ it included a confirmed role='client' party
  //           ∧ no undispositioned BLOCKER ∧ current vs the party set.
}
// isConflictsCleared(...) === (evaluateConflictClearance(...).state === 'CLEARED')
```
The gate is **fail-closed**: the four guarded transitions proceed only on `CLEARED`, never on "not BLOCKED." (R2-PRE-CONFLICT-1 disposition, 2026-06-05 — binding.) `CONFLICT_GATE_ENABLED` is the on/off for whether that block is *enforced*.

### 3c. The toggle precedent to mirror (`src/server/procedures/settings.ts`)
```ts
export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await getUserPreferences(ctx.userId);
    return { reviewerEnablement: prefs.preferences.reviewerEnablement, /* … */ };
  }),
  updateReviewerEnablement: protectedProcedure
    .input(z.object({ reviewerEnablement: ReviewerEnablementSchema }))
    .mutation(async ({ ctx, input }) => {
      // WOULD_DISABLE_ALL_REVIEWERS guard — at least one reviewer must remain enabled
      if (!claude && !gpt && !gemini && !grok) throw PRECONDITION_FAILED;
      const updated = await updateReviewerEnablement(ctx.userId, input.reviewerEnablement);
      // emit telemetry per change …
      return { /* updated prefs */ };
    }),
});
```
Note the **safety-guard precedent** (`WOULD_DISABLE_ALL_REVIEWERS`): the reviewer toggles already refuse a state that would disable all reviewers. The conflict toggle's analogue is the anti-silent-off + default-ON guard.

---

## 4. Design forks for the triad (this packet surfaces; does not pre-decide)
- **FORK A — persistence/precedence:** DB-backed per-user setting (mirror `settings`) vs. env; precedence if both; whether an env "force-on" can lock the UI off-switch (admin override).
- **FORK B — granularity:** per-user vs. firm-global (matters for attorney #2).
- **FORK C — scope of off:** blocking-gate-only (advisory checks persist) vs. whole-feature-off (forbid the latter?).
- **FORK D — lifecycle vs. L0-1:** pre-intake/self-use control vs. permanent escape hatch vs. retired-once-client-facing.
- **FORK E — anti-silent-off UX:** label + confirm + standing "conflicts gate OFF" banner; audit every toggle.

## 5. Proposed implementation shape (pending forks)
Additive: a `conflictGateEnabled` field in the per-user preferences blob; `settings.get` returns it; a `settings.updateConflictGate` mutation (confirm-step + audit event); the gate reads the persisted setting (with the env precedence the triad chooses); default ON wherever conflicts data exists; a persistent UI indicator while off. No change to `evaluateConflictClearance` (the CLEARED predicate stays byte-for-byte). Reversible build-and-PR once the triad clears.

## 6. Document manifest (inlined above)
- This packet. Master-plan entry CONFLICT-TOGGLE-1 (design questions). R2-PRE-CONFLICT-1 disposition (the affirmative-clearance gate — binding). FOLD-L0-1 (conflicts-at-intake RPC-mandatory, live). `featureFlags.ts` / `conflicts.ts` / `settings.ts` excerpts (above).

---

**HALT.** packet ready for CONFLICT-TOGGLE-1. Awaiting the operator's external triad disposition before implementation.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
