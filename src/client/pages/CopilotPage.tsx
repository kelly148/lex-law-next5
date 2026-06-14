/**
 * CopilotPage — CHAT-COPILOT-1 (Copilot UI): the matter copilot surface.
 *
 * A NEW surface, DISTINCT from the CHAT-UI-1 /chat scaffold: a persisted, matter-scoped copilot with a
 * conversation LIST + a THREAD view, wired to the already-built, triad-reviewed backend (Inc 1-4).
 * Self-guards on CHAT_COPILOT_ENABLED (default OFF): when the flag is OFF the surface is unreachable —
 * a direct URL redirects to the matter page and no copilot query fires (the list query is `enabled`-
 * gated on the flag), so the existing app is byte-for-byte unchanged.
 *
 * HARD EXCLUSION: there is NO "promote to draft" / "send" / "finalize" / "client-ready" affordance on
 * this surface — promote-to-draft is a separate future FIRE engagement.
 */
import React, { useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { Plus, MessageSquare, ArrowLeft } from 'lucide-react';
import { trpc } from '../trpc.js';
import CopilotThread, { type CopilotConversation } from '../components/CopilotThread.js';

export default function CopilotPage(): React.ReactElement {
  const { matterId } = useParams<{ matterId: string }>();
  const { data: flag, isLoading } = trpc.chatCopilot.isEnabled.useQuery();
  const enabled = flag?.enabled === true;
  const utils = trpc.useUtils();
  const listQuery = trpc.chatCopilot.list.useQuery(
    { matterId: matterId ?? '' },
    { enabled: enabled && !!matterId },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-10">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }
  // OFF (default) or unknown -> the surface is inert and unreachable.
  if (!enabled) return <Navigate to={matterId ? `/matters/${matterId}` : '/matters'} replace />;
  if (!matterId) return <Navigate to="/matters" replace />;

  const conversations = (listQuery.data ?? []) as CopilotConversation[];
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const refetchList = (): void => { void utils.chatCopilot.list.invalidate({ matterId }); };

  const handleNew = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const conv = await utils.client.chatCopilot.create.mutate({ matterId });
      refetchList();
      setSelectedId(conv.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="copilot-surface" className="flex h-full min-h-[70vh]">
      {/* LEFT — conversation list + create */}
      <aside data-testid="copilot-list" className="w-72 flex-shrink-0 border-r border-line bg-surface-2 p-3 overflow-auto">
        <div className="mb-3 flex items-center gap-2">
          <Link to={`/matters/${matterId}`} className="text-ink-hint hover:text-ink" title="Back to matter">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-medium text-ink">Matter copilot</h1>
        </div>
        <button
          data-testid="copilot-new"
          type="button"
          onClick={() => void handleNew()}
          disabled={creating}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'New conversation'}
        </button>
        {error !== null && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {conversations.length === 0 ? (
          <p className="text-xs text-ink-hint">No conversations yet.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  data-testid="copilot-list-item"
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm hover:bg-surface ${selectedId === c.id ? 'bg-surface text-ink' : 'text-ink-secondary'}`}
                >
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-ink-hint" />
                  <span className="truncate">{c.title ?? 'Conversation'}</span>
                  {c.legalHold && <span className="ml-auto rounded bg-amber-100 px-1 text-[10px] text-amber-800">hold</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* RIGHT — selected thread, or an empty state */}
      <section className="flex-1 min-w-[28rem]">
        {selected ? (
          <CopilotThread
            key={selected.id}
            conversation={selected}
            matterId={matterId}
            onRefetch={refetchList}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div data-testid="copilot-empty" className="flex h-full items-center justify-center p-10 text-center">
            <p className="max-w-sm text-sm text-ink-hint">
              Select a conversation, or start a new one. The copilot drafts and analyzes internal work
              product for this matter — it never sends, files, or produces client-ready output.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
