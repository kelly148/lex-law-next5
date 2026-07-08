# DEED-EXPORT-409-1 — dispatch (paste-ready for the Claude Code CLI)

**Author:** Cowork, 2026-07-06. **Type:** investigation → reversible build-and-PR (see the FIRE gate in §5). **Prod at finding:** `b92591e` (`main` = `0ccc06c`). **Reporter:** operator UAT, live on prod.

---

## 1. The finding (reproduced live on prod)

On the deed document page, the **"Download DOCX" button fails**: `GET /api/documents/{documentId}/export` returns **HTTP 409**, and the browser saves the JSON error body as `export.json`, surfaced to the user as a Chrome "Site wasn't available" download failure. No Word file is produced; no in-app message explains why.

**Reproduction (exact):**
1. Deed → Quick Deed → Deed of Gift.
2. Fill Grantor (`Walter Testvendor` / `an unmarried man`) and Grantee (`Hannah Testvendor` / `the Grantor's daughter`), Recording locality `Fairfax County`. No uploads. No legal description (it renders as a `[[ Legal description (VERBATIM) ]]` placeholder — correct, LIVE-9).
3. Generate draft → succeeds, lands on the deed document page (this run created matter `659b49bb-6563-4ccb-a823-f100c8500e2a`, doc `9354db35-30de-4fac-b28c-841e6ce7d664`).
4. Click **Download DOCX** → 409, `export.json` dumped, download fails.

Confirmed twice: browser download failure + a direct `fetch()` returning `status=409`. Console shows `GET …/export 409 (Conflict)`.

## 2. Root-cause analysis (from origin/main code inspection — NOT yet server-log confirmed)

The export route `GET /api/documents/:documentId/export` (`src/server/index.ts`, ~line 587 on origin/main) has **three** 409 gates:

- `CONFLICTS_NOT_CLEARED` — only if `isConflictGateEnabled()`; **off on prod** (FL-19), so unlikely.
- `EXPORT_BLOCKED` — sendability gate, only if `isSendabilityGateEnabled()`; **shadow/off on prod** by default, so unlikely.
- `DEED_EXPORT_BLOCKED` — the **LIVE-9 guard**, NOT flag-gated (always on). Fires when a document contains deed-operative language but `isSanctionedAgentDeed(documentType, provenance)` is false. Sanctioned = `documentType==='deed'` AND `provenance==='agent_assembled'` (`src/server/deed/deedDocTypeGuard.ts`). Emits a server-side `console.warn('[LIVE-9 deed-block] …')`.

Because the two flag-gated gates are off on prod, **`DEED_EXPORT_BLOCKED` is the leading hypothesis.** Provenance is defaulted at create only for deeds: `provenance = data.provenance ?? (data.documentType === 'deed' ? 'agent_assembled' : null)` (`src/server/db/queries/documents.ts:141`). So if the **Quick-Deed generate path writes the document with a `documentType` other than exactly `'deed'`** (e.g. a custom type + `customTypeLabel`, or a deed sub-type), provenance is `null`, `isSanctionedAgentDeed` returns false, and the deed agent's OWN output is blocked from export.

**Caveat (must resolve in step 1):** when Cowork probed the 409 body from the browser, it contained **none** of the four enumerated error codes (`DEED_EXPORT_BLOCKED` / `CONFLICTS_NOT_CLEARED` / `EXPORT_BLOCKED` / `NO_EXPORTABLE_VERSION`) — though a privacy harness may have blocked the read. So do **not** patch blind: confirm the actual gate and body server-side first. It is possible the 409 originates from a different layer (middleware/proxy) than the three handler gates.

## 3. Investigation step (do first; read-only)

1. Reproduce on prod (or a synthetic local run) and capture the **actual 409 response body + status** server-side, and check Railway logs for `[LIVE-9 deed-block]`. Confirm which gate fires.
2. Query the offending doc's `documentType` and `provenance` (doc `9354db35-…` / matter `659b49bb-…`, or a fresh repro). Determine whether the Quick-Deed generate path is writing `documentType==='deed'` + `provenance==='agent_assembled'`.
3. Confirm whether a **completed/finalized** deed exports 200 (isolates incomplete-draft vs. all-deeds). If all Quick-Deed drafts 409, this is a create-time tagging defect; if only incomplete ones do, there may be a second precondition.

## 4. Fix scope (two parts)

- **(A) Server — sanction the agent's own deed.** If the Quick-Deed path is mis-tagging `documentType`/`provenance`, correct it so a deterministic-deed-agent output is created as `documentType==='deed'`, `provenance==='agent_assembled'` and thus passes `isSanctionedAgentDeed`. **Do NOT weaken the LIVE-9 guard** — non-agent deed text must still be blocked; the fix is to classify the agent's own output correctly, not to loosen the scan. Add a regression test: a Quick-Deed-generated deed exports 200; a non-agent deed-text document still 409s `DEED_EXPORT_BLOCKED`.
- **(B) Front-end — graceful 409.** The "Download DOCX" affordance must never dump `export.json`. On a 409, render the block reason in-app (the `message` from the response) and either disable the button with a tooltip or show an inline notice. Never trigger a browser download of a JSON error body. Add a render/behavior test.

## 5. FIRE / governance gate (builder must decide before coding)

- If the fix is **(A) correct provenance/documentType tagging at create + (B) front-end 409 handling**, with the LIVE-9 semantics unchanged (non-agent deeds still blocked) — this is **reversible build-and-PR**, self-approve scope (Rule 8), auto-merge on green CI (Rule 15).
- If the fix requires **changing `isSanctionedAgentDeed`, `scanForDeedOperativeLanguage`, or the LIVE-9 export-scan semantics** — that touches a client-send-safety / deed-integrity invariant (roadmap invariant #1) and is a **§3.1 FIRE**: assemble the review packet and HALT for triad review before implementing.

## 6. Acceptance

- A Quick-Deed-generated deed exports a valid `.docx` (200, correct content-type, opens in Word).
- A non-agent document containing deed-operative language still returns `409 DEED_EXPORT_BLOCKED` (guard intact) — regression test proves it.
- The front-end never downloads `export.json`; a 409 renders the reason in-app; the button state reflects exportability.
- CI green (tsc + vitest + eslint).

## 7. Baseline reminder

Start with the 7-command repo-state baseline. `main` = `0ccc06c` (= prod `b92591e` + docs PR #546). This finding also **blocks FL-13** live verification (the deed DOCX can't be inspected until export works); FL-13's format fix is code-corroborated (`deed_export_format_1.test.ts` no-color/no-branding invariants) but not byte-level confirmed. Clean up synthetic matter `659b49bb-…` after.

---

*Cowork dispatch. The CLI is the sole builder; this brief authorizes investigation + the reversible fix in §4, with the §5 FIRE gate governing any change to the LIVE-9 sanctioned-deed semantics.*
