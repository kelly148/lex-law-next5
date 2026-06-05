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
});

export type AppRouter = typeof appRouter;
