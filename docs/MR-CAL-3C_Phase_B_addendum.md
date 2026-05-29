# MR-CAL-3C Phase B Formal Addendum — Local Push / PR / CI / Merge Completion

**Author of addendum:** Claude (Cowork), preparing the formal addendum at user direction **Date:** 2026-05-28 **Scope:** Formal close-out addendum for MR-CAL-3C Phase B remote-completion actions (branch push, pull request, CI, merge, post-merge verification). Execution performed by operator (Kelly) in local Windows PowerShell; this document records the evidence. **Halt classification:** None triggered. **Prior blocker (resolved):** MR-CAL-3C Phase B was blocked at GitHub credential authentication. Every supplied personal access token was rejected by GitHub with `401 Bad credentials`. Phase B remote actions could not proceed from the hosted environment.

---

## Disposition

| Close-out item | Disposition |
| :---- | :---- |
| Engagement | MR-CAL-3C Phase B — sequential reviewer comparison view, remote completion |
| Phase B status | Completed |
| Branch pushed to origin | Yes |
| Pull request created | Yes — PR \#47 |
| CI status | All checks passed (4 of 4\) |
| Merge performed | Yes — squash merge into `main` |
| Post-merge verification | Yes |
| Prior credential blocker | Resolved by changing the credential/execution path (see below) |
| Repository source changed during Phase B | No new source authored; the accepted Phase A commit was pushed unchanged |
| MR-CAL-3, CAL-7B, or other follow-on work | Not performed |

---

## Root-cause resolution of the credential blocker

The prior Phase B blocker was a credential-handoff failure, not a code, git, GitHub, or repository-permission problem. GitHub rejected the supplied tokens at the identity layer (`/user` → `401 Bad credentials`), before repository authorization was evaluated. Operator-side validation confirmed the supplied token values were malformed at capture (lengths of 80 and 44 characters, neither matching a valid GitHub PAT shape; trailing whitespace present), i.e. the credential was corrupted before transmission.

The resolution was to change the credential/execution path rather than supply another token to the hosted environment:

| Element | Before (blocked) | After (completed) |
| :---- | :---- | :---- |
| Execution location | Hosted sandbox | Operator local machine (same environment as credentials) |
| Credential type | Hand-carried personal access token | Browser-based OAuth via GitHub CLI (`gh auth login`) |
| Credential storage | Pasted per attempt | Windows keyring, managed by GitHub CLI |
| Token shape risk | Copy/whitespace/truncation at capture | Eliminated — no token string hand-carried |
| Resulting auth scopes | n/a (rejected) | `gist`, `read:org`, `repo`, `workflow`; active account `kelly148` |

No personal access token was hand-carried into the hosted environment for the completed run. Authentication was performed by the operator through the GitHub CLI browser device flow, logged in as `kelly148`.

---

## Branch handoff from implementation environment

The accepted Phase A implementation commit existed only in the implementation (hosted) environment. To complete Phase B locally while preserving the exact accepted commit object, the branch was exported as a git bundle and imported into a fresh local clone.

| Step | Evidence |
| :---- | :---- |
| Bundle produced (implementation env) | `git bundle create mr-cal-3c.bundle lex-next/mr-cal-3c-sequential-reviewer-comparison` |
| Bundle verification (local) | `git bundle verify` → "The bundle records a complete history."; hash algorithm sha1; "okay" |
| Bundle contained ref | `f7e4724b28908c52fd61222ef28dbfed98bb845f refs/heads/lex-next/mr-cal-3c-sequential-reviewer-comparison` |
| Local clone | `gh repo clone kelly148/lex-law-next5` |
| Branch import | `git fetch <bundle> lex-next/mr-cal-3c-sequential-reviewer-comparison:lex-next/mr-cal-3c-sequential-reviewer-comparison` → `[new branch]` |

---

## Pre-push verification

| Check | Expected | Observed | Result |
| :---- | :---- | :---- | :---- |
| `git rev-parse HEAD` | `f7e4724b28908c52fd61222ef28dbfed98bb845f` | `f7e4724b28908c52fd61222ef28dbfed98bb845f` | MATCH |
| `git rev-list --left-right --count origin/main...HEAD` | `0   1` (0 behind, 1 ahead) | `0   1` | MATCH |
| `git status --porcelain` | empty | empty | CLEAN |
| `git log --oneline -1` | accepted commit | `f7e4724 feat(cal): MR-CAL-3C — add sequential reviewer comparison view` | MATCH |

The local state exactly reproduced the accepted Phase A commit. The accepted commit was pushed unchanged; no source was authored, amended, or re-committed during Phase B.

---

## Push

| Item | Evidence |
| :---- | :---- |
| Command | `git push origin lex-next/mr-cal-3c-sequential-reviewer-comparison` |
| Result | `* [new branch]  lex-next/mr-cal-3c-sequential-reviewer-comparison -> lex-next/mr-cal-3c-sequential-reviewer-comparison` |
| Remote | `https://github.com/kelly148/lex-law-next5.git` |
| Credential used | GitHub CLI browser OAuth session (no PAT) |

---

## Pull request

| Item | Evidence |
| :---- | :---- |
| PR number | \#47 |
| URL | [https://github.com/kelly148/lex-law-next5/pull/47](https://github.com/kelly148/lex-law-next5/pull/47) |
| Base ← Head | `main` ← `lex-next/mr-cal-3c-sequential-reviewer-comparison` |
| Commits | 1 |
| Diff size | \+132 / −28 |
| Title | MR-CAL-3C — add sequential reviewer comparison view |

---

## Continuous integration

`gh pr checks 47 --watch` — final status: **All checks were successful.** 0 cancelled, 0 failing, 4 successful, 0 skipped, 0 pending.

| Check | Result | Elapsed |
| :---- | :---- | :---- |
| CI / Lint (push) | PASS | 21s |
| CI / Lint (pull\_request) | PASS | 39s |
| CI / Type Check \+ Tests (push) | PASS | 53s |
| CI / Type Check \+ Tests (pull\_request) | PASS | 45s |

---

## Merge

| Item | Evidence |
| :---- | :---- |
| Command | `gh pr merge 47 --squash --delete-branch` |
| Result | "Squashed and merged pull request kelly148/lex-law-next5\#47" |
| Merge method | Squash |
| `main` advance | `50dbf25..703ff40` (fast-forward) |
| Merge commit on main | `703ff40 feat(cal): MR-CAL-3C — add sequential reviewer comparison view (#47)` |
| Remote branch | Deleted |
| Local branch | Deleted; switched to `main` |

Files changed by the merge:

| File | Change |
| :---- | :---- |
| `src/client/components/ReviewPane.tsx` | modified (largest change; sequential reviewer comparison view) |
| `src/server/__tests__/mr2.s4e_e2e_behavioral.test.ts` | \+7 |
| `src/server/db/queries/phase4b.ts` | \+17 |
| `src/server/procedures/reviewSession.ts` | \+7 |
| Total | 4 files, \+132 / −28 |

---

## Post-merge verification

| Check | Observed | Result |
| :---- | :---- | :---- |
| `git checkout main` | "Already on 'main'" | OK |
| `git pull origin main` | "Already up to date." | OK |
| `git log --oneline -3` | `703ff40 (HEAD -> main, origin/main, origin/HEAD) feat(cal): MR-CAL-3C — add sequential reviewer comparison view (#47)`; `50dbf25 fix(cal): MR-CAL-2D — repair calibration scoring and fixtures`; `baa580b MR-CAL-2A Phase A business-decision calibration (#45)` | MATCH |
| New `origin/main` tip | `703ff40` | Advanced past prior `50dbf25` |

`main` now contains the MR-CAL-3C work as commit `703ff40`. `origin/main` advanced from the prior MR-CAL-2D merge commit `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183` to `703ff40`.

---

## Verification of no unauthorized work

| Category | Verification result |
| :---- | :---- |
| Source authored or modified during Phase B | None. The accepted Phase A commit was pushed unchanged. |
| Commit amended or recreated | No. Pushed SHA equals accepted SHA `f7e4724b`. |
| Branch created on remote | Yes — the authorized feature branch, then deleted post-merge. |
| Merge into main | Yes — authorized Phase B action via PR \#47. |
| Force-push / history rewrite | None. |
| Database access or writes | None. |
| Railway call | None. |
| Production / staging mutation | None. |
| Prompt / schema / parser / scoring / fixture modification | None. |
| MR-CAL-3, CAL-7B, or follow-on implementation work | Not performed. |
| Confidential client / user materials used | None. |

---

## Credential and artifact safety

| Safety item | Result |
| :---- | :---- |
| Personal access token hand-carried into hosted environment | No (root-cause change). |
| Credential value printed in this addendum | No. |
| GitHub CLI token storage | Windows keyring, managed by `gh`. |
| OAuth scopes granted | `gist`, `read:org`, `repo`, `workflow`. |
| Outstanding exposure action | A classic `ghp_…` token was exposed in an operator chat transcript during troubleshooting and was never used for this completion. Recommended action: revoke that token in GitHub → Settings → Developer settings → Tokens (classic). This is a hygiene action, not a Phase B dependency. |
| Confidential client / user materials used | None. |

---

## Mechanical carryforward facts

| Fact | Mechanical statement |
| :---- | :---- |
| MR-CAL-3C Phase B | Completed. Branch pushed, PR \#47 merged, `main` at `703ff40`. |
| Accepted commit fidelity | Pushed commit SHA equalled accepted commit SHA `f7e4724b` prior to squash merge. |
| Post-squash commit on main | `703ff40 feat(cal): MR-CAL-3C — add sequential reviewer comparison view (#47)`. |
| CI | 4 of 4 checks passed. |
| Credential path | Changed from hand-carried PAT into hosted sandbox to local execution with GitHub CLI browser OAuth. |
| Recurring failure class | The prior blocker was the same credential-handoff class as MR-CAL-2E-LIVE and MR-CAL-2G; resolved by removing the environment boundary the credential had to cross. |

---

## Halt log

No halt conditions triggered during MR-CAL-3C Phase B local completion.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.  
