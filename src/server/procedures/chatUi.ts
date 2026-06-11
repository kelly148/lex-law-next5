/**
 * CHAT-UI-1 — conversation-surface feature-flag exposure (W0 scaffold).
 *
 * The ENTIRE CHAT-UI-1 surface is gated behind CHAT_UI_1_ENABLED (default OFF). This tiny
 * router exposes the flag to the client read-only so the SPA can decide whether to render
 * the matter-scoped conversation surface and its entry point. When OFF (the default), the
 * client renders nothing new and every existing surface is unchanged.
 *
 * Mirrors the established flag-exposure pattern (deadline.isEnabled): a single
 * protectedProcedure query returning { enabled }. No other CHAT-UI-1 procedures exist yet
 * — the W0 scaffold is display-only. The posture model + consequence-tier confirm
 * component (W1) and the reviewer/disposition surface (Gate-0-blocked, W4) add their
 * server surfaces in later increments behind this same flag.
 */
import { router, protectedProcedure } from '../trpc.js';
import { isChatUi1Enabled } from '../config/featureFlags.js';

export const chatUiRouter = router({
  // Ungated read of the flag so the client can decide whether to mount the surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isChatUi1Enabled() })),
});
