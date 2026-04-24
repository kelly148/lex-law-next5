/**
 * App root — Lex Law Next v1
 *
 * Phase 1 scope: Login page only.
 * Later phases add the full routing tree.
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.js';

export default function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Phase 2+: protected routes will be added here */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
