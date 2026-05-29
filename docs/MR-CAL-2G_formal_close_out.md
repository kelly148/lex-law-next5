# MR-CAL-2G Formal Close-Out — Operator-Side OpenAI Credential / PowerShell Validation

**Author of close-out:** Claude (Cowork), preparing the formal close-out at user direction **Date:** 2026-05-28 **Scope:** Formal close-out only. Operator-side credential validation against `https://api.openai.com/v1/models` and `https://api.openai.com/v1/chat/completions`. No calibration cells executed. **Halt classification:** None triggered. **Evidence source:** Local Windows PowerShell session on Kelly's machine, `OPENAI_API_KEY` already persisted at User scope (length 164\) from MR-CAL-2E-LIVE setup, read via `[Environment]::GetEnvironmentVariable("OPENAI_API_KEY","User")` without re-paste.

---

## Formal close-out disposition

| Close-out item | Disposition |
| :---- | :---- |
| Engagement | MR-CAL-2G Operator-Side OpenAI Credential / PowerShell Validation |
| Engagement status | Completed |
| Halt condition triggered | No |
| Calibration cells executed | None |
| GPT calibration rerun performed | No |
| Repository / code implementation work performed | No |
| Manus rerun authorized by this engagement | No |

---

## Engagement intent (preserved)

The intent of MR-CAL-2G operator-side PowerShell validation was to determine which of the following caused the prior Manus `401 invalid_api_key` halts during MR-CAL-2G keyed rerun attempts:

1. The OpenAI API key itself is invalid (expired, revoked, malformed, mis-copied, or not actually an OpenAI key).  
2. The key is valid but lacks visibility to `gpt-4.1-mini`.  
3. The key is valid generally but lacks chat-completion access for `gpt-4.1-mini`.  
4. The key is valid for all three above; the failure is on the Manus side at credential ingestion / propagation.

This engagement does not attempt to determine GPT calibration quality, parse failure mode, scoring tightness, or fixture accuracy. Those questions remain blocked behind GPT-side evidence that this engagement does not produce.

---

## Probe steps and results

Three sequential probes were executed against `https://api.openai.com` from Kelly's local PowerShell, using the locally-persisted `OPENAI_API_KEY` env var. No probe wrote the key value to disk or to any artifact retained for this close-out.

| Step | Endpoint / call | Result | Evidence basis |
| :---- | :---- | :---- | :---- |
| 1 | `GET /v1/models` | PASS | 118 models returned in the response body. |
| 2 | Filter response from Step 1 for `id == "gpt-4.1-mini"` | PASS | `gpt-4.1-mini` was present in the visible model list. |
| 3 | `POST /v1/chat/completions` with `model = "gpt-4.1-mini"`, single user message, `max_tokens = 5` | PASS | Reply content was `OK`. |

Combined classification under the MR-CAL-2G interpretation framework: **Result 3 — credential valid locally, model visible, chat completion accepted.**

---

## Preserved substantive findings

1. The OpenAI API key persisted at User scope on Kelly's local Windows machine successfully authenticated against `https://api.openai.com/v1/models`.  
2. The model `gpt-4.1-mini`, identified by the prior MR-CAL-2G keyed rerun addendum as the target model for the narrow harness invocation, is visible to the key.  
3. A minimal `chat/completions` call against `gpt-4.1-mini` using the same key succeeded.  
4. The same key, when supplied through the Manus credential channel in prior keyed-rerun attempts, was reported by Manus's harness as failing with HTTP 401 `invalid_api_key` against the same OpenAI API path.  
5. The local validation result and the hosted Manus result are inconsistent for the same credential value.

---

## Mechanical carryforward facts

The following are recorded as mechanical facts only. They are not recommendations for a next engagement, fix, retest, or follow-on work.

| Fact | Mechanical statement |
| :---- | :---- |
| Key validity (operator side) | Valid locally as of run time. |
| Model visibility (operator side) | `gpt-4.1-mini` visible to the key. |
| Chat-completion acceptance (operator side) | Accepted locally with HTTP 200 and non-empty reply. |
| Manus-side outcome (prior) | HTTP 401 `invalid_api_key` on `/v1/models` readiness probe; all four cells (`gpt_lite:P8-T1`, `gpt_lite:P8-T6`, `gpt_lite:P8-T7`, `gpt_lite:P8-T10`) classified `NOT_RUN`; no raw or normalized output files created. |
| Cross-environment inconsistency | The same credential value produced PASS locally and FAIL inside the hosted Manus sandbox. |
| GPT calibration evidence | Still not obtained. `P8-T1__GPT` and `P8-T6__GPT` raw and normalized outputs remain absent. |
| Active runtime contract | Unchanged. Legacy JSON-array wrapper. Feedback-card detail embedded inside legacy suggestion body. |
| Scope boundaries observed | No prompt, parser, adapter, scoring, fixture, schema, UI, DB, Railway, GitHub write, production/staging mutation, MR-CAL-3, CAL-7B, or follow-on implementation work performed. |

---

## Calibration issue log

| Issue | Mechanical disposition |
| :---- | :---- |
| `P8-T1__GPT` parse failure (from MR-CAL-2E-LIVE) | Still recorded. No new GPT evidence obtained by this engagement. |
| `P8-T6__GPT` substantive preservation failure (from MR-CAL-2E-LIVE) | Still recorded. No new GPT evidence obtained by this engagement. |
| GPT stability | Still not established. No new GPT evidence obtained by this engagement. |
| Manus credential ingestion | Mechanically inconsistent with operator-side validation for the same credential value. Recorded as an unresolved cross-environment inconsistency, not as a GPT calibration finding. |

---

## Verification of no unauthorized work

| Prohibited category | Verification result |
| :---- | :---- |
| Repository files modified | No repository files were modified. |
| Branch created | No branch created. |
| Commit created | No commit created. |
| GitHub write API call | No GitHub write API call performed. |
| Database access or writes | No database access or writes performed. |
| Railway call | No Railway call performed. |
| Production / staging mutation | No production or staging mutation performed. |
| Prompt / schema / parser / adapter / scoring / fixture / UI modification | None performed. |
| Calibration cells run | None. The harness was not invoked. |
| MR-CAL-3, CAL-7B, or follow-on implementation work | Not performed. |
| Manus rerun authorized | No. The next Manus engagement should be a narrow credential-ingestion / environment propagation diagnostic, not a GPT calibration rerun. |
| Confidential client / user materials used | No. |

---

## Credential and artifact safety

| Safety item | Result |
| :---- | :---- |
| Credential value printed to console | No. The probe printed only key length (164) and per-step PASS/FAIL booleans. |
| Credential value re-pasted in this session | No. The probe read `OPENAI_API_KEY` from User-scope env via `[Environment]::GetEnvironmentVariable`. |
| Credential value written to any retained artifact | No. No transcript, log, JSON, CSV, or report contains the key value or any substring sufficient to reconstruct it. |
| Credential value transmitted off-machine | Only as the `Authorization: Bearer …` HTTP header to `https://api.openai.com` during the three probe steps. No other destination. |
| First / last characters of key disclosed | No. |
| Raw provider response body retention | The probe held responses in memory only and did not persist them to disk. |
| Confidential client / user materials used | No. The chat-completion payload was the literal string `Return exactly OK.` |

---

## Halt log

No halt conditions triggered during MR-CAL-2G operator-side PowerShell validation.

---

## Manus-handoff result block (operator-side, key-omitted)

The following text is the verbatim Manus-handoff block produced by the probe at run time. It is the exact text to be supplied to Manus through normal channels. The credential value is not included and must be supplied separately through the credential channel.

```
Operator-side PowerShell validation:
- /v1/models: PASS
- gpt-4.1-mini visible: PASS
- minimal chat completion using gpt-4.1-mini: PASS
- Credential value will be supplied separately through credential channel.
- Conclusion: credential is valid locally. If Manus still returns 401 invalid_api_key, issue is Manus credential ingestion / propagation, not OpenAI key validity.
```

---

## References

| Reference | Source |
| :---- | :---- |
| Prior MR-CAL-2E-LIVE local run | Run id `20260528T122851Z`; results at `outputs/mr_cal_2e_results_20260528T122851Z.{json,csv}` inside the MR-CAL-2E-LIVE handoff bundle. |
| Prior MR-CAL-2F findings | Reconstruction of accepted MR-CAL-2E GPT results from preserved artifacts not feasible; historical MR-CAL-2A artifact showed GPT P8-T1 substantive failure after wrapper normalization and GPT P8-T6 as not-run / empty output. |
| Prior MR-CAL-2G keyed rerun | OpenAI readiness probe returned HTTP 401 `invalid_api_key`; cells `gpt_lite:P8-T1`, `gpt_lite:P8-T6`, `gpt_lite:P8-T7`, `gpt_lite:P8-T10` classified `NOT_RUN`; no raw or normalized output files produced. |
| Operator-side probe (this engagement) | Local Windows PowerShell, three sequential HTTPS calls to `https://api.openai.com`; all three PASS. |

End of formal close-out. Any content below this line is platform-injected and not part of the engagement output.  
