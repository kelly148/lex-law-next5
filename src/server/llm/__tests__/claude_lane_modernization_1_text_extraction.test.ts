/**
 * CLAUDE-LANE-MODERNIZATION-1 — Anthropic response text extraction is robust to a leading `thinking` block.
 *
 * Regression lock for the sonnet-5 lite defect discovered by the G.3 rerun: adaptive-thinking Claude
 * models return `content = [{type:'thinking',...}, {type:'text',...}]`. claude-sonnet-5 runs adaptive
 * thinking by DEFAULT when the `thinking` parameter is omitted (which this adapter does), so the text is
 * NOT content[0]. The old `content[0]?.text ?? ''` read yielded '' -> empty content -> parse_error on
 * every review (confirmed live against the real API). The adapter now joins every text-type block.
 *
 * These are unit tests; no live network calls (fetch is stubbed).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { AnthropicAdapter, extractAnthropicText } from '../anthropic.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractAnthropicText — robust to non-text blocks', () => {
  it('returns the text block even when a thinking block leads (adaptive-thinking models, e.g. sonnet-5)', () => {
    expect(
      extractAnthropicText([{ type: 'thinking' }, { type: 'text', text: '[{"a":1}]' }]),
    ).toBe('[{"a":1}]');
  });
  it('is a strict no-op for a single text block (thinking-off models, e.g. opus-4-8 / opus-4-5)', () => {
    expect(extractAnthropicText([{ type: 'text', text: 'hello' }])).toBe('hello');
  });
  it('joins multiple text segments and skips interleaved non-text blocks', () => {
    expect(
      extractAnthropicText([{ type: 'text', text: 'a' }, { type: 'thinking' }, { type: 'text', text: 'b' }]),
    ).toBe('ab');
  });
  it('returns empty string for a thinking-only response, empty array, or missing content', () => {
    expect(extractAnthropicText([{ type: 'thinking' }])).toBe('');
    expect(extractAnthropicText([])).toBe('');
    expect(extractAnthropicText(undefined)).toBe('');
  });
});

describe('AnthropicAdapter.generate — leading thinking block (the sonnet-5 response shape)', () => {
  function stubResponse(content: Array<{ type: string; text?: string }>) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content,
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      text: async () => '',
    });
  }

  it('structured output: extracts + validates JSON from the text block, not the leading thinking block', async () => {
    vi.stubGlobal(
      'fetch',
      stubResponse([{ type: 'thinking' }, { type: 'text', text: '[{"id":1}]' }]),
    );
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-sonnet-5');
    const res = await adapter.generate({
      systemPrompt: 'review',
      userPrompt: 'go',
      structuredOutputSchema: z.array(z.object({ id: z.number() })),
      maxTokens: 16384,
      signal: AbortSignal.timeout(5000),
    });
    // Under the old content[0].text read this threw parse_error (JSON.parse('')).
    expect(res.content).toBe('[{"id":1}]');
  });

  it('free-form: rawText is the text block content, not the empty leading thinking block', async () => {
    vi.stubGlobal(
      'fetch',
      stubResponse([{ type: 'thinking' }, { type: 'text', text: 'the answer' }]),
    );
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-sonnet-5');
    const res = await adapter.generate({
      systemPrompt: 's',
      userPrompt: 'u',
      maxTokens: 16384,
      signal: AbortSignal.timeout(5000),
    });
    expect(res.content).toBe('the answer');
  });
});
