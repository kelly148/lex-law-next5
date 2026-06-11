/**
 * CHAT-UI-1 BA — backend-act procedures source guard (DB-dependent logic; no test DB here).
 *
 * The procedures hit the DB, so they are guarded structurally: each is gated behind assertEnabled(),
 * owner-checks the matter, and the tier act uses the AUDITED re-tier (setSourceAuthorityTier) per the
 * operator decision. The real DB mutation is deploy-time-verified.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const src = fs.readFileSync(path.resolve(__dirname, '../procedures/chatUi.ts'), 'utf8');

describe('chatUi backend-act procedures — source guard', () => {
  it('exposes the BA acts: listSources + setSourceTier (tier), lockDeliverable + unlockDeliverable (lock), recordSend (send)', () => {
    expect(src).toContain('listSources');
    expect(src).toContain('setSourceTier');
    expect(src).toContain('lockDeliverable');
    expect(src).toContain('unlockDeliverable');
    expect(src).toContain('recordSend');
  });

  it('the lock reuses origin "adopted" (no enum migration) with a NULL suggestion; send is audited via insertAuditEvent', () => {
    expect(src).toContain("origin: 'adopted'");
    expect(src).toContain('sourceSuggestionId: null');
    expect(src).toContain('insertAuditEvent');
  });

  it('the send act has NO outbound/egress (internal disposition only)', () => {
    expect(src).not.toMatch(/smtp|nodemailer|sendmail|mailgun|sendgrid|fetch\(|webhook|transporter/i);
  });

  it('the tier act uses the AUDITED re-tier (setSourceAuthorityTier), not the bare insert', () => {
    expect(src).toContain('setSourceAuthorityTier');
    expect(src).not.toContain('insertSourceAuthority'); // the audited path, not the no-audit insert
  });

  it('both new procedures are flag-gated and owner-check the matter', () => {
    // assertEnabled appears in every gated proc; assertMatterOwned guards the matter for both BA procs.
    expect((src.match(/assertEnabled\(\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(src).toContain('assertMatterOwned');
    expect(src).toContain('userId: ctx.userId');
  });
});
