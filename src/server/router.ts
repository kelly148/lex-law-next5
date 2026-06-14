/**
 * Root tRPC app router — Lex Law Next v1
 *
 * All domain routers are merged here.
 * Phase 1 scope: auth router only.
 * Phase 2 scope: job router added.
 * Phase 3 scope: matter, document, version, materials, reference,
 *                settings, contextPipeline routers added.
 * Phase 4a scope: template router added; document4aRouter merged into document namespace.
 * Phase 4b scope: informationRequest, outline, reviewSession routers added.
 *
 * R14 — No Duplicate Primitives: this is the single root router.
 * The AppRouter type exported here is used by the client for type inference.
 */

import { router, mergeRouters } from './trpc.js';
import { authRouter } from './procedures/auth.js';
import { jobRouter } from './procedures/jobs.js';
import { matterRouter } from './procedures/matters.js';
import { documentRouter } from './procedures/documents.js';
import { document4aRouter } from './procedures/documents4a.js';
import { versionRouter } from './procedures/versions.js';
import { materialsRouter } from './procedures/materials.js';
import { referenceRouter } from './procedures/references.js';
import { settingsRouter } from './procedures/settings.js';
import { contextPipelineRouter } from './procedures/contextPipeline.js';
import { templateRouter } from './procedures/templates.js';
import { informationRequestRouter } from './procedures/informationRequest.js';
import { outlineRouter } from './procedures/outline.js';
import { reviewSessionRouter } from './procedures/reviewSession.js';
import { matterStateRouter } from './procedures/matterState.js';
import { sharedContextRouter } from './procedures/sharedContext.js';
import { reusableArtifactRouter } from './procedures/reusableArtifacts.js';
import { matterIntakeRouter } from './procedures/matterIntake.js';
import { practiceKbRouter } from './procedures/practiceKb.js';
import { orchestrationRouter } from './procedures/orchestration.js';
import { provisionProvenanceRouter } from './procedures/provisionProvenance.js';
import { lddKeyTermRouter } from './procedures/lddKeyTerm.js';
import { closurePackageRouter } from './procedures/closurePackage.js';
import { sendabilityGateRouter } from './procedures/sendabilityGate.js';
import { deadlineRouter } from './procedures/deadlines.js';
import { gateOverrideRouter } from './procedures/gateOverride.js';
import { chatUiRouter } from './procedures/chatUi.js';
import { chatDispatchRouter } from './procedures/chatDispatch.js';
import { chatCopilotRouter } from './procedures/chatCopilot.js';

export const appRouter = router({
  auth: authRouter,
  job: jobRouter,
  matter: matterRouter,
  document: mergeRouters(documentRouter, document4aRouter),
  version: versionRouter,
  materials: materialsRouter,
  reference: referenceRouter,
  settings: settingsRouter,
  contextPipeline: contextPipelineRouter,
  template: templateRouter,
  informationRequest: informationRequestRouter,
  outline: outlineRouter,
  reviewSession: reviewSessionRouter,
  // FOLD-L1-1 — Layer-1 Matter-State Engine read surface.
  matterState: matterStateRouter,
  // FOLD-L1-3 — shared-context conversation substrate read surface.
  sharedContext: sharedContextRouter,
  // FOLD-L1-4 — reusable-artifact registry + cross-matter invocation gate.
  reusableArtifact: reusableArtifactRouter,
  // FOLD-L0-1 — Layer-0 Matter Intake & Analysis (conflicts-at-intake + plan closure).
  matterIntake: matterIntakeRouter,
  // FOLD-KB-1 — Practice Knowledge Base (memos + per-PA prompts; surface-not-inject).
  practiceKb: practiceKbRouter,
  // FOLD-ORCH-1 — multi-model orchestration consolidation (read API + idempotent divergent
  // open-item registration; automate the labor, never the judgment).
  orchestration: orchestrationRouter,
  // FOLD-DRAFT-1 — provision provenance (record + read where each draft section came from;
  // recorded + surfaced, never auto-used in outbound assertions).
  provisionProvenance: provisionProvenanceRouter,
  // FOLD-DRAFT-1 / LDD — key-term dictionary + LOI-vs-draft comparison (record + read; flags
  // value drift in the current draft, never edits it, never auto-justifies an outbound assertion).
  lddKeyTerm: lddKeyTermRouter,
  // FOLD-DRAFT-1 / package — closing-package items + advisory completeness check (record + read;
  // surfaces missing required items, never finalizes/sends/locks; sending is FOLD-SEND-1).
  closurePackage: closurePackageRouter,
  // FOLD-SEND-1 — deterministic export-safety / outbound-readiness gate (read-only verdict in Inc 2;
  // enforcement + override + shadow logging at the export boundary land in Inc 3).
  sendabilityGate: sendabilityGateRouter,
  // FOLD-PM-1 — deadline / tickler engine (Phase 4). Read + lifecycle surface; gated behind
  // DEADLINE_ENGINE_ENABLED (default OFF, fully dormant); surfaces + records only, never acts.
  deadline: deadlineRouter,
  // CONFLICT-GATE-OVERRIDE-1 — attested per-matter, per-precondition override of the fail-closed intake
  // gate (conflicts clearance / identity verification). Additive; records an explicit attorney act the
  // gate consults; never a global toggle; re-arms on a material change.
  gateOverride: gateOverrideRouter,
  // CHAT-UI-1 — conversation-surface flag exposure (isEnabled), gated behind CHAT_UI_1_ENABLED
  // (default OFF). W0 scaffold is display-only; the surface is absent when the flag is off.
  chatUi: chatUiRouter,
  // CHAT-DISPATCH-1 — chat→model dispatch substrate (submitTurn), gated behind
  // CHAT_DISPATCH_ENABLED (default OFF). Routes a chat turn through the canonical chokepoint;
  // no master injection (that is INSTR Phase D). Refuses with PRECONDITION_FAILED when OFF.
  chatDispatch: chatDispatchRouter,
  // CHAT-COPILOT-1 (Inc 1) — persisted matter-scoped chat copilot lifecycle (create/read/delete/
  // legal-hold/marks/export), gated behind CHAT_COPILOT_ENABLED (default OFF, refuses when OFF).
  // Store-by-reference + isolation-guarded; the per-turn persistence path lands in Inc 2.
  chatCopilot: chatCopilotRouter,
});

export type AppRouter = typeof appRouter;
