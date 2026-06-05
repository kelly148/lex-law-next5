/**
 * R2-PRE-CONFLICT-1 Inc 2 — auto-create + screen-early the client party (source-analysis).
 *
 * BLOCK-until #2: the unconfirmed auto-party is fed into the check from creation AND cannot satisfy
 * clearance. This increment delivers the "fed into the check from creation" half (an unconfirmed
 * role='client' party is created so the deterministic check, which reads matter_parties, screens the
 * client immediately). The "cannot satisfy clearance" half is the Inc 3 gate. No test DB → source
 * analysis (the repo's established pattern).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 2: auto-create + screen-early', () => {
  const q = read('src/server/db/queries/matterParties.ts');
  const proc = read('src/server/procedures/matters.ts');

  it('ensureAutoClientParty creates an UNCONFIRMED auto-sourced role=client party', () => {
    const fn = q.slice(q.indexOf('export async function ensureAutoClientParty'), q.indexOf('export async function listPartiesForMatter'));
    expect(fn).toContain("role: 'client'");
    expect(fn).toContain("source: 'auto_from_clientName'");
    expect(fn).toContain('confirmed: false');
  });

  it('ensureAutoClientParty is idempotent + skips empty clientName', () => {
    const fn = q.slice(q.indexOf('export async function ensureAutoClientParty'), q.indexOf('export async function listPartiesForMatter'));
    // empty/whitespace clientName -> no-op
    expect(fn).toContain("if (name === '') return null");
    // already has a client party -> no-op (never overwrite / re-confirm)
    expect(fn).toContain("parties.some((p) => p.role === 'client')");
  });

  it('matter.create auto-creates the client party (screened from creation)', () => {
    const createBlock = proc.slice(proc.indexOf('create: protectedProcedure'), proc.indexOf('get: protectedProcedure'));
    expect(createBlock).toContain('ensureAutoClientParty(matter.id, ctx.userId, matter.clientName)');
  });

  it('matter.updateMetadata ensures the client party when clientName is set/changed', () => {
    const updBlock = proc.slice(proc.indexOf('updateMetadata: protectedProcedure'));
    expect(updBlock).toContain('if (input.clientName !== undefined)');
    expect(updBlock).toContain('ensureAutoClientParty(input.matterId, ctx.userId, updated.clientName)');
  });
});
