import { createStore, type StoreApi } from "zustand/vanilla";
import {
  DEFAULT_SPLIT_RATIO,
  MAX_OPEN_CONVERSATIONS,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  fileTabKey,
  sanitizeScopeSessions,
  type ScopeConversationRef,
  type ScopeFileTab,
  type ScopeKey,
  type ScopeSession,
  type ScopeSessions,
  type ScopeSurfacePreference,
} from "./workbench-scope";
import { HOME_WORKSPACE_ID } from "./workspaces";
import {
  isWorkbenchSidebarPreference,
  type WorkbenchSidebarPreference,
} from "../workbench-spatial";

type PreviewTab = { path: string; title: string; kind: "markdown" | "pdf" | "html" | "other" };

export interface UiState {
  view: "chat" | "skills" | "artifacts" | "scheduled" | "learning";
  settingsOpen: boolean;
  settingsSection: "models" | "momo" | "web" | "permissions" | "usage" | "extensions" | "general";
  searchOpen: boolean;
  notifPanelOpen: boolean;
  wizardOpen: boolean;
  previewOpen: boolean;
  previewWidthPx: number;
  previewTabs: PreviewTab[];
  previewActivePath: string | null;
  filesOpen: boolean;
  /** Compatibility projection for older callers; spatial layout uses the preference below. */
  sidebarCollapsed: boolean;
  workbenchSidebarPreference: WorkbenchSidebarPreference;
  /** User-adjusted workbench sidebar width, independent of transient overlays. */
  workbenchSidebarWidth: number;
  /** The one active right-side work tool. The rail itself stays visible. */
  activeWorkbenchTool: WorkbenchTool | null;
  /** Each tool keeps its own width so switching tools never surprises the user. */
  workbenchToolWidths: WorkbenchToolWidths;
  /** A tool panel can temporarily take over the central stage without losing it. */
  workbenchToolFocused: boolean;
  /** Per notebook/workspace navigation state. Kept separate from the global
   * conversation store so switching scope never destroys another scope's tabs. */
  activeScopeKey: ScopeKey;
  scopeSessions: ScopeSessions;
  workspaceTransitioning: boolean;
  /** 轮 7 A3 —— 「设置已生效」提示。`count` = 有多少个正在进行的对话会在**下一轮**
   *  吃到新设置；0 表示没有活对话，此时不该说"下轮起生效"（用户会去找那个不存在
   *  的对话）。`at` 让同一次改动重复广播也能刷新提示。 */
  contextHint: { at: number; count: number } | null;

  setView(view: UiState["view"]): void;
  openSettings(section?: UiState["settingsSection"]): void;
  closeSettings(): void;
  toggleSearch(): void;
  toggleNotifPanel(): void;
  closeTopOverlay(): void;
  openPreview(path: string, title: string, kind: PreviewTab["kind"]): void;
  closePreview(): void;
  closePreviewTab(path: string): void;
  closeAllPreviewTabs(): void;
  setWorkspaceTransitioning(value: boolean): void;
  setPreviewWidth(px: number): void;
  /** 轮 7 A3 —— record that a settings change was pushed to `count` live
   *  conversations. Pass 0 to state "saved, nothing live to update". */
  noteContextApplied(count: number, at?: number): void;
  /** Clear one hint by ownership timestamp. An old timer must not dismiss a
   * newer save that refreshed the banner while the old timer was pending. */
  clearContextHint(at?: number): void;
  openFiles(): void;
  closeFiles(): void;
  toggleFiles(): void;
  toggleSidebar(): void;
  setWorkbenchSidebarPreference(preference: WorkbenchSidebarPreference): void;
  setWorkbenchSidebarWidth(px: number): void;
  toggleWorkbenchTool(tool: WorkbenchTool): void;
  closeWorkbenchTool(): void;
  setWorkbenchToolWidth(tool: WorkbenchTool, px: number): void;
  setWorkbenchToolFocused(value: boolean): void;
  activateWorkbenchScope(scopeKey: ScopeKey): void;
  openScopeConversation(conversationId: string): void;
  closeScopeConversation(conversationId: string): void;
  setScopeSurface(surface: ScopeSurfacePreference): void;
  setScopeSplitRatio(ratio: number): void;
  openScopeFile(tab: ScopeFileTab): void;
  closeScopeFile(tab: Pick<ScopeFileTab, "workspaceId" | "path">): void;
  setScopeActiveFile(fileKey: string | null): void;
  hydrateWorkbenchUi(persisted: unknown, conversations?: Readonly<Record<string, ScopeConversationRef>>): void;
  openWizard(): void;
  closeWizard(): void;
}

export const WORKBENCH_SIDEBAR_WIDTH = {
  min: 252,
  default: 288,
  max: 360,
} as const;

export type WorkbenchTool = "files" | "overview" | "search";
export type WorkbenchToolWidths = Record<WorkbenchTool, number>;

export const WORKBENCH_TOOL_WIDTH = {
  min: 280,
  default: 360,
  max: 520,
} as const;

const DEFAULT_WORKBENCH_TOOL_WIDTHS: WorkbenchToolWidths = {
  files: WORKBENCH_TOOL_WIDTH.default,
  overview: WORKBENCH_TOOL_WIDTH.default,
  search: WORKBENCH_TOOL_WIDTH.default,
};

export interface PersistedWorkbenchUi {
  sidebarWidth: number;
  sidebarPreference: WorkbenchSidebarPreference;
  activeScopeKey: ScopeKey;
  scopeSessions: ScopeSessions;
  toolWidths: WorkbenchToolWidths;
  activeWorkbenchTool: WorkbenchTool | null;
  workbenchToolFocused: boolean;
}

export function pickPersistedWorkbenchUi(state: UiState): PersistedWorkbenchUi {
  // Re-project through the same sanitizer used on restore. This keeps the
  // settings row bounded even if a future UI action accidentally stores an
  // unknown field or a stale tab.
  return {
    sidebarWidth: state.workbenchSidebarWidth,
    sidebarPreference: isWorkbenchSidebarPreference(state.workbenchSidebarPreference)
      ? state.workbenchSidebarPreference
      : "auto",
    activeScopeKey: isScopeKey(state.activeScopeKey) ? state.activeScopeKey : "global",
    scopeSessions: sanitizeScopeSessions(state.scopeSessions),
    toolWidths: sanitizeWorkbenchToolWidths(state.workbenchToolWidths),
    activeWorkbenchTool: isWorkbenchTool(state.activeWorkbenchTool) ? state.activeWorkbenchTool : null,
    workbenchToolFocused: isWorkbenchTool(state.activeWorkbenchTool) && state.workbenchToolFocused,
  };
}

const isView = (value: unknown): value is UiState["view"] => value === "chat" || value === "skills" || value === "artifacts" || value === "scheduled" || value === "learning";
const isSection = (value: unknown): value is UiState["settingsSection"] =>
  value === "models" || value === "momo" || value === "web" || value === "permissions" || value === "usage" || value === "extensions" || value === "general";

const isScopeKey = (value: unknown): value is ScopeKey => {
  if (value === "global") return true;
  if (typeof value !== "string") return false;
  return /^(notebook|workspace):[^\u0000-\u001f\u007f\\/]+$/.test(value);
};

const isWorkbenchTool = (value: unknown): value is WorkbenchTool =>
  value === "files" || value === "overview" || value === "search";

const clampWorkbenchToolWidth = (px: number): number => Math.min(
  WORKBENCH_TOOL_WIDTH.max,
  Math.max(WORKBENCH_TOOL_WIDTH.min, px),
);

const sanitizeWorkbenchToolWidths = (value: unknown): WorkbenchToolWidths => {
  const raw = value && typeof value === "object" ? value as Partial<Record<WorkbenchTool, unknown>> : {};
  return {
    files: typeof raw.files === "number" && Number.isFinite(raw.files)
      ? clampWorkbenchToolWidth(raw.files)
      : DEFAULT_WORKBENCH_TOOL_WIDTHS.files,
    overview: typeof raw.overview === "number" && Number.isFinite(raw.overview)
      ? clampWorkbenchToolWidth(raw.overview)
      : DEFAULT_WORKBENCH_TOOL_WIDTHS.overview,
    search: typeof raw.search === "number" && Number.isFinite(raw.search)
      ? clampWorkbenchToolWidth(raw.search)
      : DEFAULT_WORKBENCH_TOOL_WIDTHS.search,
  };
};

const emptyScopeSession = (): ScopeSession => ({
  openConversationIds: [],
  activeConversationId: null,
  fileTabs: [],
  activeFileKey: null,
  surfacePreference: "split",
  splitRatio: DEFAULT_SPLIT_RATIO,
});

function workspaceIdForScope(scopeKey: ScopeKey): string {
  return scopeKey.startsWith("workspace:") ? scopeKey.slice("workspace:".length) : HOME_WORKSPACE_ID;
}

function previewTabsForSession(session: ScopeSession): PreviewTab[] {
  return session.fileTabs.map(({ path, title, kind }) => ({ path, title, kind }));
}

function previewProjection(session: ScopeSession): Pick<UiState, "previewOpen" | "previewTabs" | "previewActivePath"> {
  const previewTabs = previewTabsForSession(session);
  const active = session.activeFileKey
    ? session.fileTabs.find((tab) => fileTabKey(tab) === session.activeFileKey)
    : session.fileTabs.at(-1);
  return {
    previewOpen: previewTabs.length > 0,
    previewTabs,
    previewActivePath: active?.path ?? null,
  };
}

function addFileToActiveScope(state: UiState, tab: ScopeFileTab): Pick<UiState, "scopeSessions" | "previewOpen" | "previewTabs" | "previewActivePath"> {
  const session = activeScopeSession(state);
  const key = fileTabKey(tab);
  const exists = session.fileTabs.some((candidate) => fileTabKey(candidate) === key);
  const fileTabs = exists ? session.fileTabs : [...session.fileTabs, { ...tab }];
  const nextSession: ScopeSession = {
    ...session,
    fileTabs,
    activeFileKey: key,
    // Opening a file starts in the normal split preference. An already
    // explicit file-focused preference remains focused when another file is opened.
    surfacePreference: session.surfacePreference === "file" ? "file" : "split",
  };
  return {
    scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
    ...previewProjection(nextSession),
  };
}

const activeScopeSession = (state: UiState): ScopeSession =>
  state.scopeSessions[state.activeScopeKey] ?? emptyScopeSession();

const withActiveScopeSession = (state: UiState, session: ScopeSession): Pick<UiState, "scopeSessions"> => ({
  scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: session },
});

export function createUiStore(): StoreApi<UiState> {
  return createStore<UiState>((set) => ({
    view: "chat",
    settingsOpen: false,
    settingsSection: "general",
    searchOpen: false,
    notifPanelOpen: false,
    wizardOpen: false,
    previewOpen: false,
    previewWidthPx: 420,
    previewTabs: [],
    previewActivePath: null,
    filesOpen: false,
    sidebarCollapsed: false,
    workbenchSidebarPreference: "auto",
    workbenchSidebarWidth: WORKBENCH_SIDEBAR_WIDTH.default,
    activeWorkbenchTool: null,
    workbenchToolWidths: { ...DEFAULT_WORKBENCH_TOOL_WIDTHS },
    workbenchToolFocused: false,
    activeScopeKey: "global",
    scopeSessions: { global: emptyScopeSession() },
    workspaceTransitioning: false,
    contextHint: null,

    setView: (view) => { if (isView(view)) set({ view }); },
    openSettings: (settingsSection = "general") => {
      if (isSection(settingsSection)) {
        set({ settingsOpen: true, settingsSection, searchOpen: false, notifPanelOpen: false });
      }
    },
    closeSettings: () => set({ settingsOpen: false }),
    toggleSearch: () => set((state) => ({
      searchOpen: !state.searchOpen,
      settingsOpen: false,
      notifPanelOpen: false,
    })),
    toggleNotifPanel: () => set((state) => ({
      notifPanelOpen: !state.notifPanelOpen,
      settingsOpen: false,
      searchOpen: false,
    })),
    closeTopOverlay: () => set({ settingsOpen: false, searchOpen: false, notifPanelOpen: false }),
    openPreview: (path, title, kind) => {
      if (!path || !title || !["markdown", "pdf", "html", "other"].includes(kind)) return;
      set((state) => {
        const scopeFile = {
          workspaceId: workspaceIdForScope(state.activeScopeKey),
          path,
          title,
          kind,
        } satisfies ScopeFileTab;
        return {
          filesOpen: false,
          ...addFileToActiveScope(state, scopeFile),
        };
      });
    },
    closePreview: () => set((state) => {
      const session = activeScopeSession(state);
      const nextSession: ScopeSession = {
        ...session,
        fileTabs: [],
        activeFileKey: null,
        surfacePreference: "conversation",
      };
      return {
        scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
        previewOpen: false,
        previewActivePath: null,
        previewTabs: [],
      };
    }),
    closePreviewTab: (path) => set((state) => {
      const session = activeScopeSession(state);
      const workspaceId = workspaceIdForScope(state.activeScopeKey);
      const key = fileTabKey({ workspaceId, path });
      const index = session.fileTabs.findIndex((tab) => fileTabKey(tab) === key || tab.path === path);
      if (index < 0) return state;
      const fileTabs = session.fileTabs.filter((_, candidateIndex) => candidateIndex !== index);
      const activeFileKey = session.activeFileKey === key
        ? fileTabs[index - 1] ? fileTabKey(fileTabs[index - 1]) : fileTabs[index] ? fileTabKey(fileTabs[index]) : null
        : session.activeFileKey;
      const nextSession = {
        ...session,
        fileTabs,
        activeFileKey,
        surfacePreference: fileTabs.length > 0 ? session.surfacePreference : "conversation" as const,
      } satisfies ScopeSession;
      return {
        scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
        ...previewProjection(nextSession),
      };
    }),
    closeAllPreviewTabs: () => set((state) => {
      const session = activeScopeSession(state);
      const nextSession: ScopeSession = {
        ...session,
        fileTabs: [],
        activeFileKey: null,
        surfacePreference: "conversation",
      };
      return {
        scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
        previewTabs: [],
        previewActivePath: null,
        previewOpen: false,
      };
    }),
    setWorkspaceTransitioning: (workspaceTransitioning) => set({ workspaceTransitioning }),
    setPreviewWidth: (px) => { if (Number.isFinite(px)) set({ previewWidthPx: Math.max(300, px) }); },
    noteContextApplied: (count, at) => {
      if (!Number.isFinite(count) || count < 0) return;
      set({ contextHint: { at: at ?? Date.now(), count: Math.floor(count) } });
    },
    clearContextHint: (at) => set((state) => {
      if (state.contextHint === null) return state;
      if (at !== undefined && state.contextHint.at !== at) return state;
      return { contextHint: null };
    }),
    openFiles: () => set({ filesOpen: true }),
    closeFiles: () => set({ filesOpen: false }),
    toggleFiles: () => set((state) => ({ filesOpen: !state.filesOpen })),
    toggleSidebar: () => set((state) => {
      const preference = state.sidebarCollapsed || state.workbenchSidebarPreference === "compact"
        ? "pinned"
        : "compact";
      return { sidebarCollapsed: preference === "compact", workbenchSidebarPreference: preference };
    }),
    setWorkbenchSidebarPreference: (preference) => {
      if (!isWorkbenchSidebarPreference(preference)) return;
      set({
        workbenchSidebarPreference: preference,
        sidebarCollapsed: preference === "compact",
      });
    },
    setWorkbenchSidebarWidth: (px) => {
      if (!Number.isFinite(px)) return;
      set({ workbenchSidebarWidth: Math.min(WORKBENCH_SIDEBAR_WIDTH.max, Math.max(WORKBENCH_SIDEBAR_WIDTH.min, px)) });
    },
    toggleWorkbenchTool: (tool) => {
      if (!isWorkbenchTool(tool)) return;
      set((state) => state.activeWorkbenchTool === tool
        ? { activeWorkbenchTool: null, workbenchToolFocused: false }
        : { activeWorkbenchTool: tool, workbenchToolFocused: false });
    },
    closeWorkbenchTool: () => set({ activeWorkbenchTool: null, workbenchToolFocused: false }),
    setWorkbenchToolWidth: (tool, px) => {
      if (!isWorkbenchTool(tool) || !Number.isFinite(px)) return;
      set((state) => ({
        workbenchToolWidths: {
          ...state.workbenchToolWidths,
          [tool]: clampWorkbenchToolWidth(px),
        },
      }));
    },
    setWorkbenchToolFocused: (workbenchToolFocused) => set({ workbenchToolFocused: Boolean(workbenchToolFocused) }),
    activateWorkbenchScope: (scopeKey) => {
      if (!isScopeKey(scopeKey)) return;
      set((state) => {
        const session = state.scopeSessions[scopeKey] ?? emptyScopeSession();
        return {
          activeScopeKey: scopeKey,
          scopeSessions: state.scopeSessions[scopeKey]
            ? state.scopeSessions
            : { ...state.scopeSessions, [scopeKey]: session },
          ...previewProjection(session),
        };
      });
    },
    openScopeConversation: (conversationId) => {
      const id = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!id) return;
      set((state) => {
        const session = activeScopeSession(state);
        const openConversationIds = session.openConversationIds.includes(id)
          ? session.openConversationIds
          : session.openConversationIds.length >= MAX_OPEN_CONVERSATIONS
            ? session.openConversationIds
            : [...session.openConversationIds, id];
        return withActiveScopeSession(state, {
          ...session,
          openConversationIds,
          activeConversationId: openConversationIds.includes(id) ? id : session.activeConversationId,
        });
      });
    },
    closeScopeConversation: (conversationId) => {
      const id = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!id) return;
      set((state) => {
        const session = activeScopeSession(state);
        const index = session.openConversationIds.indexOf(id);
        if (index < 0) return state;
        const openConversationIds = session.openConversationIds.filter((candidate) => candidate !== id);
        const activeConversationId = session.activeConversationId === id
          ? openConversationIds[index - 1] ?? openConversationIds[index] ?? null
          : session.activeConversationId;
        return withActiveScopeSession(state, { ...session, openConversationIds, activeConversationId });
      });
    },
    setScopeSurface: (surface) => {
      if (surface !== "conversation" && surface !== "split" && surface !== "file") return;
      set((state) => withActiveScopeSession(state, { ...activeScopeSession(state), surfacePreference: surface }));
    },
    setScopeSplitRatio: (ratio) => {
      if (!Number.isFinite(ratio)) return;
      const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
      set((state) => withActiveScopeSession(state, { ...activeScopeSession(state), splitRatio: clamped }));
    },
    openScopeFile: (tab) => {
      if (!tab || !tab.workspaceId || !tab.path || !tab.title) return;
      set((state) => addFileToActiveScope(state, tab));
    },
    closeScopeFile: (tab) => {
      if (!tab || !tab.workspaceId || !tab.path) return;
      set((state) => {
        const session = activeScopeSession(state);
        const key = fileTabKey(tab as ScopeFileTab);
        const index = session.fileTabs.findIndex((candidate) => fileTabKey(candidate) === key);
        if (index < 0) return state;
        const fileTabs = session.fileTabs.filter((candidate) => fileTabKey(candidate) !== key);
        const activeFileKey = session.activeFileKey === key
          ? fileTabs[index - 1] ? fileTabKey(fileTabs[index - 1]) : fileTabs[0] ? fileTabKey(fileTabs[0]) : null
          : session.activeFileKey;
        const nextSession = {
          ...session,
          fileTabs,
          activeFileKey,
          surfacePreference: fileTabs.length > 0 ? session.surfacePreference : "conversation",
        } satisfies ScopeSession;
        return {
          scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
          ...previewProjection(nextSession),
        };
      });
    },
    setScopeActiveFile: (fileKey) => {
      set((state) => {
        const session = activeScopeSession(state);
        const valid = fileKey === null || session.fileTabs.some((tab) => fileTabKey(tab) === fileKey);
        if (!valid) return state;
        const nextSession = { ...session, activeFileKey: fileKey };
        return {
          scopeSessions: { ...state.scopeSessions, [state.activeScopeKey]: nextSession },
          ...previewProjection(nextSession),
        };
      });
    },
    hydrateWorkbenchUi: (persisted, conversations) => {
      if (!persisted || typeof persisted !== "object") return;
      const payload = persisted as {
        sidebarWidth?: unknown;
        sidebarPreference?: unknown;
        activeScopeKey?: unknown;
        scopeSessions?: unknown;
        toolWidths?: unknown;
        activeWorkbenchTool?: unknown;
        workbenchToolFocused?: unknown;
      };
      const next: Partial<UiState> = {};
      const width = payload.sidebarWidth;
      if (typeof width === "number" && Number.isFinite(width)) {
        next.workbenchSidebarWidth = Math.min(WORKBENCH_SIDEBAR_WIDTH.max, Math.max(WORKBENCH_SIDEBAR_WIDTH.min, width));
      }
      if (Object.prototype.hasOwnProperty.call(payload, "sidebarPreference")) {
        const preference = isWorkbenchSidebarPreference(payload.sidebarPreference)
          ? payload.sidebarPreference
          : "auto";
        next.workbenchSidebarPreference = preference;
        next.sidebarCollapsed = preference === "compact";
      }
      if (payload.scopeSessions !== undefined) {
        const scopeSessions = sanitizeScopeSessions(payload.scopeSessions, conversations);
        if (!scopeSessions.global) scopeSessions.global = emptyScopeSession();
        next.scopeSessions = scopeSessions;
        next.activeScopeKey = isScopeKey(payload.activeScopeKey) && scopeSessions[payload.activeScopeKey]
          ? payload.activeScopeKey
          : "global";
        Object.assign(next, previewProjection(scopeSessions[next.activeScopeKey] ?? emptyScopeSession()));
      } else if (isScopeKey(payload.activeScopeKey)) {
        next.activeScopeKey = payload.activeScopeKey;
        Object.assign(next, previewProjection(
          (next.scopeSessions ?? {})[payload.activeScopeKey]
            ?? emptyScopeSession(),
        ));
      }
      if (payload.toolWidths !== undefined) next.workbenchToolWidths = sanitizeWorkbenchToolWidths(payload.toolWidths);
      const hydratedTool = payload.activeWorkbenchTool === null || isWorkbenchTool(payload.activeWorkbenchTool)
        ? payload.activeWorkbenchTool
        : undefined;
      if (hydratedTool !== undefined) next.activeWorkbenchTool = hydratedTool;
      if (typeof payload.workbenchToolFocused === "boolean") {
        const effectiveTool = hydratedTool === undefined ? null : hydratedTool;
        next.workbenchToolFocused = effectiveTool !== null && payload.workbenchToolFocused;
      }
      if (Object.keys(next).length > 0) set(next);
    },
    openWizard: () => set({ wizardOpen: true }),
    closeWizard: () => set({ wizardOpen: false }),
  }));
}
