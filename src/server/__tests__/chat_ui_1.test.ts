/**
 * CHAT-UI-1 W0 — the entire conversation surface is gated behind CHAT_UI_1_ENABLED,
 * default OFF. This guards the flag accessor (default-OFF, exact-"true"-only) and the
 * wiring: the chatUi router exposes isEnabled, and the root router registers it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { isChatUi1Enabled } from '../config/featureFlags.js';

describe('CHAT-UI-1 flag default', () => {
  beforeEach(() => {
    delete process.env['CHAT_UI_1_ENABLED'];
  });

  it('defaults OFF when the env var is unset', () => {
    expect(isChatUi1Enabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    process.env['CHAT_UI_1_ENABLED'] = 'true';
    expect(isChatUi1Enabled()).toBe(true);
    process.env['CHAT_UI_1_ENABLED'] = 'TRUE';
    expect(isChatUi1Enabled()).toBe(false);
    process.env['CHAT_UI_1_ENABLED'] = '1';
    expect(isChatUi1Enabled()).toBe(false);
    delete process.env['CHAT_UI_1_ENABLED'];
  });
});

describe('CHAT-UI-1 router wiring — source guard', () => {
  const proc = fs.readFileSync(path.resolve(__dirname, '../procedures/chatUi.ts'), 'utf8');
  const root = fs.readFileSync(path.resolve(__dirname, '../router.ts'), 'utf8');

  it('the chatUi router exposes a flag-backed isEnabled query', () => {
    expect(proc).toContain('isChatUi1Enabled');
    expect(proc).toContain('isEnabled');
    expect(proc).toContain('protectedProcedure');
  });

  it('the root router registers the chatUi namespace', () => {
    expect(root).toContain('chatUiRouter');
    expect(root).toContain('chatUi:');
  });
});
