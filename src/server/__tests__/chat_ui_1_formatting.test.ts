/**
 * CHAT-UI-1 (live wiring) — formatting-request intent map (the hybrid issuer scenario, pure).
 */
import { describe, it, expect } from 'vitest';

import { interpretFormattingRequest } from '../../shared/posture/formattingRequest.js';

describe('interpretFormattingRequest', () => {
  it('maps "firm style, no branding, from the owners" to two cosmetics + an issuer change', () => {
    const intents = interpretFormattingRequest('firm style, no branding, from the owners');
    expect(intents).toContainEqual({ kind: 'cosmetic', field: 'firmStyle', value: true });
    expect(intents).toContainEqual({ kind: 'cosmetic', field: 'branding', value: false });
    expect(intents).toContainEqual({ kind: 'issuer', issuer: { entity: 'the owners', capacity: 'principal' } });
  });

  it('a purely cosmetic request proposes NO issuer change', () => {
    const intents = interpretFormattingRequest('firm style please');
    expect(intents.some((i) => i.kind === 'issuer')).toBe(false);
    expect(intents).toContainEqual({ kind: 'cosmetic', field: 'firmStyle', value: true });
  });

  it('an unrecognized request maps to nothing', () => {
    expect(interpretFormattingRequest('make it pretty')).toEqual([]);
  });
});
