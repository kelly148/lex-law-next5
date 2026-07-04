/**
 * AppShell — Lex Law Next v1
 *
 * Phase 5: Main application shell with sidebar navigation.
 *
 * Layout:
 *   - Fixed left sidebar (firm-navy) with navigation links
 *   - Main content area (firm-light background)
 *
 * Navigation items:
 *   - Matters (/matters)
 *   - Templates (/templates)
 *   - Settings (/settings)
 *
 * Logout uses useGuardedMutation per Ch 35.13.
 * Ch 35.3 — No business logic in React: logout is a server-side operation.
 */
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FileText, Settings, LogOut, FilePlus, ClipboardList, ShieldCheck, Bell, CheckCheck, X, Activity, Stamp } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { trpc } from '../trpc.js';
import { playGavel } from '../utils/gavelSound.js';
import CommandPalette from './CommandPalette.js';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // FOLD-PM-4 — show the Overview nav link only when the feature is enabled (default OFF -> hidden).
  const deliverableFlag = trpc.matterDeliverable.isEnabled.useQuery();
  // SUPERVISION-VIEW-1 — show the Supervision nav link only when enabled (default OFF -> hidden).
  const supervisionFlag = trpc.supervision.isEnabled.useQuery();
  // REVIEWER-HEALTH-VIEW-1 (5C) — show the Diagnostics nav link only when enabled (default OFF -> hidden).
  const reviewerHealthFlag = trpc.reviewerHealth.isEnabled.useQuery();
  // DEED-DRAFT-AGENT-1 QD-1 — show the top-level "Deed" (Quick Deed) nav link only when the deed-draft
  // agent is enabled (default OFF -> hidden). Reuses the existing deedDraftAgent.isEnabled probe.
  const deedAgentFlag = trpc.deedDraftAgent.isEnabled.useQuery();
  // W2b (U-1 / run-sheet 0.7) — surface the deployed build SHA so "which commit is live" is a VISIBLE fact,
  // not an inference. Best-effort runtime read of the EXISTING /api/version stamp (dist/version.json, injected
  // from RAILWAY_GIT_COMMIT_SHA at build) — no VITE_ build-flag hazard, no new endpoint. Absent locally (dev).
  const [buildSha, setBuildSha] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (typeof fetch !== 'function') return;
    let active = true;
    fetch('/api/version')
      .then((r) => r.json())
      .then((v: { commit?: string }) => {
        if (active && v.commit && v.commit !== 'unknown') setBuildSha(v.commit);
      })
      .catch(() => {
        /* build SHA is best-effort; absence (local dev / offline) is fine — show nothing. */
      });
    return () => {
      active = false;
    };
  }, []);
  // FOLD-NOTIFY-1 — probe the notifications flag (default OFF -> bell hidden, no poll).
  const notificationsFlag = trpc.notifications.isEnabled.useQuery();
  const notificationsEnabled = notificationsFlag.data?.enabled === true;
  // NOTIFY-SOUND-1 — the gavel-sound flag (default OFF). The sound only ever accompanies an in-app
  // notification, so it is moot unless notifications are also on.
  const soundFlagEnabled = notificationsFlag.data?.soundEnabled === true;
  // Lightweight poll: ONLY enabled when the flag is ON (so flag-OFF makes ZERO extra
  // requests). One owner-scoped read powers the unread badge + the dropdown feed; refetch every 60s,
  // and on window focus so returning to the tab surfaces a just-completed review/draft promptly.
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, {
    enabled: notificationsEnabled,
    refetchInterval: notificationsEnabled ? 60_000 : false,
    refetchOnWindowFocus: notificationsEnabled,
  });
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const notifItems = notificationsQuery.data?.items ?? [];
  // NOTIFY-SUITE-1 N1 — "while you were away": the derived "N matters have results" digest line. Item 1
  // fix: it MUST refresh like the bell (poll + on-focus) — previously it was fetched ONCE on mount and
  // never invalidated, so a review/draft that completed in-session never moved the matters-with-results
  // line (the observed gap). Dismissible for the session; informational only.
  const [digestDismissed, setDigestDismissed] = React.useState(false);
  const digestQuery = trpc.notifications.digest.useQuery(undefined, {
    enabled: notificationsEnabled,
    refetchInterval: notificationsEnabled ? 60_000 : false,
    refetchOnWindowFocus: notificationsEnabled,
  });
  const digest = digestQuery.data;
  const showDigest = notificationsEnabled && !digestDismissed && (digest?.total ?? 0) > 0;

  // ── Item 2: a working "mark seen" path (the persistent nav count must be clearable) ──────────────
  // The bell opens a dropdown of recent notices; clicking one marks it seen + opens its matter, and
  // "Mark all as read" clears the whole count. Reuses the already-unit-tested markSeen / markAllSeen
  // mutations; on success we invalidate the feed + the digest so the badge and banner refresh.
  const [bellOpen, setBellOpen] = React.useState(false);
  const refreshNotifications = React.useCallback(() => {
    void utils.notifications.list.invalidate();
    void utils.notifications.digest.invalidate();
  }, [utils]);
  const markAllSeenMutation = useGuardedMutation(
    () => utils.client.notifications.markAllSeen.mutate(),
    { onSuccess: refreshNotifications },
  );
  const markSeenMutation = useGuardedMutation(
    (id: string) => utils.client.notifications.markSeen.mutate({ id }),
    { onSuccess: refreshNotifications },
  );
  const markAllSeen = (): void => markAllSeenMutation.mutate(undefined);
  const openNotification = (n: { id: string; matterId: string | null; readAt: string | null }): void => {
    if (n.readAt == null) markSeenMutation.mutate(n.id);
    setBellOpen(false);
    navigate(n.matterId ? `/matters/${n.matterId}` : '/matters');
  };

  // ── Item 3: the gavel cue on a NEWLY-ARRIVED unseen notification ──────────────────────────────────
  // Plays only when NOTIFY_SOUND_ENABLED is on AND the per-user sound toggle is on; otherwise zero sound
  // code runs (no AudioContext). The per-user toggle lives in notificationPreferences.sound; read it only
  // when the sound path is actually possible (so flag-OFF prod makes ZERO extra requests).
  const soundSettingsQuery = trpc.settings.get.useQuery(undefined, {
    enabled: notificationsEnabled && soundFlagEnabled,
  });
  const userSoundOn = soundSettingsQuery.data?.notificationPreferences?.sound === true;
  const soundAllowed = notificationsEnabled && soundFlagEnabled && userSoundOn;
  // Ids we've already observed across polls. null until the FIRST successful load — that first load SEEDS
  // the set WITHOUT playing, so pre-existing unseen notices never replay; only ids that appear in a later
  // poll are "newly arrived". Dedupe-by-id means a 60s re-fetch never replays, and a burst plays once.
  const seenNotifIdsRef = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const data = notificationsQuery.data;
    if (!data) return;
    const items = data.items;
    if (seenNotifIdsRef.current === null) {
      seenNotifIdsRef.current = new Set(items.map((i) => i.id));
      return; // first load: seed only, never play
    }
    const known = seenNotifIdsRef.current;
    const newlyArrivedUnread = items.filter((i) => !known.has(i.id) && i.readAt == null);
    for (const i of items) known.add(i.id); // record every id now so re-polls can't replay
    if (newlyArrivedUnread.length > 0 && soundAllowed) {
      // A fresh "ready" notice landed this poll — strike the gavel ONCE (burst-debounced). Best-effort:
      // playGavel never throws and no-ops silently if the browser still blocks audio.
      playGavel();
    }
  }, [notificationsQuery.data, soundAllowed]);

  const logoutMutation = useGuardedMutation(
    () => utils.client.auth.logout.mutate(),
    {
      onSuccess: () => {
        void utils.auth.me.invalidate();
        navigate('/login');
      },
    }
  );

  const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
    clsx(
      'flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors',
      isActive
        ? 'bg-surface text-ink'
        : 'text-ink-secondary hover:text-ink hover:bg-surface'
    );

  return (
    <div className="flex min-h-screen">
      {/* R2 #8 — nav-only command palette (Ctrl/Cmd-K); available on every protected page. */}
      <CommandPalette />
      {/* Sidebar — Whereas light rail. RELAYOUT-3: collapses to ~56px icons when a wide review
          layout is active (html[data-review-layout="wide"]); see the globals.css rule. The rail
          stays mounted — only its width + label visibility change (CSS-only, no remount). */}
      <aside data-app-rail className="w-56 bg-surface-2 flex flex-col flex-shrink-0 border-r border-line transition-[width] duration-150">
        {/* Wordmark — serif (Fraunces); the comma is the oxblood recital mark. */}
        <div className="px-4 py-5 border-b border-line">
          <div className="flex items-center gap-2">
            <span data-rail-label className="font-serif text-xl font-medium text-ink">
              Whereas<span className="text-accent">,</span>
            </span>
          </div>
          {user && (
            <p data-rail-label className="text-ink-hint text-xs mt-1 truncate">{user.displayName}</p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/matters" className={navLinkClass}>
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span data-rail-label>Matters</span>
          </NavLink>
          {deliverableFlag.data?.enabled === true && (
            <NavLink to="/overview" className={navLinkClass}>
              <ClipboardList className="w-4 h-4 flex-shrink-0" />
              <span data-rail-label>Overview</span>
            </NavLink>
          )}
          {supervisionFlag.data?.enabled === true && (
            <NavLink to="/supervision" className={navLinkClass}>
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              <span data-rail-label>Supervision</span>
            </NavLink>
          )}
          {reviewerHealthFlag.data?.enabled === true && (
            <NavLink to="/diagnostics" className={navLinkClass}>
              <Activity className="w-4 h-4 flex-shrink-0" />
              <span data-rail-label>Diagnostics</span>
            </NavLink>
          )}
          {/* DEED-DRAFT-AGENT-1 QD-1 — top-level "Deed" fast-lane entry. Rendered only when the deed-draft
              agent flag is ON (default OFF -> absent). The /deed page also self-guards on the same flag. */}
          {deedAgentFlag.data?.enabled === true && (
            <NavLink to="/deed" className={navLinkClass}>
              <Stamp className="w-4 h-4 flex-shrink-0" />
              <span data-rail-label>Deed</span>
            </NavLink>
          )}
          <NavLink to="/templates" className={navLinkClass}>
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span data-rail-label>Templates</span>
          </NavLink>
          <NavLink to="/upload-format" className={navLinkClass}>
            <FilePlus className="w-4 h-4 flex-shrink-0" />
            <span data-rail-label>Upload &amp; Format</span>
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            <Settings className="w-4 h-4 flex-shrink-0" />
            <span data-rail-label>Settings</span>
          </NavLink>
          {/* FOLD-NOTIFY-1 — bell + unread badge. Rendered only when NOTIFICATIONS_ENABLED
              is ON (default OFF -> absent). INFORMATIONAL: the badge surfaces a count; it
              never acts. The dot/count appears only when there are unread notices. Item 2: the
              bell is now a button that opens a dropdown so the count can actually be cleared. */}
          {notificationsEnabled && (
            <div className="relative">
              <button
                type="button"
                data-testid="notifications-bell"
                aria-haspopup="menu"
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((o) => !o)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 w-full rounded text-sm font-medium transition-colors',
                  'text-ink-secondary hover:text-ink hover:bg-surface'
                )}
              >
                <span className="relative flex-shrink-0">
                  <Bell className="w-4 h-4" aria-hidden />
                  {unreadCount > 0 && (
                    <span
                      data-testid="notifications-badge"
                      aria-label={`${unreadCount} unread notifications`}
                      className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                <span data-rail-label>
                  Notifications
                  {unreadCount > 0 ? ` (${unreadCount > 99 ? '99+' : unreadCount})` : ''}
                </span>
              </button>

              {bellOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" aria-hidden onClick={() => setBellOpen(false)} />
                  <div
                    data-testid="notifications-panel"
                    role="menu"
                    className="absolute left-full top-0 ml-2 z-50 w-72 max-h-96 overflow-auto rounded-lg border border-line bg-surface shadow-lg"
                  >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-line">
                      <span className="text-sm font-semibold text-ink">Notifications</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-testid="notifications-mark-all"
                          onClick={markAllSeen}
                          disabled={markAllSeenMutation.isPending || unreadCount === 0}
                          className="inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink disabled:opacity-40"
                        >
                          <CheckCheck className="w-3.5 h-3.5" aria-hidden />
                          Mark all as read
                        </button>
                        <button
                          type="button"
                          aria-label="Close notifications"
                          onClick={() => setBellOpen(false)}
                          className="text-ink-secondary hover:text-ink"
                        >
                          <X className="w-4 h-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                    {notifItems.length === 0 ? (
                      <p className="px-3 py-6 text-sm text-ink-hint text-center">No notifications.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {notifItems.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              data-testid="notification-item"
                              onClick={() => openNotification(n)}
                              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2"
                            >
                              {n.readAt == null && (
                                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent" aria-label="unread" />
                              )}
                              <span className={clsx('flex-1 text-sm', n.readAt == null ? 'text-ink font-medium' : 'text-ink-secondary')}>
                                {n.title}
                                {n.body ? <span className="block text-xs text-ink-hint font-normal">{n.body}</span> : null}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-line">
          <button
            onClick={() => logoutMutation.mutate(undefined)}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 w-full rounded text-sm font-medium text-ink-secondary hover:text-ink hover:bg-surface transition-colors disabled:opacity-50"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span data-rail-label>Sign out</span>
          </button>
        </div>

        {/* W2b — deployed build SHA (best-effort; hidden when unknown / local dev). Makes the live commit
            visible so an audit/debug never has to infer it (Fable audit D2). */}
        {buildSha && (
          <p data-testid="build-sha" className="px-3 pb-3 text-[10px] leading-none text-ink-secondary/60">
            build {buildSha.slice(0, 7)}
          </p>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-firm-light overflow-auto">
        {/* NOTIFY-SUITE-1 N1 — "while you were away" digest: ONE coherent summary on return (not N toasts),
            dismissible. Shown only when notifications are ON and something is unread. */}
        {showDigest && digest && (
          <div
            data-testid="notify-digest"
            className="flex items-center justify-between gap-3 px-4 py-2 bg-surface-2 border-b border-line text-sm text-ink"
          >
            <span>
              <span className="font-medium">While you were away</span>
              {' — '}
              {digest.summaryLine || `${digest.total} new notification${digest.total === 1 ? '' : 's'}`}
            </span>
            <div className="flex items-center gap-3 whitespace-nowrap">
              {/* Primary action: actually CLEAR the unread count (not just hide the banner). */}
              <button
                type="button"
                data-testid="notify-digest-mark-all"
                onClick={() => { markAllSeen(); setDigestDismissed(true); }}
                disabled={markAllSeenMutation.isPending}
                className="text-ink-secondary hover:text-ink underline disabled:opacity-40"
              >
                Mark all read
              </button>
              <button
                type="button"
                data-testid="notify-digest-dismiss"
                onClick={() => setDigestDismissed(true)}
                aria-label="Dismiss the while-you-were-away digest"
                className="text-ink-secondary hover:text-ink underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
