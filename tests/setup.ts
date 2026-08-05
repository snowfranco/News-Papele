// Global test setup: jest-dom matchers plus DOM cleanup between tests.
// afterEach is a vitest global (globals: true in vitest.config.ts).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
