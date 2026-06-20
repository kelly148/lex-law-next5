/**
 * F3 token streaming (DRAFT-STREAMING-1) Inc 3 — provider breadth (OpenAI, xAI, Gemini generateStream).
 *
 * Each adapter's generateStream is exercised over a MOCKED llmFetch (no provider SDK, no network): a fake
 * SSE body is parsed and asserted to yield text deltas then a terminal `final` whose LlmGenerateResult is
 * shape-identical to generate() (content + token counts). OpenAI/xAI are OpenAI-compatible (delta.content
 * + a usage chunk + [DONE]); Gemini uses candidates[].content.parts[].text + usageMetadata (no [DONE]).
 * Also covers the shared SSE line reader's chunk-boundary handling and a non-OK status classification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LlmGenerateResult, LlmStreamChunk } from '../llm/types.js';

vi.mock('../llm/llmFetch.js', () => ({ llmFetch: vi.fn() }));
import { llmFetch } from '../llm/llmFetch.js';
import { OpenAiAdapter } from '../llm/openai.js';
import { XaiAdapter } from '../llm/xai.js';
import { GoogleAdapter } from '../llm/google.js';
import { sseDataLines } from '../llm/sseParse.js';

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

async function collect(stream: AsyncIterable<LlmStreamChunk>): Promise<{ deltas: string[]; final: LlmGenerateResult | null }> {
  const deltas: string[] = [];
  let final: LlmGenerateResult | null = null;
  for await (const chunk of stream) {
    if (chunk.kind === 'delta') deltas.push(chunk.text);
    else final = chunk.result;
  }
  return { deltas, final };
}

const OPENAI_SSE = [
  'data: {"model":"gpt-test","choices":[{"delta":{"role":"assistant"}}]}',
  '',
  'data: {"model":"gpt-test","choices":[{"delta":{"content":"Hello "}}]}',
  '',
  'data: {"model":"gpt-test","choices":[{"delta":{"content":"world"}}]}',
  '',
  'data: {"model":"gpt-test","choices":[{"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"model":"gpt-test","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

const GEMINI_SSE = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}',
  '',
  'data: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":8,"thoughtsTokenCount":3}}',
  '',
].join('\n');

const SAVED = {
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
  XAI_API_KEY: process.env['XAI_API_KEY'],
  GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
};

beforeEach(() => {
  process.env['OPENAI_API_KEY'] = 'k';
  process.env['XAI_API_KEY'] = 'k';
  process.env['GOOGLE_API_KEY'] = 'k';
  vi.mocked(llmFetch).mockReset();
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('OpenAI / xAI generateStream — OpenAI-compatible SSE', () => {
  it('OpenAI: yields deltas + a final result with usage from the terminal chunk; requests stream:true', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: true, status: 200, body: sseBody(OPENAI_SSE) } as unknown as Response);
    const { deltas, final } = await collect(new OpenAiAdapter('gpt-test').generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal }));
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(final!.content).toBe('Hello world');
    expect(final!.tokensPrompt).toBe(12);
    expect(final!.tokensCompletion).toBe(8);
    expect(final!.providerMetadata).toMatchObject({ provider: 'openai', model: 'gpt-test', finishReason: 'stop', streamed: true });
    const body = JSON.parse((vi.mocked(llmFetch).mock.calls[0]![1] as { body: string }).body) as { stream?: boolean; stream_options?: { include_usage?: boolean } };
    expect(body.stream).toBe(true);
    expect(body.stream_options?.include_usage).toBe(true);
  });

  it('xAI: same OpenAI-compatible delta + usage shape', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: true, status: 200, body: sseBody(OPENAI_SSE.replace(/gpt-test/g, 'grok-test')) } as unknown as Response);
    const { deltas, final } = await collect(new XaiAdapter('grok-test').generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal }));
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(final!.content).toBe('Hello world');
    expect(final!.tokensCompletion).toBe(8);
    expect(final!.providerMetadata).toMatchObject({ provider: 'xai', streamed: true });
  });

  it('classifies a non-OK status (500 -> api_error) before any delta', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response);
    const it = new OpenAiAdapter('gpt-test').generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal })[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toMatchObject({ name: 'LlmProviderError', errorClass: 'api_error' });
  });
});

describe('Gemini generateStream — streamGenerateContent SSE (no [DONE])', () => {
  it('yields parts text deltas + a final result with usageMetadata token counts', async () => {
    vi.mocked(llmFetch).mockResolvedValue({ ok: true, status: 200, body: sseBody(GEMINI_SSE) } as unknown as Response);
    const { deltas, final } = await collect(new GoogleAdapter('gemini-test').generateStream({ systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal }));
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(final!.content).toBe('Hello world');
    expect(final!.tokensPrompt).toBe(12);
    expect(final!.tokensCompletion).toBe(8);
    expect(final!.tokensReasoning).toBe(3);
    expect(final!.providerMetadata).toMatchObject({ provider: 'google', model: 'gemini-test', finishReason: 'STOP', streamed: true });
    // streaming endpoint + sse transcoding requested
    expect(vi.mocked(llmFetch).mock.calls[0]![0]).toContain(':streamGenerateContent?alt=sse');
  });
});

describe('sseDataLines — shared transport reader', () => {
  it('reassembles data: payloads across byte-chunk boundaries and skips blanks/[DONE] passthrough', async () => {
    const payloads: string[] = [];
    for await (const p of sseDataLines(sseBody('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n', 7))) {
      payloads.push(p);
    }
    expect(payloads).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });
});
