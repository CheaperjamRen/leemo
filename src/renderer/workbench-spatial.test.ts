import { describe, expect, it } from "vitest";
import {
  WORKBENCH_STAGE_SPLIT_MIN_WIDTH,
  resolveWorkbenchSidebarMode,
  resolveWorkbenchToolPresentation,
} from "./workbench-spatial";

describe("workbench spatial contract", () => {
  it.each([
    ["auto", "compact"],
    ["compact", "compact"],
    ["pinned", "expanded"],
  ] as const)("resolves %s at the 960px minimum window", (preference, expected) => {
    expect(resolveWorkbenchSidebarMode(preference, 960)).toBe(expected);
  });

  it.each([
    [{ shellWidth: 1440, sidebarPreference: "auto", sidebarWidth: 288, panelWidth: 360, hasOpenFile: false }, "docked"],
    [{ shellWidth: 960, sidebarPreference: "auto", sidebarWidth: 288, panelWidth: 360, hasOpenFile: false }, "overlay"],
    [{ shellWidth: 1440, sidebarPreference: "auto", sidebarWidth: 288, panelWidth: 360, hasOpenFile: true }, "overlay"],
    [{ shellWidth: 1800, sidebarPreference: "auto", sidebarWidth: 288, panelWidth: 360, hasOpenFile: true }, "docked"],
  ] as const)("resolves tool placement without shrinking the central stage", (input, expected) => {
    expect(resolveWorkbenchToolPresentation(input)).toBe(expected);
  });

  it("shares the 920px central-stage threshold", () => {
    expect(WORKBENCH_STAGE_SPLIT_MIN_WIDTH).toBe(920);
  });

  it("keeps Explorer as an overlay while a document owns the focused stage", () => {
    expect(resolveWorkbenchToolPresentation({
      shellWidth: 1800,
      sidebarPreference: "compact",
      sidebarWidth: 288,
      panelWidth: 360,
      hasOpenFile: true,
      documentFocused: true,
    } as Parameters<typeof resolveWorkbenchToolPresentation>[0])).toBe("overlay");
  });
});
