/**
 * CHAT-UI-1 (live wiring) — confirm routing: interrupt vs queue (the autonomy-slider + carve-out core).
 *
 * Pure decision used by the live orchestrator to route a hard-stop-act confirm. The hard-stop FLOOR
 * holds at every slider position (brief §0): a confirm is always required + recorded. The slider only
 * changes WHEN it surfaces — Propose-and-Confirm interrupts each; Auto-Act batches POSTURE confirms
 * for batch clearing (brief §2.6 D1) EXCEPT the ratified BROAD carve-out (adverse/third-party recipient
 * interrupts individually) and EXCEPT a HARD incoherence (which can never auto-proceed). Non-posture
 * hard-stop acts (lock/send/tier/matter_identity/disposition/undo) never batch — they always interrupt.
 */
import type { RecipientClass } from './postureCoherence.js';
import { isBatchableRecipient } from './postureQueue.js';

export type SliderPosition = 'propose_and_confirm' | 'auto_act';

/** Brief §6: new matters default to Propose-and-Confirm. */
export const DEFAULT_SLIDER_POSITION: SliderPosition = 'propose_and_confirm';

export const SLIDER_LABEL: Record<SliderPosition, string> = {
  propose_and_confirm: 'Propose-and-Confirm',
  auto_act: 'Auto-Act',
};

export type ConfirmRoute = 'interrupt' | 'queue';

export interface RouteInput {
  /** Is this one of the posture trio (issuer/privilege/recipient)? Only those ever batch. */
  isPostureAct: boolean;
  /** Does the resolved triple carry a HARD incoherence? HARD can never auto-proceed. */
  hasHard: boolean;
  /** The resolved recipient (for the carve-out check); null for a non-posture act. */
  recipient: RecipientClass | null;
  sliderPosition: SliderPosition;
}

/** Decide whether a confirm interrupts now or queues for batch clearing. */
export function routeConfirmDecision(input: RouteInput): ConfirmRoute {
  if (input.hasHard) return 'interrupt'; // HARD blocks — never auto-proceed
  if (input.sliderPosition === 'propose_and_confirm') return 'interrupt';
  // Auto-Act:
  if (!input.isPostureAct) return 'interrupt'; // the hard-stop floor — non-posture acts never batch
  if (input.recipient !== null && !isBatchableRecipient(input.recipient)) return 'interrupt'; // D1 carve-out
  return 'queue'; // Auto-Act + batchable posture -> batch clearing
}
