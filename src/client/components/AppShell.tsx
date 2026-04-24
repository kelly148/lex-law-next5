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
import { Scale, FileText, Settings, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { trpc } from '../trpc.js';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

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
        ? 'bg-white/20 text-white'
        : 'text-white/70 hover:text-white hover:bg-white/10'
    );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-firm-navy flex flex-col flex-shrink-0">
        {/* Logo / brand */}
        <div className="px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-firm-gold" />
            <span className="text-white font-garamond text-lg font-semibold">LexLawNext</span>
          </div>
          {user && (
            <p className="text-white/50 text-xs mt-1 truncate">{user.displayName}</p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/matters" className={navLinkClass}>
            <FileText className="w-4 h-4" />
            Matters
          </NavLink>
          <NavLink to="/templates" className={navLinkClass}>
            <FileText className="w-4 h-4" />
            Templates
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            <Settings className="w-4 h-4" />
            Settings
          </NavLink>
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/10">
          <button
            onClick={() => logoutMutation.mutate(undefined)}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 w-full rounded text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-firm-light overflow-auto">
        {children}
      </main>
    </div>
  );
}
