# Cumulative UAT Plan — Phases 1–3 (prod, operator-run)

**App:** https://lex-law-next-app-production.up.railway.app  · **Prod commit:** `0d6e5d0` (FOLD-L0-1 + KB-1; migrations 0007–0011 applied).
**Run by:** operator (Claude has no prod access). **Data:** SYNTHETIC ONLY — never real client data.
**Scope:** everything deployed-but-not-yet-acceptance-tested — Phase 1 (AUTH / ownership / GOV-1a audit / PERSIST), Phase 2 (Layer-1 matter-state engine), Phase 3 (FOLD-L0-1 conflicts + FOLD-KB-1 knowledge base).

**MUST-PASS rule:** the four scenarios tagged 🔴 **MUST-PASS** are safety-critical. **If any MUST-PASS FAILS, STOP** — do not continue; flag it to Claude for triage / rollback before any further use.

**How to record:** mark each scenario PASS / FAIL + notes. When done, give Claude the results; on all-green-per-engagement Claude records via Rule 16 and marks each engagement live-verified (Pattern 16).

---

## 0. Fixture setup (do once, up front)

**F0.1 — Primary account (A):** your existing `kelly` login.

**F0.2 — 🔴 Second account (B), for owner-scoping isolation.** There is no self-signup (single-tier auth), so provision B with the existing helper. This is a **deliberate prod-DB write** (one additive `users` row; reversible — you can `DELETE` it after). In a throwaway folder with `bcryptjs` + `mysql2` installed (PowerShell):
```
$env:DATABASE_URL  = '<prod TiDB connection string>'
$env:SMOKE_USERNAME = 'uat_owner_b'
$env:SMOKE_PASSWORD = '<throwaway password, >=12 chars>'
node scripts/create-smoke-user.mjs
```
Expected: `created dedicated smoke account "uat_owner_b"`. (Idempotent — safe to re-run.) Keep this password out of chat. You'll log in as B in a **separate incognito window** so A and B sessions don't collide.
**Cleanup after UAT:** `DELETE FROM users WHERE username='uat_owner_b';` (and its empty data, if any).

**F0.3 — Synthetic naming:** prefix everything `UAT …` (e.g., `UAT Estate – Synthetic`) so it's trivially identifiable for later cleanup (adds to LLN-PROD-CLEANUP-1).

---

# PHASE 1 — AUTH / OWNERSHIP / GOV-1a AUDIT / PERSIST

## 1.1 AUTH — login required
**Steps:** Open an incognito window → go to `https://lex-law-next-app-production.up.railway.app/matters`.
**Expected:** redirected to `/login` (not shown the matters list).
**PASS / FAIL:** ___  Notes: ___

## 1.2 AUTH — unauthenticated API returns 401
**Steps:** In the same logged-out incognito window, go directly to a protected API URL, e.g. `https://lex-law-next-app-production.up.railway.app/trpc/matterState.dashboard?batch=1&input=%7B%7D`. (Control: `/api/version` is public and returns JSON with a commit — that one should NOT 401.)
**Expected:** the protected endpoint returns **HTTP 401 / UNAUTHORIZED** (JSON error), not data.
**PASS / FAIL:** ___  Notes: ___

## 1.3 AUTH — login succeeds (account A)
**Steps:** Go to `/login` → enter A's username + password → **Sign in**.
**Expected:** lands on **Matters** dashboard; left nav shows Matters / Templates / Upload & Format / Settings / Sign out; your matters list renders.
**PASS / FAIL:** ___  Notes: ___

## 1.4 AUTH — changePassword rotates the credential
**Steps:** **Settings** → Change Password → enter current password + a new password → submit. Then **Sign out** → log in with the **OLD** password → then with the **NEW** password. *(Use a throwaway password and rotate back after, or just keep the new one noted securely — not in chat.)*
**Expected:** success message on change; **OLD password REJECTED**; **NEW password ACCEPTED**.
**PASS / FAIL:** ___  Notes: ___

## 1.5 AUTH — logout
**Steps:** **Sign out** → then try to navigate to `/matters`.
**Expected:** session cleared; `/matters` redirects to `/login`.
**PASS / FAIL:** ___  Notes: ___

## 1.6 🔴 MUST-PASS — Owner-scoping isolation (Account B cannot see A's data)
**Pre:** as **A**, ensure at least one matter exists (e.g. create `UAT Iso – A only` with a party and one practice memo via the KB panel). Note A's matter URL (`/matters/<id>`).
**Steps:**
1. Open a **separate incognito window**; log in as **B** (`uat_owner_b`).
2. Observe B's **Matters** list.
3. As B, paste **A's matter URL** (`/matters/<A-matter-id>`) into the address bar.
4. As B, open the **Practice Knowledge Base** panel on any matter B creates (or the matters list) and check for A's memos.
**Expected:**
- B's matters list is **EMPTY** (or shows only B's own) — **none of A's matters appear**.
- A's matter URL as B → **Not Found / access denied / redirect** (NOT A's matter data).
- B sees **none** of A's KB memos / parties / analyses anywhere.
**PASS / FAIL:** ___  Notes: ___  **(If FAIL → STOP. Owner-scoping breach is the worst-case; rollback candidate.)**

## 1.7 🔴 MUST-PASS — Audit completeness (GOV-1a): a material decision is written to audit_events
**Steps (as A):**
1. Create matter `UAT Audit – A`; open **Matter Intake & Analysis (Layer 0)**; add a **client** party `UAT AuditCo`; **Run conflicts check** (expect clear/no hits — that's fine).
2. **Generate analysis (Claude, single-lane)** → wait for it to render → then **Lock plan** (if the lock affordance is shown) OR disposition a conflict hit if you set one up. *(Any explicit attorney act: a conflict disposition, or a plan lock.)*
3. Open the **Matter State** panel → find the **decision log / disposition history** section.
**Expected:** the act you performed (e.g. `lock_plan` / a conflict `cleared`/`screened`/`declined`) appears in the decision log with **actor = attorney**, the **action**, and (for a blocker) the **rationale** — i.e. it was written to the audit record, **not silently dropped**.
**PASS / FAIL:** ___  Notes: ___  **(If FAIL → STOP. A dropped material-decision audit is a records-integrity failure.)**

## 1.8 PERSIST — soft-delete (archive) is reversible
**Steps (as A):** On the Matters list, click the **Archive** icon on a synthetic matter → confirm it leaves the default list → tick **Show archived** → confirm it reappears → **Unarchive** it → confirm it's back in the default list. (Repeat for a document inside a matter if the document list exposes archive.)
**Expected:** archive hides but **does not destroy**; unarchive fully restores. Reversible.
**PASS / FAIL:** ___  Notes: ___

## 1.9 PERSIST — hard-delete is operator-gated, never automatic
**Steps (as A):** Click the **Delete (trash)** icon on a synthetic matter. Observe whether it asks for an explicit confirmation.
**Expected:** deletion requires a **deliberate confirmation** (it does not delete on a single stray click); **nothing is auto-deleted** by the system on its own. *(Note exactly what the Delete affordance does — confirm-then-delete vs immediate — and whether deleted data is recoverable. Flag if Delete is immediate/irreversible with no confirm.)*
**PASS / FAIL:** ___  Notes: ___

---

# PHASE 2 — LAYER-1 MATTER-STATE ENGINE

## 2.1 Matter-state dashboard surfaces
**Steps (as A):** Open a synthetic matter with at least one document/analysis → open the **Matter State** panel.
**Expected:** a state summary renders — matter phase, sendability/send-status posture, **open items**, **source authority**, a **decision log**, and a **model-context-packet preview** (the block injected into model calls).
**PASS / FAIL:** ___  Notes: ___

## 2.2 The five explicit acts are deliberate + audited (never inferred)
**Steps:** In the Matter State panel, exercise the available explicit acts — e.g. **lock** a decision, set a **tier/designation**, **resolve/withdraw** a disposition item, **record send** (sent/withheld), and the **matter-identity** anchor. Each should require a single explicit **confirm** step.
**Expected:** every act takes a **deliberate confirm** (no act happens implicitly); after each, it appears in the **decision log** (audited). Tier/designation set by you forces "attorney" as the source.
**PASS / FAIL:** ___  Notes: ___

## 2.3 Source authority: operative → superseded
**Steps:** In the source-authority section, take a source that is **operative** and mark it **superseded** (e.g. when a newer version/material replaces it).
**Expected:** the source's lifecycle moves operative → **superseded**; the dashboard reflects the change; the model-context preview no longer treats the superseded source as operative.
**PASS / FAIL:** ___  Notes: ___

## 2.4 Open-item lifecycle: open → resolved, and auto cannot close an attorney-opened item
**Steps:**
1. Create/observe an **open item** (e.g. a blocker surfaced by review, or one you open).
2. **Resolve** it via the explicit act → confirm it moves open → **resolved**.
3. For an item **you opened**, trigger a regeneration / new pass and confirm the system does **NOT** auto-close it.
**Expected:** open → resolved only via an explicit attorney act; an **attorney-opened item is never auto-closed** by a later automated pass.
**PASS / FAIL:** ___  Notes: ___

## 2.5 Matter-state is injected into a model call ("no cold reviews")
**Steps:** On a matter that has clear state (parties, an operative document, an open blocker), run an LLM action (e.g. **Generate analysis**, or a review). Read the output.
**Expected:** the model's output **reflects current matter state** — it references the operative document / parties / phase / open blockers rather than starting "cold." *(Observed in the L0-1 analysis during the partial-deploy UAT; re-confirm here.)*
**PASS / FAIL:** ___  Notes: ___

---

# PHASE 3 — FOLD-L0-1 (CONFLICTS) + FOLD-KB-1 (KNOWLEDGE BASE)

## 3.1 🔴 MUST-PASS — Conflicts hard-block at advance-to-drafting (FOLD-L0-1)
**Fixture:** Matter **A1** = `UAT Conflict A` with a **client** party `UAT ZZZ Corp` (add it as a PARTY in the intake panel — the matter's client-name field alone is NOT conflict-checked). Matter **B1** = `UAT Conflict B` with an **adverse** party `UAT ZZZ Corp`.
**Steps (in B1):**
1. Open **Matter Intake & Analysis (Layer 0)** → confirm the **false-negative disclosure** banner is shown ("EXACT and NORMALIZED NAME matches … does NOT detect entity affiliations / aliases / unrecorded adverse parties …").
2. **Run conflicts check.**
3. Observe the hit; leave it **undispositioned**.
4. Click **New Document** → fill it → **Create Document**.
5. Try to disposition the blocker with an **EMPTY** rationale.
6. Enter a non-empty rationale → **cleared** → retry **Create Document**.
**Expected:**
- A 🔴 **BLOCKER** hit: "UAT ZZZ Corp is ADVERSE in this matter but your CLIENT in matter …" (role-aware crossing).
- Step 4: document creation is **REFUSED** — `CONFLICTS_BLOCKER_UNDISPOSITIONED: … must be cleared, screened, or declined before advancing this matter to drafting.`
- Step 5: empty rationale is **REJECTED** (disposition buttons disabled / "a blocker requires a recorded rationale").
- Step 6: after a rationale-backed **cleared**, document creation **SUCCEEDS**; the disposition + rationale are recorded (visible in the matter's decision log → audit_events).
**PASS / FAIL:** ___  Notes: ___  **(If FAIL → STOP. The conflicts hard-block is professional-responsibility-critical.)**

## 3.2 🔴 MUST-PASS — KB no-auto-inject + adopt tagging + cross-matter non-surfacing (FOLD-KB-1)
**Fixture:** Matter **K1** = `UAT KB Origin` (Estate Planning). Matter **K2** = `UAT KB Unrelated` (Real Estate).
**Steps:**
1. In **K1** → **Practice Knowledge Base** → confirm the **KB-derived disclosure** banner is shown. File a memo `UAT 1031 memo` (body, no client specifics). Confirm it lists under **This matter's memos** as **raw / matter_only / unverified** (most-private capture).
2. In **K1**, confirm the memo **surfaces** under **Potentially relevant memos** WITH a **currency warning** (e.g. "No authority recorded — uncheckable … NOT re-verified … re-verify before any outbound use"). Click **Adopt into this matter**.
3. Run a **Generate analysis** (or any LLM action) in K1 **without** adopting/abstracting anything else, and confirm the memo body is **NOT silently injected** into the model prompt (the analysis doesn't reproduce the memo unless you explicitly adopted/used it).
4. Open **K2** (unrelated matter) → **Practice Knowledge Base** → **Potentially relevant memos**.
**Expected:**
- Memo filed **raw / matter_only / unverified** (most-private).
- It **surfaces in K1** with the currency warning; **Adopt** records the adoption (and, if adopted into a document, marks that work product KB-derived/unverified).
- The memo is **NOT auto-injected** — surfacing ≠ injection; only an explicit adopt pulls it in.
- In **K2**, the K1 raw/matter_only memo **does NOT surface** (no cross-matter leakage of a non-abstracted, matter-only memo).
**PASS / FAIL:** ___  Notes: ___  **(If FAIL → STOP. Cross-matter leakage or silent injection is a confidentiality/send-safety breach.)**

## 3.3 KB lifecycle (supporting, not MUST-PASS) — abstraction gates firm-wide reuse
**Steps (as A, in K1):** On the raw memo, enter an **abstracted (de-identified) body** → **Abstract (attorney-attested)**. On the resulting abstracted memo, **Promote to firm-wide**. Try to promote a memo that is still **raw** (no abstraction).
**Expected:** abstraction creates an **abstracted** memo (raw left untouched); only an **abstracted** memo can be **promoted** to firm-wide; promoting a raw memo is **refused** (`ABSTRACTION_REQUIRED`). After firm-wide promotion, the abstracted memo may surface in an unrelated matter (K2) — the raw one never does.
**PASS / FAIL:** ___  Notes: ___

---

## Result summary (fill in)

| # | Scenario | MUST-PASS | PASS/FAIL | Notes |
|---|---|---|---|---|
| 1.1 | Login required | | | |
| 1.2 | Unauth API 401 | | | |
| 1.3 | Login succeeds | | | |
| 1.4 | changePassword rotates | | | |
| 1.5 | Logout | | | |
| 1.6 | **Owner-scoping isolation** | 🔴 | | |
| 1.7 | **Audit completeness** | 🔴 | | |
| 1.8 | Soft-delete reversible | | | |
| 1.9 | Hard-delete operator-gated | | | |
| 2.1 | Matter-state dashboard | | | |
| 2.2 | Five explicit acts audited | | | |
| 2.3 | Source operative→superseded | | | |
| 2.4 | Open-item; no auto-close | | | |
| 2.5 | Matter-state injection | | | |
| 3.1 | **Conflicts hard-block** | 🔴 | | |
| 3.2 | **KB no-auto-inject + isolation** | 🔴 | | |
| 3.3 | KB abstraction/promotion gate | | | |

**Engagement → scenarios (for Pattern-16 sign-off):**
- FOLD-AUTH-1 / ownership: 1.1–1.6
- FOLD-GOV-1a (audit): 1.7
- FOLD-PERSIST-1: 1.8–1.9
- Phase-2 Layer-1 (L1-1…L1-5): 2.1–2.5
- FOLD-L0-1: 3.1 (+ 1.7 disposition audit)
- FOLD-KB-1: 3.2–3.3

After execution: report PASS/FAIL per row to Claude. Any 🔴 FAIL = STOP + triage/rollback. On green, Claude records via Rule 16 and marks each engagement live-verified.
