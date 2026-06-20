// @vitest-environment jsdom
/**
 * F3 token streaming (DRAFT-STREAMING-1) Inc 2 — client incremental render.
 *
 * Covers BOTH flag states via a mocked EventSource:
 *   - streaming ON  -> deltas accumulate, isStreaming true, then `done` stops the caret (text kept)
 *   - streaming OFF -> the endpoint's immediate `done {no_stream}` means the hook never streams (skeleton)
 * plus the DocumentCanvas streaming render (text + caret vs. the unchanged skeleton) and a source-audit of
 * the DocumentDetail wiring (hook called before the early returns; canvas fed streamingContent/Active).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, renderHook, act } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import DocumentCanvas from '../DocumentCanvas.js';
import { useDraftStream } from '../../hooks/useDraftStream.js';

// ── mock EventSource ───────────────────────────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};
  constructor(url: string, _opts?: unknown) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const fn of this.listeners[type] ?? []) fn({ data });
  }
}

const noop = () => {};

describe('useDraftStream — client SSE subscription (mocked EventSource)', () => {
  const savedES = (globalThis as { EventSource?: unknown }).EventSource;
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = MockEventSource;
  });
  afterEach(() => {
    (globalThis as { EventSource?: unknown }).EventSource = savedES;
  });

  it('accumulates deltas (isStreaming true), then `done` stops the caret but keeps the text', () => {
    const { result } = renderHook(() => useDraftStream({ jobId: 'job-1', active: true }));
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0]!;
    expect(es.url).toContain('/api/stream/draft/job-1');

    act(() => es.emit('delta', JSON.stringify({ text: 'WHEREAS ' })));
    act(() => es.emit('delta', JSON.stringify({ text: 'the parties' })));
    expect(result.current.streamingText).toBe('WHEREAS the parties');
    expect(result.current.isStreaming).toBe(true);

    act(() => es.emit('done', JSON.stringify({ status: 'completed' })));
    expect(result.current.isStreaming).toBe(false); // caret off
    expect(result.current.streamingText).toBe('WHEREAS the parties'); // text retained until generating ends
    expect(es.closed).toBe(true);
  });

  it('flag OFF (immediate no_stream done): never enters the streaming state', () => {
    const { result } = renderHook(() => useDraftStream({ jobId: 'job-2', active: true }));
    const es = MockEventSource.instances[0]!;
    act(() => es.emit('done', JSON.stringify({ status: 'no_stream' })));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingText).toBe('');
    expect(es.closed).toBe(true);
  });

  it('does not connect when inactive or when there is no jobId', () => {
    renderHook(() => useDraftStream({ jobId: 'job-3', active: false }));
    renderHook(() => useDraftStream({ jobId: null, active: true }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('closes the connection on unmount (no leak)', () => {
    const { unmount } = renderHook(() => useDraftStream({ jobId: 'job-4', active: true }));
    const es = MockEventSource.instances[0]!;
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});

describe('DocumentCanvas — streaming render (both states)', () => {
  afterEach(() => cleanup());

  const base = {
    version: null,
    hasAnyVersion: false,
    isGenerating: true,
    statusLabel: '',
    isViewingCurrent: false,
    currentVersionNumber: null,
    onReturnToCurrent: noop,
  } as const;

  it('streaming ON: renders the draft-so-far + a caret, NOT the bare skeleton', () => {
    const { getByTestId, queryByTestId } = render(
      <DocumentCanvas {...base} streamingContent={'WHEREAS the parties agree'} streamingActive />,
    );
    expect(getByTestId('canvas-streaming').textContent).toContain('WHEREAS the parties agree');
    expect(queryByTestId('canvas-streaming-caret')).not.toBeNull();
    expect(queryByTestId('canvas-generating')).toBeNull(); // skeleton replaced
  });

  it('streaming done (text kept, caret off): text without caret', () => {
    const { getByTestId, queryByTestId } = render(
      <DocumentCanvas {...base} streamingContent={'WHEREAS the parties agree'} streamingActive={false} />,
    );
    expect(getByTestId('canvas-streaming').textContent).toContain('WHEREAS the parties agree');
    expect(queryByTestId('canvas-streaming-caret')).toBeNull();
  });

  it('streaming OFF (no streamed content): the existing skeleton renders unchanged (byte-for-byte)', () => {
    const { getByTestId, queryByTestId } = render(<DocumentCanvas {...base} />);
    expect(getByTestId('canvas-generating')).toBeTruthy();
    expect(queryByTestId('canvas-streaming')).toBeNull();
  });
});

describe('DocumentDetail wiring — source-audit', () => {
  const ROOT = path.resolve(__dirname, '../../../..');
  const doc = fs.readFileSync(path.join(ROOT, 'src/client/pages/DocumentDetail.tsx'), 'utf-8');

  it('calls useDraftStream BEFORE the early returns (Rules of Hooks / #310)', () => {
    const hookIdx = doc.indexOf('useDraftStream({');
    const firstReturnIdx = doc.indexOf("if (!documentId || !matterId) return");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(firstReturnIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(firstReturnIdx);
  });

  it('feeds the canvas streamingContent + streamingActive', () => {
    expect(doc).toContain('streamingContent={streamingText}');
    expect(doc).toContain('streamingActive={isDraftStreaming}');
  });

  it('only streams the first draft (no current version) of a draft/regeneration job', () => {
    const block = doc.slice(doc.indexOf('const streamingDraftJob ='), doc.indexOf('useDraftStream({'));
    expect(block).toContain("j.jobType === 'draft_generation' || j.jobType === 'regeneration'");
    expect(block).toContain('!doc?.currentVersionId');
  });
});
