# Where client data lives, and why that is acceptable — ULTRABUILD-1 W8 skeleton (run-sheet G.4)

**The RPC 1.6 supervision file.** Every location client-identifying data touches, in one place, so accumulated
individual acceptances become a supervised boundary (audit Part C #5 / A-2(c)). This is a **skeleton** — the
CLI populated what has in-repo evidence; **`[K]` marks the cells only Kelly can answer** (contractual terms,
access controls, retention settings). Refresh quarterly with the provider-policy re-check (governance rule G.4).

| Location | Data type | Confidentiality basis | Access controls | Retention | Owner | Review cadence |
|---|---|---|---|---|---|---|
| **GitHub repo** `kelly148/lex-law-next5` (private) | Real client deeds + matter-named docs in `deed-materials/` (gitignored — local only) and the anonymized corpus; source | Private repo inside the RPC 1.6 boundary (a *decision*, per audit A-2(c)) | `[K]` — collaborators + OAuth apps with repo scope (run-sheet 0.6 GitHub access inventory); 2FA `[K]` | `[K]` (GitHub default) | Kelly | Quarterly |
| **Local machine** `C:\Users\Kelly\Documents\lex-law-next5-local` (+ ~28 worktrees) | The working clone; `deed-materials/` real client files (PII, gitignored) | Attorney's own device | `[K]` — disk encryption / device access | `[K]` | Kelly | Quarterly |
| **TiDB (prod DB)** via Railway | Matters, documents, versions, parties, materials, audit_events, egress ledgers | Managed DB provider | `[K]` — DB credentials, network scope; owner-scoping enforced app-layer (`ownerScope`) | `[K]` — TiDB backup/PITR config (run-sheet 0.1 restore drill) | Kelly | Quarterly |
| **Railway (prod host)** | Runtime env, logs, env vars (incl. provider keys) | Managed host | `[K]` — dashboard access, 2FA | `[K]` — log retention | Kelly | Quarterly |
| **OpenAI** (GPT reviewer/lite; intake) | Whatever the panel/reviewer sends per invocation (matter content) | **`[K]` — API-tier no-train/retention/ZDR/DPA terms NOT yet filed** (parked; audit QA-1) | Egress via the single audited broker (`egressClient.ts`); provider tracked per egress row | `[K]` | Kelly | Quarterly (G.4 provider re-check) |
| **Google** (Gemini reviewer/lite) | Panel/reviewer content | **`[K]` — API-tier terms NOT yet filed** | Same broker; allowlist `GROUNDED_CHAT_PROVIDERS` | `[K]` | Kelly | Quarterly |
| **xAI** (Grok reviewer) | Panel/reviewer content | **`[K]` — API-tier terms NOT yet filed** | Same broker | `[K]` | Kelly | Quarterly |
| **Anthropic** (Claude — primary drafter/reviewer/copilot) | Draft/reviewer/copilot content | **`[K]` — terms** (audit noted Anthropic as the one with the strongest posture, still unverified paper) | Same broker | `[K]` | Kelly | Quarterly |
| **NotebookLM / audit corpus** | Curated Tier-3 strategy/design corpus; some files carry real client identifiers (operator-reviewed, accepted) | Google-side tooling; recorded risk-acceptance (audit Part C #5) | `[K]` | `[K]` | Kelly | Quarterly |
| **Egress audit logs** (2 append-only ledgers) | `chat_egress_events` + the surface-agnostic egress ledger (EGRESS-CONTROL-PLANE-1): who/what/which-provider/decision, per send | GLBA vendor-oversight evidence; broker cannot dispatch without writing a row | Owner-scoped reads (`supervisionEgress.ts`); retained past matter close | Permanent (append-only; survives everyday delete) | Kelly | Quarterly |
| **Backups / DR** | DB backups (TiDB tier) + any local/offline copies | `[K]` | `[K]` | `[K]` — RPO/retention (run-sheet 0.1) | Kelly | Quarterly |

## The genuine content gap this doc must fill (flagged, not fabricated)

The **per-provider retention / no-train / ZDR / DPA terms** are **not yet written up anywhere** — they are
*referenced* (parked under the egress-control-plane engagement; a FOLD-GOV-1 acceptance item) but not filed. The
audit (QA-1) is explicit: the panel sends matter content to OpenAI/Google/xAI/Anthropic **today** on API-tier
defaults, and *"until filed, this is an undocumented reliance."* Filing each provider's current API-tier policy
(the citations ARE the RPC 1.6 / ABA 512 reasonable-efforts evidence) is a **Kelly-only** task — the CLI cannot
fabricate contractual terms. This is run-sheet **0.5** (provider policies).

## What is enforced in code (so the boundary is not only aspirational)

- **Single audited egress broker** (`egressClient.ts` / `auditedEgress.ts`): gate → synchronous audit write →
  fail-closed → single dispatch. A `recordDecision` failure aborts the send (no unlogged egress). An
  architecture test fails the build on a raw provider import or broker bypass.
- **Owner-scoping** enforced app-layer on every matter-scoped read/write (`ownerScope` chokepoint; a CI ratchet
  freezes inline owner filters).
- **NPI minimization**: wire/account/routing/payoff field names are never-persist + default-withheld
  (`chatCopilotPolicy.ts`, `chatCopilotConfig.ts`).
