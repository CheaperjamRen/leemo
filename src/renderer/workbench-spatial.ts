export type WorkbenchSidebarPreference = "auto" | "compact" | "pinned";
export type WorkbenchSidebarMode = "compact" | "expanded";
export type WorkbenchToolPresentation = "docked" | "overlay" | "focused";

export const WORKBENCH_AUTO_COMPACT_BREAKPOINT = 1024;
export const WORKBENCH_COMPACT_SIDEBAR_WIDTH = 52;
export const WORKBENCH_TOOL_RAIL_WIDTH = 44;
export const WORKBENCH_CONVERSATION_MIN_WIDTH = 400;
export const WORKBENCH_FILE_MIN_WIDTH = 500;
export const WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH = 8;
export const WORKBENCH_STAGE_SPLIT_MIN_WIDTH = 920;
export const WORKBENCH_CONVERSATION_ONLY_MIN_WIDTH = 560;

export function isWorkbenchSidebarPreference(value: unknown): value is WorkbenchSidebarPreference {
  return value === "auto" || value === "compact" || value === "pinned";
}

export function resolveWorkbenchSidebarMode(
  preference: WorkbenchSidebarPreference,
  shellWidth: number,
): WorkbenchSidebarMode {
  if (preference === "compact") return "compact";
  if (preference === "pinned") return "expanded";
  return shellWidth < WORKBENCH_AUTO_COMPACT_BREAKPOINT ? "compact" : "expanded";
}

export function resolveWorkbenchToolPresentation(input: {
  shellWidth: number;
  sidebarPreference: WorkbenchSidebarPreference;
  sidebarWidth: number;
  panelWidth: number;
  hasOpenFile: boolean;
  focused?: boolean;
  documentFocused?: boolean;
}): WorkbenchToolPresentation {
  if (input.focused) return "focused";
  if (input.documentFocused) return "overlay";
  const sidebarWidth = resolveWorkbenchSidebarMode(input.sidebarPreference, input.shellWidth) === "compact"
    ? WORKBENCH_COMPACT_SIDEBAR_WIDTH
    : input.sidebarWidth;
  const centralMinimum = input.hasOpenFile
    ? WORKBENCH_STAGE_SPLIT_MIN_WIDTH
    : WORKBENCH_CONVERSATION_ONLY_MIN_WIDTH;
  const centralWidth = input.shellWidth - sidebarWidth - WORKBENCH_TOOL_RAIL_WIDTH - input.panelWidth;
  return centralWidth >= centralMinimum ? "docked" : "overlay";
}
