/**
 * AutonomySlider — CHAT-UI-1 (live wiring) autonomy control.
 *
 * Toggles the slider that drives WHEN posture confirms surface: Propose-and-Confirm interrupts each;
 * Auto-Act batches batchable posture confirms ("N waiting") for batch clearing. The legend states the
 * fixed end-stop: the hard-stop acts ALWAYS confirm regardless of position (brief §0/§6). (W6 will
 * rename "Auto-Act" so it doesn't imply auto-send.)
 */
import React from 'react';
import { useConsequence } from './ConsequenceProvider.js';

export default function AutonomySlider(): React.ReactElement {
  const { sliderPosition, setSliderPosition, queueCount } = useConsequence();

  const btn = (active: boolean): string =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? 'bg-accent text-on-accent' : 'text-ink-secondary hover:bg-surface'
    }`;

  return (
    <div data-testid="autonomy-slider" className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-ink-hint">Autonomy</span>
      <div className="flex items-center gap-1 rounded border border-line bg-surface-2 p-0.5">
        <button
          data-testid="slider-propose"
          aria-pressed={sliderPosition === 'propose_and_confirm'}
          onClick={() => setSliderPosition('propose_and_confirm')}
          className={btn(sliderPosition === 'propose_and_confirm')}
        >
          Propose &amp; Confirm
        </button>
        <button
          data-testid="slider-autoact"
          aria-pressed={sliderPosition === 'auto_act'}
          onClick={() => setSliderPosition('auto_act')}
          className={btn(sliderPosition === 'auto_act')}
        >
          Auto-Act
        </button>
      </div>
      {queueCount > 0 && (
        <span data-testid="slider-queue-count" className="text-xs text-ink-hint">
          {queueCount} waiting
        </span>
      )}
      <span className="text-[10px] text-ink-hint" title="The hard-stop acts always confirm, at every position.">
        · hard-stops always confirm
      </span>
    </div>
  );
}
