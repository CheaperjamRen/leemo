import { describe, expect, it } from "vitest";

import { QUICK_CAPTURE_WINDOW_OPTIONS } from "../src/main/window-config";

describe("quick capture window geometry", () => {
  it("reserves a document-sized writing surface instead of a cramped utility panel", () => {
    expect(QUICK_CAPTURE_WINDOW_OPTIONS.width).toBeGreaterThanOrEqual(600);
    expect(QUICK_CAPTURE_WINDOW_OPTIONS.height).toBeGreaterThanOrEqual(500);
    expect(QUICK_CAPTURE_WINDOW_OPTIONS.minWidth).toBeGreaterThanOrEqual(440);
    expect(QUICK_CAPTURE_WINDOW_OPTIONS.minHeight).toBeGreaterThanOrEqual(360);
  });
});
