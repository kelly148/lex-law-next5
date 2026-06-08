/**
 * REVIEWER-ASYNC-FANOUT-1 Inc 2 — long-timeout fetch for the LLM lane.
 *
 * Node's built-in fetch uses undici's default ~300s headers/body timeout. For a slow big-doc GPT-5
 * review that internal timeout fires (surfacing as a generic "fetch failed") BEFORE the per-call
 * AbortSignal can govern — the exact failure the GPT-5 latency diagnostic measured. llmFetch
 * attaches a long-timeout undici Agent as the fetch `dispatcher`, raising undici's internal
 * headers/body timeout above the longest application envelope (the 720s background reviewer lane),
 * so the per-call AbortSignal becomes the single authoritative timeout.
 *
 * Mechanism: Node's built-in fetch accepts a per-request `dispatcher` (an undici Dispatcher),
 * verified empirically. This is SCOPED to the LLM provider calls — no global fetch mutation, no
 * setGlobalDispatcher (which does not affect Node's built-in fetch anyway).
 *
 * GATED behind REVIEWER_ASYNC_ENABLED: when OFF, llmFetch is a transparent passthrough to the
 * GLOBAL fetch with no dispatcher, so the default path is byte-identical AND the adapters'
 * fetch-mocking tests (vi.stubGlobal('fetch', ...)) are unaffected.
 */
import { Agent, type Dispatcher } from 'undici';
import { isReviewerAsyncEnabled } from '../config/featureFlags.js';

// > the 720s reviewer-async AbortSignal envelope, so undici never pre-empts it (the AbortSignal
// governs). A connect timeout still bounds the initial TCP/TLS handshake.
const LLM_DISPATCHER_TIMEOUT_MS = 800_000;

let _dispatcher: Agent | null = null;

/** The long-timeout undici dispatcher (created once), or undefined when async mode is off. */
export function getLlmDispatcher(): Dispatcher | undefined {
  if (!isReviewerAsyncEnabled()) return undefined;
  if (_dispatcher === null) {
    _dispatcher = new Agent({
      headersTimeout: LLM_DISPATCHER_TIMEOUT_MS,
      bodyTimeout: LLM_DISPATCHER_TIMEOUT_MS,
      connectTimeout: 30_000,
    });
  }
  return _dispatcher;
}

/**
 * fetch for LLM provider calls: attaches the long-timeout dispatcher in async mode so the per-call
 * AbortSignal (not undici's ~300s default) governs; a transparent passthrough to the global fetch
 * otherwise.
 */
export function llmFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getLlmDispatcher();
  if (!dispatcher) return fetch(url, init);
  const withDispatcher: RequestInit & { dispatcher?: Dispatcher } = { ...init, dispatcher };
  return fetch(url, withDispatcher);
}
