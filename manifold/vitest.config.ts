import { defineConfig } from 'vitest/config';

// The deterministic eval subset the CI runs on every push: pure-function
// tests over the real build + gate (manifold/tests), no model call and no
// Supabase, so CI carries no API key. The full harness with the LLM judge
// stays a manual `npm run manifold:evals` / `--bless` command (manifold/evals).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['manifold/tests/**/*.test.ts'],
  },
});
