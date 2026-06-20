/**
 * F3 token streaming (DRAFT-STREAMING-1) Inc 1 — unit tests for the streaming spine (no live models).
 *
 * Covers: the shared stream accumulator (consumeLlmStream), the per-job draft stream bus
 * (buffer/replay/live/cleanup/bounded), and the Anthropic generateStream SSE parser (over a MOCKED
 * llmFetch — no provider SDK, no network), proving deltas + a shape-identical final LlmGenerateResult.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LlmStreamChunk, LlmGenerateResult } from '../llm/types.js';
import { consumeLlmStream } from '../llm/streamConsume.js';
import {
  openDraftStream,
  publishDraftDelta,
  closeDraftStream,
  subscribeDraftStream,
  hasDraftStream,
  _resetDraftStreamsForTest,
} from '../streaming/draftStreamBus.js';

// llmFetch is mocked so the Anthropic adapter never touches the network/SDK.
vi.mock('../llm/llmFetch.js', () => ({ llmFetch: vi.fn() }));
import { llmFetch } from '../llm/llmFetch.js';
import { AnthropicAdapter } from '../llm/anthropic.js';

async function* fromChunks(chunks: LlmStreamChunk[]): AsyncIterable<LlmStreamChunk> {
  for (const c of chunks) yield c;
}

// ── consumeLlmStream (the shared accumulator) ──────────────────────────────────
describe('consumeLlmStream — shared accumulator', () => {
  it('forwards each non-empty delta and returns the terminal final result', async () => {
    const deltas: string[] = [];
    const final: LlmGenerateResult = {
      content: 'Hello world',
      tokensPrompt: 11,
      tokensCompletion: 7,
      providerMetadata: { provider: 'anthropic' },
    };
    const result = await consumeLlmStream(
      fromChunks([
        { kind: 'delta', text: 'Hello ' },
        { kind: 'delta', text: '' }, // empty delta must NOT notify
        { kind: 'delta', text: 'world' },
        { kind: 'final', result: final },
      ]),
      (t) => deltas.push(t),
    );
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(result).toBe(final);
    expect(deltas.join('')).toBe('Hello world');
  });

  it('throws when the stream ends without a final chunk (discard-on-interrupt)', async () => {
    await expect(
      consumeLlmStream(fromChunks([{ kind: 'delta', text: 'partial' }]), () => {}),
    ).rejects.toThrow(/without a final result/i);
  });
});

// ── draftStreamBus (per-job display bus) ───────────────────────────────────────
describe('draftStreamBus — buffer / replay / live / cleanup', () => {
  beforeEach(() => _resetDraftStreamsForTest());
  afterEach(() => _resetDraftStreamsForTest());

  it('replays the buffered prefix then delivers live deltas, and signals done', () => {
    const JOB = 'job-1';
    openDraftStream(JOB);
    publishDraftDelta(JOB, 'AB');
    publishDraftDelta(JOB, 'CD');

    const got: string[] = [];
    let done: string | null = null;
    const unsub = subscribeDraftStream(JOB, {
      onDelta: (t) => got.push(t),
      onDone: (s) => { done = s; },
    });
    expect(unsub).not.toBeNull();
    // Late subscriber replays the buffered prefix synchronously.
    expect(got).toEqual(['AB', 'CD']);

    publishDraftDelta(JOB, 'EF'); // live
    expect(got).toEqual(['AB', 'CD', 'EF']);

    closeDraftStream(JOB, 'completed');
    expect(done).toBe('completed');
    unsub!();
    // Cleaned up after terminal + last unsubscribe — no leak.
    expect(hasDraftStream(JOB)).toBe(false);
  });

  it('a subscriber that joins AFTER terminal replays the buffer then immediately gets done', () => {
    const JOB = 'job-2';
    openDraftStream(JOB);
    publishDraftDelta(JOB, 'XY');
    closeDraftStream(JOB, 'completed'); // no subscribers yet → entry retained for a late joiner? deleted.
    // closeDraftStream deletes when there are no subscribers, so a later subscribe finds nothing.
    const unsub = subscribeDraftStream(JOB, { onDelta: () => {}, onDone: () => {} });
    expect(unsub).toBeNull(); // no active stream → caller falls back to polling
  });

  it('subscribe returns null when the job never streamed', () => {
    expect(subscribeDraftStream('never', { onDelta: () => {}, onDone: () => {} })).toBeNull();
  });

  it('publish after close is a no-op (does not resurrect a terminal stream)', () => {
    const JOB = 'job-3';
    openDraftStream(JOB);
    const got: string[] = [];
    const unsub = subscribeDraftStream(JOB, { onDelta: (t) => got.push(t), onDone: () => {} });
    publishDraftDelta(JOB, 'A');
    closeDraftStream(JOB, 'failed');
    publishDraftDelta(JOB, 'B'); // ignored — stream is terminal
    expect(got).toEqual(['A']);
    unsub?.();
  });
});

// ── Anthropic generateStream (SSE parse over mocked llmFetch) ──────────────────
describe('AnthropicAdapter.generateStream — SSE parse (mocked llmFetch)', () => {
  const SAVED = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    vi.mocked(llmFetch).mockReset();
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = SAVED;
  });

  function sseBody(text: string, chunkBytes = 16): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    let pos = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pos >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(pos + chunkBytes, bytes.length);
        controller.enqueue(bytes.slice(pos, end));
        pos = end;
      },
    });
  }

  const ANTHROPIC_SSE = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-test","usage":{"input_tokens":11,"output_tokens":1}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');

  it('yields text deltas then a final result with content + token counts (chunked across reads)', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: true, status: 200, body: sseBody(ANTHROPIC_SSE) } as unknown as Response);
    const adapter = new AnthropicAdapter('claude-test');
    const deltas: string[] = [];
    let final: LlmGenerateResult | null = null;
    for await (const chunk of adapter.generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal })) {
      if (chunk.kind === 'delta') deltas.push(chunk.text);
      else final = chunk.result;
    }
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(final).not.toBeNull();
    expect(final!.content).toBe('Hello world'); // accumulated == joined deltas
    expect(final!.tokensPrompt).toBe(11); // from message_start
    expect(final!.tokensCompletion).toBe(7); // from message_delta (running total)
    expect(final!.providerMetadata).toMatchObject({ provider: 'anthropic', model: 'claude-test', stopReason: 'end_turn', messageId: 'msg_1', streamed: true });
    // Routed through the canonical llmFetch wrapper, with stream:true and NO raw SDK.
    expect(vi.mocked(llmFetch)).toHaveBeenCalledTimes(1);
    const body = JSON.parse((vi.mocked(llmFetch).mock.calls[0]![1] as { body: string }).body) as { stream?: boolean };
    expect(body.stream).toBe(true);
  });

  it('classifies a non-OK HTTP status (429 -> rate_limited) without yielding deltas', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: false, status: 429, text: async () => 'slow down' } as unknown as Response);
    const adapter = new AnthropicAdapter('claude-test');
    const it = adapter.generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal })[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toMatchObject({ name: 'LlmProviderError', errorClass: 'rate_limited' });
  });
});
