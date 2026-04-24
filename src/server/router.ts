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
});

export type AppRouter = typeof appRouter;
