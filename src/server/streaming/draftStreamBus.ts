/**
 * Draft stream bus (F3 token streaming, DRAFT-STREAMING-1) — an in-memory, per-job pub/sub for streamed
 * draft token deltas.
 *
 * Producer: the canonicalMutation runJob streaming overlay calls openDraftStream() before consuming the
 * adapter stream, publishDraftDelta() for each token delta, and closeDraftStream() in a finally.
 * Consumer: the SSE endpoint (GET /api/stream/draft/:jobId) subscribes — it replays the buffered prefix
 * then receives live deltas, and unsubscribes on client disconnect.
 *
 * This bus is DISPLAY-ONLY and EPHEMERAL: the durable draft is persisted by the two-transaction commit in
 * runJob, never from this buffer. It reaches no provider (it only relays strings), so it sits outside the
 * adapter chokepoint.
 *
 * Bounded + leak-free:
 *   - the replay buffer is capped at MAX_REPLAY_BYTES (a draft is far smaller); past the cap, live
 *     subscribers still get deltas but the replay prefix is marked truncated (a late subscriber replays
 *     the capped prefix then joins live).
 *   - an entry is deleted when its stream is terminal AND it has no subscribers, so nothing lingers after
 *     a job finishes and its viewers disconnect. A process crash drops the whole Map (in-memory only).
 */

type StreamStatus = 'open' | 'completed' | 'failed';

export interface DraftStreamSubscriber {
  /** Called for each replayed-then-live token delta. */
  onDelta: (text: string) => void;
  /** Called once when the stream reaches a terminal state (after replay, if already terminal). */
  onDone: (status: 'completed' | 'failed') => void;
}

interface StreamEntry {
  chunks: string[];
  bytes: number;
  truncated: boolean;
  status: StreamStatus;
  subscribers: Set<DraftStreamSubscriber>;
}

/** Cap the replay buffer (~2 MB). A draft is a few KB–tens of KB; this only bounds a pathological run. */
const MAX_REPLAY_BYTES = 2_000_000;

const streams = new Map<string, StreamEntry>();

/** Begin a stream for jobId (idempotent — a re-open resets the buffer for a retry attempt). */
export function openDraftStream(jobId: string): void {
  const existing = streams.get(jobId);
  if (existing && existing.subscribers.size > 0) {
    // Keep live subscribers attached but reset the buffer for the fresh attempt.
    existing.chunks = [];
    existing.bytes = 0;
    existing.truncated = false;
    existing.status = 'open';
    return;
  }
  streams.set(jobId, { chunks: [], bytes: 0, truncated: false, status: 'open', subscribers: new Set() });
}

/** Append a token delta + fan it out to live subscribers. No-op if the job has no open stream. */
export function publishDraftDelta(jobId: string, text: string): void {
  if (text.length === 0) return;
  const entry = streams.get(jobId);
  if (!entry || entry.status !== 'open') return;
  if (!entry.truncated) {
    const size = Buffer.byteLength(text, 'utf8');
    if (entry.bytes + size > MAX_REPLAY_BYTES) {
      entry.truncated = true; // stop buffering for replay; live subscribers still receive it below
    } else {
      entry.chunks.push(text);
      entry.bytes += size;
    }
  }
  for (const sub of entry.subscribers) {
    try {
      sub.onDelta(text);
    } catch {
      /* a misbehaving/closed subscriber must not break the producer or the other subscribers */
    }
  }
}

/** Mark a stream terminal, notify subscribers, and delete the entry if no one is attached. */
export function closeDraftStream(jobId: string, status: 'completed' | 'failed'): void {
  const entry = streams.get(jobId);
  if (!entry) return;
  entry.status = status;
  for (const sub of entry.subscribers) {
    try {
      sub.onDone(status);
    } catch {
      /* ignore subscriber errors */
    }
  }
  if (entry.subscribers.size === 0) {
    streams.delete(jobId);
  }
  // If subscribers are still attached, the entry is deleted when the last one unsubscribes (see below).
}

/**
 * Subscribe to a job's stream: synchronously replays the buffered prefix via onDelta, then either fires
 * onDone (if already terminal) or registers for live deltas. Returns an unsubscribe function. Returns null
 * if there is no stream for jobId (never started, or already finished and cleaned up) — the caller should
 * treat that as "nothing to stream" and fall back to polling.
 */
export function subscribeDraftStream(jobId: string, sub: DraftStreamSubscriber): (() => void) | null {
  const entry = streams.get(jobId);
  if (!entry) return null;

  // Replay the buffered prefix first so a late subscriber sees the draft-so-far.
  for (const chunk of entry.chunks) {
    try {
      sub.onDelta(chunk);
    } catch {
      /* ignore */
    }
  }

  if (entry.status !== 'open') {
    // Already terminal: signal done; nothing live to register. Clean up if we are the last reader.
    try {
      sub.onDone(entry.status);
    } catch {
      /* ignore */
    }
    if (entry.subscribers.size === 0) streams.delete(jobId);
    return () => { /* no-op: never registered */ };
  }

  entry.subscribers.add(sub);
  return () => {
    entry.subscribers.delete(sub);
    // If the stream already finished and we were the last viewer, drop the entry.
    if (entry.status !== 'open' && entry.subscribers.size === 0) {
      streams.delete(jobId);
    }
  };
}

/** Test/diagnostic helper: whether a (non-cleaned-up) stream exists for jobId. */
export function hasDraftStream(jobId: string): boolean {
  return streams.has(jobId);
}

/** Test-only: clear all streams (call in afterEach to avoid cross-test leakage). */
export function _resetDraftStreamsForTest(): void {
  streams.clear();
}
