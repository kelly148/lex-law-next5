/**
 * CommandPalette — Whereas R2 #8 (narrow speed layer), increment 1.
 *
 * A NAVIGATION-ONLY command palette (Ctrl/Cmd-K). It jumps between pages and matters; it does NOT
 * trigger any material act (lock / disposition / adopt / send / override) — those stay deliberate,
 * mouse-driven acts per the deliberate-act thesis. "Optional; blocks nothing."
 *
 * Increment 1 (collision-safe nav core): global nav + type-to-filter jump-to-matter + contextual
 * matter routes (open matter, information requests). Distinct deep-jumps to the conflicts/export/
 * review panels are a deferred increment 2 (they touch shared page surfaces).
 *
 * Re-presents existing data (reuses matter.list; only fetched once the palette is opened) and existing
 * routes — no new backend. Mounted once in AppShell so it is available on every protected page.
 *
 * Rules of Hooks (#310 lesson): every hook runs before any early return. No blue (Whereas tokens).
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, FileText, Settings, FilePlus, FolderOpen, Inbox } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';

type Group = 'Navigate' | 'This matter' | 'Jump to matter';

interface Command {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export default function CommandPalette(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { matterId } = useParams();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Matter list powers jump-to-matter; only fetched once the palette is opened (zero footprint otherwise).
  const matters = trpc.matter.list.useQuery(undefined, { enabled: open });

  // Global Ctrl/Cmd-K toggles the palette (a navigation shortcut, not a material-act shortcut).
  // Resetting state here (an event handler) keeps the open-effect side-effect-only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setQuery('');
        setActive(0);
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus the search field when the palette opens (side-effect only — no state writes in the effect).
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const go = (to: string): void => {
    close();
    navigate(to);
  };

  // Build the command list (cheap; recomputed per render). Order: Navigate, This matter, Jump to matter.
  const commands: Command[] = [
    { id: 'nav-matters', group: 'Navigate', label: 'Matters', hint: 'All matters', icon: <FileText className="w-4 h-4" />, run: () => go('/matters') },
    { id: 'nav-templates', group: 'Navigate', label: 'Templates', icon: <FileText className="w-4 h-4" />, run: () => go('/templates') },
    { id: 'nav-upload', group: 'Navigate', label: 'Upload & Format', icon: <FilePlus className="w-4 h-4" />, run: () => go('/upload-format') },
    { id: 'nav-settings', group: 'Navigate', label: 'Settings', icon: <Settings className="w-4 h-4" />, run: () => go('/settings') },
  ];
  if (matterId) {
    commands.push(
      { id: 'matter-open', group: 'This matter', label: 'Open matter overview', icon: <FolderOpen className="w-4 h-4" />, run: () => go(`/matters/${matterId}`) },
      { id: 'matter-ir', group: 'This matter', label: 'Information requests', icon: <Inbox className="w-4 h-4" />, run: () => go(`/matters/${matterId}/information-requests`) },
    );
  }
  for (const m of matters.data ?? []) {
    const client = m.clientName ?? null;
    commands.push({
      id: `matter-${m.id}`,
      group: 'Jump to matter',
      label: m.title,
      ...(client ? { hint: client } : {}),
      icon: <FolderOpen className="w-4 h-4" />,
      run: () => go(`/matters/${m.id}`),
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q))
    : commands;

  const onInputKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  if (!open) return <></>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30"
      role="presentation"
      onClick={close}
    >
      <div
        className="w-full max-w-lg mx-4 bg-surface rounded-lg shadow-xl border border-line overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-line">
          <Search className="w-4 h-4 text-ink-hint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Jump to a matter or page…"
            aria-label="Command search"
            className="flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-hint focus:outline-none"
          />
          <kbd className="text-[10px] text-ink-hint border border-line rounded px-1 py-0.5">Esc</kbd>
        </div>

        <ul className="max-h-80 overflow-auto py-1" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-ink-hint">No matches.</li>
          ) : (
            filtered.map((c, i) => {
              const showHeader = i === 0 || filtered[i - 1]!.group !== c.group;
              return (
                <React.Fragment key={c.id}>
                  {showHeader && (
                    <li className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ink-hint" role="presentation">
                      {c.group}
                    </li>
                  )}
                  <li
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => c.run()}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 mx-1 rounded text-sm cursor-pointer',
                      i === active ? 'bg-accent-tint text-ink' : 'text-ink-secondary hover:bg-surface-2',
                    )}
                  >
                    <span className="text-ink-hint">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="text-xs text-ink-hint truncate">{c.hint}</span>}
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
