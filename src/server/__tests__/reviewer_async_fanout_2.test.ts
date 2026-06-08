/**
 * REVIEWER-ASYNC-FANOUT-1 — Increment 2
 *
 * Background-lane timeout/undici raise. llmFetch attaches a long-timeout undici dispatcher to LLM
 * provider calls when REVIEWER_ASYNC_ENABLED, so undici's internal ~300s timeout no longer kills a
 * slow big-doc GPT-5 review before the per-call AbortSignal governs. The reviewer envelope rises to
 * 720s in async mode only (the sync path stays 300s).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getLlmDispatcher, llmFetch } from '../llm/llmFetch.js';

describe('llmFetch — flag-gated long-timeout dispatcher', () => {
  const original = process.env['REVIEWER_ASYNC_ENABLED'];
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env['REVIEWER_ASYNC_ENABLED'];
    else process.env['REVIEWER_ASYNC_ENABLED'] = original;
  });

  it('getLlmDispatcher returns undefined when async is OFF', () => {
    delete process.env['REVIEWER_ASYNC_ENABLED'];
    expect(getLlmDispatcher()).toBeUndefined();
  });
  it('getLlmDispatcher returns a dispatcher when async is ON', () => {
    process.env['REVIEWER_ASYNC_ENABLED'] = 'true';
    expect(getLlmDispatcher()).toBeDefined();
  });

  it('llmFetch is a transparent passthrough (NO dispatcher) when async is OFF', async () => {
    delete process.env['REVIEWER_ASYNC_ENABLED'];
    const mock = vi.fn((_url: string, _init?: RequestInit & { dispatcher?: unknown }) =>
      Promise.resolve(new Response('ok')),
    );
    vi.stubGlobal('fetch', mock);
    await llmFetch('https://example.com', { method: 'GET' });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[1]?.dispatcher).toBeUndefined();
  });
  it('llmFetch attaches the dispatcher when async is ON', async () => {
    process.env['REVIEWER_ASYNC_ENABLED'] = 'true';
    const mock = vi.fn((_url: string, _init?: RequestInit & { dispatcher?: unknown }) =>
      Promise.resolve(new Response('ok')),
    );
    vi.stubGlobal('fetch', mock);
    await llmFetch('https://example.com', { method: 'GET' });
    expect(mock.mock.calls[0]?.[1]?.dispatcher).toBeDefined();
  });
});

describe('Inc-2 wiring (source audit)', () => {
  it('the reviewer envelope rises to 720s in async mode only (sync stays 300s)', () => {
    const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');
    expect(src).toContain('timeoutMs: reviewerAsync ? 720_000 : 300_000,');
  });
  it('all four provider adapters route through llmFetch', () => {
    for (const f of ['openai', 'anthropic', 'google', 'xai']) {
      const src = readFileSync(resolve(`src/server/llm/${f}.ts`), 'utf8');
      expect(src, f).toContain("import { llmFetch } from './llmFetch.js';");
      expect(src, f).toContain('await llmFetch(');
    }
  });
});
