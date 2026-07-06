# PERF-TRANSITIONS-1 (FL-11) — Route-Transition Render Stalls: Findings

**Engagement:** PERF-TRANSITIONS-1 (investigation + trivial-fix-only), OVERNIGHT-2026-07-06 batch item 12.
**Date:** 2026-07-05 (America/New_York). **Source:** origin/main. Read-only investigation.

## 1. Executive summary
The router is already well-architected: every interior page is `React.lazy` + shared `<Suspense>`. No heavy lib (`docx`/`mammoth`/`tesseract`/`unpdf`/`pdfium`/`handlebars`) is in the client bundle — server-only. WebGL `ShaderCanvas` is build-flag-gated (default OFF) and never mounts on ordinary transitions. So the hypothesized "wrap heavy routes in lazy" win is ALREADY done.

Observed symptoms are narrower:
- **Settings mid-scroll blank** → NO scroll reset on navigation; `<main>` is a persistent scroll container that keeps the previous page's scrollTop.
- **CDP screenshot timeouts** → intentional live-refresh polling (`refetchIntervalInBackground:true`) + `animate-spin` spinner during active draft/review + react-query default `refetchOnWindowFocus:true`. The page never reaches idle for the screenshot tool. Intentional behavior, not a defect.
- **First-visit stall on document route** → `DocumentDetail` chunk statically pulls `ReviewPane` (2,264 lines) + ~15 panels.

## 2. Router (Q1)
`src/client/App.tsx`: only `LoginPage` eager (`:22`); all others `lazy()` (`:24-36`). Shared `ProtectedLayout > AuthGuard > AppShell > Suspense(PageLoader) > page` (`:46-56`). Shell is preserved (not remounted) across transitions by React reconciliation at the same tree slot → flag queries don't refire per nav.
Heaviest pages: `DocumentDetail.tsx` 1,517 · `quickDeedCategoryForms.tsx` 1,009 · `SettingsPage.tsx` 902 · `QuickDeedPage.tsx` 707 · `MatterDetail.tsx` 706 · `InformationRequestPage.tsx` 613.

## 3. Heavy chunks (Q2)
No heavy vendor lib imported in `src/client` (confirmed by import search). Vite default code-splitting; each lazy import = own chunk. One minor: `LoginPage` eager + statically imports the WebGL harness (`ShaderCanvas` + `shaders.ts`) so it ships in the initial entry chunk even with shader flag OFF (flag only gates the mount). Minor code weight, not a transition cost. ShaderCanvas mounts only at login, during draft generation (`DocumentCanvas.tsx:220` gated isGenerating), and the deed gate (`DeedGatePanel.tsx:139`).

## 4. Settings mid-scroll blank (Q3)
SettingsPage is form-based, not heavy (5 card sections, no tall lists, no shader). Mechanism: NO scroll restoration/reset on route change anywhere (no ScrollRestoration/scrollTo/scroll-to-top — confirmed in App.tsx/main.tsx/AppShell.tsx), and the scroll container is the persistent `<main className="flex-1 bg-firm-light overflow-auto">` (`AppShell.tsx:357`), preserved across transitions. Navigating from a long scrolled page to Settings → `<main>` retains previous scrollTop → Settings renders mid-scroll; where content is shorter, viewport shows bare bg = blank band. Scroll-position artifact, not heavy rendering.

## 5. Hot components / continuous work (Q4)
Shell not remounted per transition; re-renders cheap. No app-wide context re-rendering the tree (`ConsequenceProvider` is inside ChatSurface only). `animate-*` are conditional loading indicators. CDP-timeout drivers (all job-scoped): `DocumentDetail.tsx:127-134` JobBanner poll, `ReviewPane.tsx:1256-1296`, `InformationRequestPage.tsx:517`, `MaterialsDrawer.tsx:404` — bounded polls with `refetchIntervalInBackground:true`, self-terminating at terminal state but firing every 3-5s + spinner while a job is in flight (intentional, DOC-PANE-LIVE-REFRESH-1/#328). `main.tsx:44-51` sets staleTime 30s but not `refetchOnWindowFocus` → default true applies globally.

## 6. Fixes
### TRIVIAL-AND-SAFE (pure no-op): essentially NONE remain (router already captured them). No un-memoized hot pure component worth memoizing on the transition path.
### RECOMMENDED NOW (low-risk; minor behavior change, not pure no-op):
- **Reset `<main>` scrollTop to top on pathname change** in `AppShell.tsx` (`:357`): give `<main>` a ref; `useEffect` keyed on `useLocation().pathname` sets `mainRef.current.scrollTop = 0`. Fixes the Settings mid-scroll blank + general land-mid-scroll jank. Blast radius: scroll offset only — cannot touch data/mutations/layout. Behavior changes from persist-across-nav to reset-to-top-on-nav (standard SPA behavior).
### STRUCTURAL (own brief):
- Sub-split `DocumentDetail` chunk (lazy-load ReviewPane + heavy panels behind React.lazy + local Suspense). Needs render-order/Suspense testing.
- CDP-timeout: harness×live-poll interaction. Prefer harness-side idle-wait change (option a) over ripping out intentional live-refresh. Options (b) automation/reduced-motion mode, (c) `refetchOnWindowFocus:false` global (changes data-freshness — not safe).

## 7. Bottom line
Already done: lazy interior routes, no heavy vendor lib client-side, shaders flag-gated off transition path, shell preserved. Do NOT redo.
Do now (item 12 trivial fix): reset `<main>` scrollTop on pathname change → fixes Settings mid-scroll blank.
Structural (brief each): DocumentDetail/ReviewPane chunk split; CDP screenshot idle-wait harness change.

Key files: `src/client/App.tsx`, `src/client/components/AppShell.tsx` (`:357` main scroll container), `src/client/pages/SettingsPage.tsx`, `src/client/pages/DocumentDetail.tsx` (`:51-63`, `:127-134`), `src/client/components/ReviewPane.tsx`, `src/client/config/shaderPolish.ts` (`:14` flag OFF), `src/client/main.tsx` (`:44`), `src/client/pages/LoginPage.tsx` (`:17-18`).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
