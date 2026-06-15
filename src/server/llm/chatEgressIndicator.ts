/**
 * CHAT-COPILOT-2 A3 (Q4) — the egress indicator state for the copilot UI. PURE + deterministic.
 *
 * Distinguishes, for the attorney, exactly what is happening to document/material context on a turn:
 *   - provider_configured   — a provider is set but is NOT on the egress allowlist => nothing egresses
 *                             (the copilot cannot send until the operator allowlists it; the GLBA posture).
 *   - provider_allowlisted  — the provider IS allowlisted => the primary send is permitted.
 *   - selected_this_turn    — the attorney affirmatively selected attachments/materials to send this turn.
 *   - excluded              — egress is suppressed: a 'no_external' hold, or a sensitivity downgrade
 *                             (excludeFromGrounding), or no provider allowlist.
 *
 * The indicator is NEVER a substitute for the broker gate (egressClient) — it is the UX FACE of the same
 * fail-closed posture, so the attorney is not misled about what left the system.
 */
import { isGroundedChatProviderAllowed } from './chatCopilotConfig.js';
import type { ChatHoldFlag } from '../../shared/schemas/chatCopilot.js';

export type EgressIndicatorState =
  | 'provider_configured'
  | 'provider_allowlisted'
  | 'selected_this_turn'
  | 'excluded';

export interface EgressIndicatorInput {
  provider: string;
  /** The conversation's external-egress hold. */
  holdFlag: ChatHoldFlag;
  /** Sensitivity downgrade — grounding suppressed for the conversation. */
  excludeFromGrounding: boolean;
  /** Did the attorney affirmatively select attachments/materials for this turn? */
  hasSelection: boolean;
}

export interface EgressIndicator {
  states: EgressIndicatorState[];
  /** Whether the primary send is permitted (the broker would allow it). */
  canEgress: boolean;
}

export function computeEgressIndicator(input: EgressIndicatorInput): EgressIndicator {
  // A 'no_external' hold blocks ALL external egress — excluded, cannot send.
  if (input.holdFlag === 'no_external') return { states: ['excluded'], canEgress: false };

  // Fail-closed: a provider not on the allowlist is configured-but-blocked — nothing egresses.
  if (!isGroundedChatProviderAllowed(input.provider)) {
    return { states: ['provider_configured', 'excluded'], canEgress: false };
  }

  const states: EgressIndicatorState[] = ['provider_allowlisted'];
  if (input.excludeFromGrounding) {
    // The provider is allowed, but grounding (document/material context) is excluded for this conversation.
    states.push('excluded');
  } else if (input.hasSelection) {
    states.push('selected_this_turn');
  }
  return { states, canEgress: true };
}
