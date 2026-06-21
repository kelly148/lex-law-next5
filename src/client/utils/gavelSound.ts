/**
 * gavelSound.ts — NOTIFY-SOUND-1 (client-only, best-effort).
 *
 * Synthesizes a gavel striking three times via the Web Audio API — NO bundled/licensed audio asset.
 * Call playGavel() when a NEW unseen "something is ready" notification (draft-ready / review-ready)
 * arrives while the app is open.
 *
 * BEST-EFFORT, exactly like the producers it accompanies: it NEVER throws and NEVER blocks. Browsers
 * block audio before a user gesture — the AudioContext is created/resumed lazily and, if the browser
 * still refuses, playGavel() is a silent no-op. A draft or review is never delayed or broken by this.
 *
 * GATING (decided by the caller — AppShell): the sound only plays when NOTIFY_SOUND_ENABLED is ON and
 * the per-user notificationPreferences.sound toggle is ON. This module is pure synthesis; it holds no
 * policy and reads no flag.
 *
 * Voicing = "Soft block" (operator-selected): lower, rounded, unobtrusive. The other two voicings remain
 * in the map for a later change.
 */

interface Voicing {
  bodyFreq: number;
  bodyQ: number;
  bodyDecay: number;
  clickAmt: number;
  thumpFreq: number;
  thumpDecay: number;
  spacing: number;
}

type RapParams = Voicing & { gain: number };

const VOICINGS: Record<'courtroom' | 'sharp' | 'soft', Voicing> = {
  courtroom: { bodyFreq: 330, bodyQ: 5, bodyDecay: 0.13, clickAmt: 0.5, thumpFreq: 130, thumpDecay: 0.07, spacing: 0.2 },
  sharp: { bodyFreq: 470, bodyQ: 7, bodyDecay: 0.08, clickAmt: 0.95, thumpFreq: 150, thumpDecay: 0.05, spacing: 0.16 },
  soft: { bodyFreq: 280, bodyQ: 3.5, bodyDecay: 0.16, clickAmt: 0.22, thumpFreq: 115, thumpDecay: 0.09, spacing: 0.22 }, // SELECTED
};
const VOICING: keyof typeof VOICINGS = 'soft';

// Module-singletons: one AudioContext + one shared white-noise buffer, created lazily on first play.
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

type AudioContextCtor = typeof AudioContext;

/**
 * Lazily create/resume the AudioContext + the shared noise buffer. Returns null when audio is
 * unavailable (no Web Audio support, or no window — SSR/test) so the caller no-ops silently.
 */
function ensure(): { ctx: AudioContext; noiseBuf: AudioBuffer } | null {
  if (typeof window === 'undefined') return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume(); // best-effort: resumes once a user gesture has unlocked audio
  if (!noiseBuf) {
    const len = Math.floor(ctx.sampleRate * 0.3);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return { ctx, noiseBuf };
}

/** One gavel rap = wooden body (bandpassed noise) + crack (highpassed noise) + weight (low sine thump). */
function rap(audio: AudioContext, noise: AudioBuffer, t: number, p: RapParams, out: AudioNode): void {
  // wooden body: bandpassed noise
  const nb = audio.createBufferSource();
  nb.buffer = noise;
  const bp = audio.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = p.bodyFreq;
  bp.Q.value = p.bodyQ;
  const bg = audio.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.linearRampToValueAtTime(p.gain, t + 0.001);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + p.bodyDecay);
  nb.connect(bp).connect(bg).connect(out);
  nb.start(t);
  nb.stop(t + p.bodyDecay + 0.03);
  // crack: short highpassed noise
  const nc = audio.createBufferSource();
  nc.buffer = noise;
  const hp = audio.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  const cg = audio.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.linearRampToValueAtTime(p.clickAmt * p.gain, t + 0.0006);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  nc.connect(hp).connect(cg).connect(out);
  nc.start(t);
  nc.stop(t + 0.03);
  // weight: low sine thump
  const o = audio.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(p.thumpFreq, t);
  o.frequency.exponentialRampToValueAtTime(p.thumpFreq * 0.7, t + p.thumpDecay);
  const og = audio.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(0.5 * p.gain, t + 0.002);
  og.gain.exponentialRampToValueAtTime(0.0001, t + p.thumpDecay);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + p.thumpDecay + 0.03);
}

/**
 * Play the gavel ×3. Best-effort: any failure (no audio support, autoplay still blocked, etc.) is
 * swallowed — this never throws and never blocks the caller.
 */
export function playGavel(): void {
  try {
    const audio = ensure();
    if (!audio) return;
    const { ctx: a, noiseBuf: noise } = audio;
    const p = VOICINGS[VOICING];
    const comp = a.createDynamicsCompressor(); // soft limiter — avoids clipping on 3 stacked raps
    const master = a.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(a.destination);
    const t0 = a.currentTime + 0.04;
    const gains = [1.0, 0.9, 1.04];
    const jit = [1.0, 0.985, 1.01]; // slight per-rap variation = less robotic
    for (let i = 0; i < 3; i++) {
      rap(a, noise, t0 + i * p.spacing, { ...p, gain: gains[i]!, bodyFreq: p.bodyFreq * jit[i]! }, master);
    }
  } catch {
    /* best-effort: never throw */
  }
}
