/**
 * landingRoot — LANDING-2
 *
 * Pure, side-effect-free decision for what the bare-domain GET / should serve,
 * given the LANDING_AT_ROOT_ENABLED flag and whether the request carries a valid
 * session (userId from the existing iron-session path). Kept free of Express/IO so
 * it is unit-testable without booting the server.
 *
 *   - flag OFF             -> 'passthrough'  (byte-identical to today: fall through to
 *                             express.static, which serves dist/index.html = the SPA)
 *   - flag ON + logged in  -> 'spa'          (authenticated visitor gets the app, no extra clicks)
 *   - flag ON + anonymous  -> 'landing'      (anonymous visitor gets the public landing page)
 */
export type RootServe = 'passthrough' | 'spa' | 'landing';

export function resolveRootServe(
  landingAtRootEnabled: boolean,
  userId: string | null | undefined,
): RootServe {
  if (!landingAtRootEnabled) return 'passthrough';
  return userId ? 'spa' : 'landing';
}
