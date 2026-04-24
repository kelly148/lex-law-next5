/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // R14 — No Duplicate Primitives: enforce single-import discipline
    'no-duplicate-imports': 'error',

    // Prefer const
    'prefer-const': 'error',

    // TypeScript: no explicit any in source (warn so CI doesn't hard-fail on
    // generated stubs; upgrade to 'error' in Phase 3 when all stubs are filled)
    '@typescript-eslint/no-explicit-any': 'warn',

    // Allow unused vars prefixed with _ (standard convention for intentional ignores)
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

    // React hooks exhaustive deps
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.config.js', '*.config.ts', '*.config.cjs'],
};
