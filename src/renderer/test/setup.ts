import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts does not set test.globals, so @testing-library/react's
// auto-cleanup (which detects a global `afterEach`) never registers. Without
// this, multiple render() calls across `it()` blocks in one file accumulate
// DOM nodes instead of unmounting between tests.
afterEach(() => {
  cleanup();
});
