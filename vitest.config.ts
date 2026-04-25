import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Provide a dummy DATABASE_URL so modules that reference the DB can be imported
      // in tests that mock the query layer. Tests that need a real DB must set this
      // to a real connection string in their own environment.
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'mysql://test:test@localhost:3306/test_db',
      // Provide a dummy SESSION_SECRET so modules that import trpc.ts (which imports
      // session.ts) can be loaded in unit tests without a real session configuration.
      SESSION_SECRET: process.env['SESSION_SECRET'] ?? 'test-session-secret-at-least-32-chars-long!!',
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/client/main.tsx'],
    },
    // In-memory telemetry buffer for test assertions
    setupFiles: ['src/server/test-utils/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './src/server'),
      '@client': path.resolve(__dirname, './src/client'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
