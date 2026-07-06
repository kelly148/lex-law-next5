/**
 * deedRecordability router — DEED-RECORDABILITY-FLAG-1.
 *
 * A single ungated probe exposing DEED_RECORDABILITY_ENABLED (default OFF) to the client, so the deed document
 * page can decide whether to mount the WHOLE recordability surface (the status strip + the recording-checklist
 * drawer + its DeedGatePanel / DeedSignoffPanel) as one unit. This is the CLIENT half of the one-switch: the
 * export route (src/server/index.ts) gates the D3 source-extracted-facts sign-off block on the SAME flag, so
 * display and enforcement move together.
 *
 * It does NOT touch the LIVE-9 DEED_EXPORT_BLOCKED guard, which stays on regardless (a sanctioned-deed defense,
 * not recordability supervision). OFF (Kelly's Stage-1 solo state): the deed page is document-first (instrument
 * + action row only); export never blocks on recordability. ON: current behavior exactly (each panel still
 * self-gates on its own flag). See featureFlags.ts isDeedRecordabilityEnabled for the full contract.
 */
import { router, protectedProcedure } from '../trpc.js';
import { isDeedRecordabilityEnabled } from '../config/featureFlags.js';

export const deedRecordabilityRouter = router({
  // Ungated probe so the client can decide whether to mount the deed recordability surface at all.
  isEnabled: protectedProcedure.query(() => ({ enabled: isDeedRecordabilityEnabled() })),
});
