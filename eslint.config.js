import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['profile-engine.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // Some flavour-vector locals here are leftover from a prior refactor of the
      // extraction-curve heuristics (now driven by gap()); real but low-risk dead
      // code, tracked as cleanup rather than fixed blind in a tooling-only pass.
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['*.jsx'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Marks components/vars referenced only via JSX tags as used, avoiding
      // false-positive no-unused-vars on e.g. `<HDivider .../>`.
      'react/jsx-uses-vars': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // gaggimate-generator.jsx predates this tooling pass and has known dead
      // locals (e.g. unused destructured state, superseded helpers); tracked as
      // cleanup rather than fixed blind since this file can't run standalone here.
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
