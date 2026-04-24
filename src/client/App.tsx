/**
 * App root — Lex Law Next v1
 *
 * Phase 5 scope: Full routing tree with auth guard and app shell.
 *
 * Routes:
 *   /login                                          — LoginPage (public)
 *   /matters                                        — MatterDashboard (protected)
 *   /matters/:matterId                              — MatterDetail (protected)
 *   /matters/:matterId/documents/:documentId        — DocumentDetail (protected)
 *   /matters/:matterId/information-requests         — InformationRequestPage (protected)
 *   /templates                                      — TemplatesPage (protected)
 *   /settings                                       — SettingsPage (protected)
 *
 * All protected routes are wrapped in AuthGuard + AppShell.
 */
import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthGuard from "./components/AuthGuard.js";
import AppShell from "./components/AppShell.js";
import LoginPage from "./pages/LoginPage.js";

const MatterDashboard = lazy(() => import("./pages/MatterDashboard.js"));
const MatterDetail = lazy(() => import("./pages/MatterDetail.js"));
const DocumentDetail = lazy(() => import("./pages/DocumentDetail.js"));
const TemplatesPage = lazy(() => import("./pages/TemplatesPage.js"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js"));
const InformationRequestPage = lazy(() => import("./pages/InformationRequestPage.js"));

function PageLoader(): React.ReactElement {
  return (
    <div className="flex items-center justify-center h-64">
      <span className="text-firm-navy/50 text-sm">Loading...</span>
    </div>
  );
}

function ProtectedLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <AuthGuard>
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}

export default function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/matters" element={<ProtectedLayout><MatterDashboard /></ProtectedLayout>} />
      <Route path="/matters/:matterId" element={<ProtectedLayout><MatterDetail /></ProtectedLayout>} />
      <Route path="/matters/:matterId/documents/:documentId" element={<ProtectedLayout><DocumentDetail /></ProtectedLayout>} />
      <Route path="/matters/:matterId/information-requests" element={<ProtectedLayout><InformationRequestPage /></ProtectedLayout>} />
      <Route path="/templates" element={<ProtectedLayout><TemplatesPage /></ProtectedLayout>} />
      <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />
      <Route path="*" element={<Navigate to="/matters" replace />} />
    </Routes>
  );
}
