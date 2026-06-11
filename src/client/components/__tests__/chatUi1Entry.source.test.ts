/**
 * CHAT-UI-1 W0 — the MatterDetail entry point to the conversation surface is flag-gated.
 *
 * Source guard (avoids mounting the full MatterDetail query surface): the Conversation link
 * is rendered only when trpc.chatUi.isEnabled reports enabled, and it targets the
 * matter-scoped chat route. When the flag is OFF, no entry renders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../pages/MatterDetail.tsx'),
  'utf8'
);

describe('MatterDetail conversation entry — flag-gated source guard', () => {
  it('reads the CHAT-UI-1 flag via trpc.chatUi.isEnabled', () => {
    expect(src).toContain('chatUi.isEnabled.useQuery');
    expect(src).toMatch(/chatEnabled\s*=\s*chatUiFlag\?\.enabled === true/);
  });

  it('renders the Conversation link only when the flag is enabled', () => {
    expect(src).toMatch(/chatEnabled\s*&&/);
  });

  it('targets the matter-scoped chat route', () => {
    expect(src).toContain('`/matters/${matterId}/chat`');
  });
});
