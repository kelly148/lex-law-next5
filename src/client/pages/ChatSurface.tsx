/**
 * ChatSurface — CHAT-UI-1 conversation surface (W0 scaffold skeleton).
 *
 * The matter-scoped conversation thread is the PRIMARY surface (brief §0/§4): a three-zone,
 * conversation-dominant layout — center thread, left matter-spine rail, right
 * focused-deliverable slot. THIS IS A SKELETON: it establishes the layout and the flag/route
 * wiring only. No consequential controls render here yet — every hard-stop act and posture
 * change will route through the shared consequence-tier confirm component (W1, brief §3
 * law-6), and the reviewer/disposition surface is Gate-0-blocked (W4).
 *
 * Self-guards on CHAT_UI_1_ENABLED: when the flag is OFF (the default) this surface is
 * unreachable — no entry point renders (see MatterDetail) and a direct URL redirects to the
 * matter page, so nothing about the existing app changes.
 */
import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { trpc } from '../trpc.js';

export default function ChatSurface(): React.ReactElement {
  const { matterId } = useParams<{ matterId: string }>();
  const { data: flag, isLoading } = trpc.chatUi.isEnabled.useQuery();

  // The flag resolves async; treat unknown as OFF. While pending, show a neutral loader
  // rather than flashing the surface.
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-10">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }

  // OFF (default) or unknown -> the surface is inert and unreachable: redirect to the matter
  // page (or the dashboard if somehow unscoped). No existing surface changes.
  if (flag?.enabled !== true) {
    return <Navigate to={matterId ? `/matters/${matterId}` : '/matters'} replace />;
  }

  return (
    <div data-testid="chat-surface" className="flex h-full min-h-[70vh]">
      {/* LEFT — matter spine: glanceable, read-only system-of-record (brief §4). Skeleton. */}
      <aside
        data-testid="chat-zone-spine"
        className="w-72 flex-shrink-0 border-r border-line bg-surface-2 p-4 overflow-auto"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Matter spine</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          The established record for this matter — read-only here. Selecting an item will jump to its
          moment in the thread, never open a form.
        </p>
        <p className="mt-3 text-xs text-ink-hint">Matter {matterId}</p>
        <p className="mt-4 text-xs italic text-ink-hint">Spine content lands in a later increment.</p>
      </aside>

      {/* CENTER — the thread: the primary, conversation-dominant surface (brief §0/§4). Skeleton. */}
      <section
        data-testid="chat-zone-thread"
        className="flex-1 min-w-[28rem] flex flex-col bg-surface"
      >
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <MessageSquare className="w-4 h-4 text-accent" />
          <h1 className="text-sm font-medium text-ink">Conversation</h1>
          <span className="ml-2 text-xs text-ink-hint">CHAT-UI-1 · preview</span>
        </header>

        <div className="flex-1 overflow-auto px-5 py-6">
          <p className="text-sm text-ink-secondary">
            This is where the matter conversation will live. Structure — deliverables, findings,
            dispositions — appears inline as glanceable cards the conversation throws off, never as
            forms you fill first.
          </p>
          <p className="mt-3 text-xs text-ink-hint">
            Consequential acts (lock, send, tiering a source, dispositioning a finding, and the
            issuer / privilege / recipient posture) always require an explicit, recorded confirm.
            Those controls arrive with the shared confirm component in W1.
          </p>
        </div>

        {/* Composer placeholder — inert in the scaffold. No send control: send is a hard-stop act. */}
        <div className="border-t border-line px-5 py-4">
          <div
            aria-disabled="true"
            className="w-full select-none rounded border border-line bg-surface-2 px-3 py-2 text-sm text-ink-hint"
          >
            Conversation composer — arrives in CHAT-UI-1 W1.
          </div>
        </div>
      </section>

      {/* RIGHT — focused deliverable: slides out and squeezes the LEFT rail, never the thread
          (brief §4). Collapsed in the scaffold. */}
      <aside
        data-testid="chat-zone-deliverable"
        className="hidden xl:flex w-80 flex-shrink-0 flex-col border-l border-line bg-surface-2 p-4"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Deliverable</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          A focused document opens here — versions and diff, the posture strip, and the sendability
          pre-flight. Empty until a deliverable is open.
        </p>
      </aside>
    </div>
  );
}
