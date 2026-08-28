import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // .claude/worktrees holds ephemeral git worktrees from prior sessions,
  // never our own source: linting them is noise (and picks up their own
  // scripts/postbuild.mjs under a config that has no Node globals).
  { ignores: ['dist', 'node_modules', 'index.html', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // manifold is the Node/TypeScript editor agent (manifold/README.md); it
    // runs via tsx, not in the browser, so it gets Node globals instead of
    // the app's browser globals.
    files: ['manifold/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
