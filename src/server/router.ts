/**
 * Root tRPC app router — Lex Law Next v1
 *
 * All domain routers are merged here.
 * Phase 1 scope: auth router only.
 * Phase 2 scope: job router added.
 * Later phases add their routers here as they are implemented.
 *
 * R14 — No Duplicate Primitives: this is the single root router.
 * The AppRouter type exported here is used by the client for type inference.
 */

import { router } from './trpc.js';
import { authRouter } from './procedures/auth.js';
import { jobRouter } from './procedures/jobs.js';

export const appRouter = router({
  auth: authRouter,
  job: jobRouter,
  // Phase 3+: matter, document, template, material, review, etc.
});

export type AppRouter = typeof appRouter;
