// @vitest-environment jsdom
/**
 * gavelSound — NOTIFY-SOUND-1 best-effort contract.
 *
 * The cue must NEVER throw and must no-op silently when audio is unavailable / blocked (acceptance #4:
 * a draft or review is never delayed or broken by the sound). With a working AudioContext it synthesizes
 * three raps. Module singletons (ctx/noiseBuf) are reset per test via vi.resetModules + a fresh import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const realAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
const realWebkit = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

async function freshPlayGavel(): Promise<() => void> {
  vi.resetModules();
  const mod = await import('../gavelSound.js');
  return mod.playGavel;
}

function setAudioContext(ctor: unknown): void {
  (window as unknown as { AudioContext?: unknown }).AudioContext = ctor;
  (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = ctor;
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  (window as unknown as { AudioContext?: unknown }).AudioContext = realAudioContext;
  (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = realWebkit;
});

describe('playGavel — best-effort safety', () => {
  it('no-ops without throwing when Web Audio is unavailable', async () => {
    setAudioContext(undefined);
    const playGavel = await freshPlayGavel();
    expect(() => playGavel()).not.toThrow();
  });

  it('swallows a throwing AudioContext constructor (autoplay-blocked / unsupported)', async () => {
    setAudioContext(function ThrowingCtx() {
      throw new Error('blocked');
    });
    const playGavel = await freshPlayGavel();
    expect(() => playGavel()).not.toThrow();
  });

  it('synthesizes three raps (9 source starts) with a working AudioContext', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    class FakeParam {
      value = 0;
      setValueAtTime(): this { return this; }
      linearRampToValueAtTime(): this { return this; }
      exponentialRampToValueAtTime(): this { return this; }
    }
    class FakeNode {
      type = '';
      frequency = new FakeParam();
      Q = new FakeParam();
      gain = new FakeParam();
      start = start;
      stop = stop;
      connect(n: unknown): unknown { return n; } // return destination to allow .connect().connect()
    }
    class FakeAudioContext {
      sampleRate = 44100;
      currentTime = 0;
      state = 'running';
      destination = new FakeNode();
      resume = vi.fn();
      createBuffer(_c: number, len: number): { getChannelData: () => Float32Array } {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource(): FakeNode { return new FakeNode(); }
      createBiquadFilter(): FakeNode { return new FakeNode(); }
      createGain(): FakeNode { return new FakeNode(); }
      createOscillator(): FakeNode { return new FakeNode(); }
      createDynamicsCompressor(): FakeNode { return new FakeNode(); }
    }
    setAudioContext(FakeAudioContext);
    const playGavel = await freshPlayGavel();
    expect(() => playGavel()).not.toThrow();
    // 3 raps × 3 sources (body buffer, crack buffer, thump oscillator) each started once.
    expect(start).toHaveBeenCalledTimes(9);
  });
});
