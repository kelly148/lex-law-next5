/**
 * CHAT-UI-1 (live wiring) — formatting-request intent map (the hybrid issuer scenario).
 *
 * A DETERMINISTIC mapping of a small set of natural-language formatting requests to proposed changes
 * — NOT a significance classifier (which the brief bans). It only PROPOSES; the structural posture
 * triggers (issuerRequiresConfirm etc.) still decide confirm-vs-silent. So "firm style / no branding"
 * maps to cosmetic styling (applied silently) and "from the owners" maps to an issuer change (routed
 * to the structural issuer trigger -> a recorded confirm). This realizes the §1 issuer scenario
 * literally on the live surface; a richer NL layer can replace this map later without touching the
 * triggers.
 */
import type { Issuer } from './postureCoherence.js';

export type FormattingIntent =
  | { kind: 'cosmetic'; field: 'firmStyle' | 'branding'; value: boolean }
  | { kind: 'issuer'; issuer: Issuer };

export function interpretFormattingRequest(text: string): FormattingIntent[] {
  const t = text.toLowerCase();
  const intents: FormattingIntent[] = [];
  if (t.includes('firm style')) intents.push({ kind: 'cosmetic', field: 'firmStyle', value: true });
  if (t.includes('no branding')) intents.push({ kind: 'cosmetic', field: 'branding', value: false });
  if (t.includes('from the owners')) {
    intents.push({ kind: 'issuer', issuer: { entity: 'the owners', capacity: 'principal' } });
  }
  return intents;
}
