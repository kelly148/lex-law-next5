/**
 * Root tRPC app router — Lex Law Next v1
 *
 * All domain routers are merged here.
 * Phase 1 scope: auth router only.
 * Later phases add their routers here as they are implemented.
 *
 * R14 — No Duplicate Primitives: this is the single root router.
 * The AppRouter type exported here is used by the client for type inference.
 */

import { router } from './trpc.js';
import { authRouter } from './procedures/auth.js';

export const appRouter = router({
  auth: authRouter,
  // Phase 2+: matter, document, job, template, material, review, etc.
});

export type AppRouter = typeof appRouter;
