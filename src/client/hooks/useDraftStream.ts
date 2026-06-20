/**
 * useDraftStream — F3 token streaming (DRAFT-STREAMING-1) Inc 2, client subscription.
 *
 * Opens an SSE connection to GET /api/stream/draft/:jobId while a draft job is generating, accumulates the
 * token deltas into a transient buffer, and exposes it for incremental render. It is a DISPLAY OVERLAY:
 * the authoritative draft is the persisted version surfaced by the existing job poll + version refetch
 * (F1) once the job is terminal. On the `done` event (or any error) it stops the caret and hands authority
 * back to that poll; the buffered text is cleared when the generating window ends (active -> false).
 *
 * Optimistic-open: it connects whenever a draft is generating. When streaming is OFF server-side (or the
 * job never streamed), the endpoint replies with a single `done {status:'no_stream'}` and the hook simply
 * never enters the streaming state — so the non-streaming experience is unchanged (skeleton, then poll).
 */
import { useEffect, useState } from 'react';

export interface UseDraftStreamArgs {
  /** The running draft job to stream; null = nothing to stream. */
  jobId: string | null;
  /** Only connect while a draft is actually generating (the skeleton window). */
  active: boolean;
}

export interface UseDraftStreamResult {
  /** The accumulated streamed text so far (empty until the first delta / when not streaming). */
  streamingText: string;
  /** True while deltas are actively arriving (drives the caret). False once `done`/error/idle. */
  isStreaming: boolean;
}

// State is keyed by the jobId it belongs to, so a new generation never shows the previous draft's text.
// All setState happens inside the SSE callbacks (never synchronously in the effect body) — the cleanup
// only closes the connection. The returned values gate on `state.jobId === jobId`, which yields '' for a
// fresh/idle/changed job until its own first delta arrives (the repo's set-state-in-effect discipline).
interface StreamState {
  jobId: string | null;
  text: string;
  streaming: boolean;
}

export function useDraftStream({ jobId, active }: UseDraftStreamArgs): UseDraftStreamResult {
  const [state, setState] = useState<StreamState>({ jobId: null, text: '', streaming: false });

  useEffect(() => {
    // Idle / unsupported environment (SSR, or jsdom without an EventSource polyfill): do nothing. The
    // gated return below already yields '' for this jobId until a delta arrives.
    if (!active || !jobId || typeof EventSource === 'undefined') return;

    let buffer = '';
    let closed = false;
    const es = new EventSource(`/api/stream/draft/${encodeURIComponent(jobId)}`, { withCredentials: true });
    const close = (): void => {
      if (closed) return;
      closed = true;
      es.close();
    };

    es.addEventListener('delta', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { text?: unknown };
        if (typeof data.text === 'string' && data.text.length > 0) {
          buffer += data.text;
          setState({ jobId, text: buffer, streaming: true });
        }
      } catch {
        /* ignore a malformed event rather than break the stream */
      }
    });

    es.addEventListener('done', () => {
      // Terminal (completed / failed / no_stream): stop the caret, keep the text until the generating
      // window ends and the persisted version takes over. Guard against clobbering a newer job's state.
      setState((s) => (s.jobId === jobId ? { ...s, streaming: false } : s));
      close();
    });

    es.onerror = (): void => {
      setState((s) => (s.jobId === jobId ? { ...s, streaming: false } : s));
      close();
    };

    return () => {
      close();
    };
  }, [jobId, active]);

  // Only surface text/streaming for the CURRENT job — a changed or idle jobId shows nothing stale.
  const matches = state.jobId === jobId && jobId !== null;
  return {
    streamingText: matches ? state.text : '',
    isStreaming: matches ? state.streaming : false,
  };
}
