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
import { FileText, Settings, LogOut, FilePlus, ClipboardList, ShieldCheck, Bell } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { trpc } from '../trpc.js';
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
  // FOLD-NOTIFY-1 — probe the notifications flag (default OFF -> bell hidden, no poll).
  const notificationsFlag = trpc.notifications.isEnabled.useQuery();
  const notificationsEnabled = notificationsFlag.data?.enabled === true;
  // Lightweight poll: ONLY enabled when the flag is ON (so flag-OFF makes ZERO extra
  // requests). One owner-scoped read powers the unread badge; refetch every 60s.
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, {
    enabled: notificationsEnabled,
    refetchInterval: notificationsEnabled ? 60_000 : false,
  });
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  // NOTIFY-SUITE-1 N1 — "while you were away": one derived digest, fetched once on return (no poll — the
  // bell badge above carries the live count). Dismissible for the session; informational only.
  const [digestDismissed, setDigestDismissed] = React.useState(false);
  const digestQuery = trpc.notifications.digest.useQuery(undefined, { enabled: notificationsEnabled });
  const digest = digestQuery.data;
  const showDigest = notificationsEnabled && !digestDismissed && (digest?.total ?? 0) > 0;

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
              never acts. The dot/count appears only when there are unread notices. */}
          {notificationsEnabled && (
            <div
              data-testid="notifications-bell"
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded text-sm font-medium',
                'text-ink-secondary'
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
            <button
              type="button"
              data-testid="notify-digest-dismiss"
              onClick={() => setDigestDismissed(true)}
              aria-label="Dismiss the while-you-were-away digest"
              className="text-ink-secondary hover:text-ink underline whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
