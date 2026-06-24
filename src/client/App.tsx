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
 *   /matters/:matterId/chat                         — ChatSurface (protected; gated CHAT_UI_1_ENABLED)
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
const UploadFormatPage = lazy(() => import("./pages/UploadFormatPage.js"));
const ChatSurface = lazy(() => import("./pages/ChatSurface.js"));
const CopilotPage = lazy(() => import("./pages/CopilotPage.js"));
const MattersOverview = lazy(() => import("./pages/MattersOverview.js"));
const SupervisionView = lazy(() => import("./pages/SupervisionView.js"));
const ReviewerHealthView = lazy(() => import("./pages/ReviewerHealthView.js"));
const QuickDeedPage = lazy(() => import("./pages/QuickDeedPage.js"));

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
      {/* CHAT-UI-1 — matter-scoped conversation surface. Always registered; ChatSurface self-guards on
          CHAT_UI_1_ENABLED (default OFF) and redirects to the matter page when the flag is off. */}
      <Route path="/matters/:matterId/chat" element={<ProtectedLayout><ChatSurface /></ProtectedLayout>} />
      {/* CHAT-COPILOT-1 — persisted matter copilot surface. Always registered; CopilotPage self-guards
          on CHAT_COPILOT_ENABLED (default OFF) and redirects to the matter page when the flag is off. */}
      <Route path="/matters/:matterId/copilot" element={<ProtectedLayout><CopilotPage /></ProtectedLayout>} />
      {/* FOLD-PM-4 — ongoing matters + to-do overview. Always registered; MattersOverview
          self-guards on MATTER_DELIVERABLE_ENABLED (default OFF) and redirects to /matters when off. */}
      <Route path="/overview" element={<ProtectedLayout><MattersOverview /></ProtectedLayout>} />
      {/* SUPERVISION-VIEW-1 — read-only egress supervision. Always registered; SupervisionView
          self-guards on SUPERVISION_VIEW_ENABLED (default OFF) and redirects to /matters when off. */}
      <Route path="/supervision" element={<ProtectedLayout><SupervisionView /></ProtectedLayout>} />
      {/* REVIEWER-HEALTH-VIEW-1 (5C) — read-only; the page self-gates on reviewerHealth.isEnabled (redirects when OFF). */}
      <Route path="/diagnostics" element={<ProtectedLayout><ReviewerHealthView /></ProtectedLayout>} />
      {/* DEED-DRAFT-AGENT-1 QD-1 — Quick Deed fast lane. Always registered; QuickDeedPage self-guards on
          deedDraftAgent.isEnabled (default OFF) and redirects to /matters when the flag is off. */}
      <Route path="/deed" element={<ProtectedLayout><QuickDeedPage /></ProtectedLayout>} />
      <Route path="/templates" element={<ProtectedLayout><TemplatesPage /></ProtectedLayout>} />
      <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />
      <Route path="/upload-format" element={<ProtectedLayout><UploadFormatPage /></ProtectedLayout>} />
      <Route path="*" element={<Navigate to="/matters" replace />} />
    </Routes>
  );
}
