import { createStore, type StoreApi } from "zustand/vanilla";

export interface UiState {
  view: "chat" | "skills" | "artifacts" | "scheduled" | "learning";
  settingsOpen: boolean;
  settingsSection: "models" | "momo" | "web" | "permissions" | "usage" | "extensions" | "general";
  searchOpen: boolean;
  notifPanelOpen: boolean;
  wizardOpen: boolean;
  previewOpen: boolean;
  previewWidthPx: number;
  previewTabs: { path: string; title: string; kind: "markdown" | "pdf" | "html" | "other" }[];
  previewActivePath: string | null;
  filesOpen: boolean;
  sidebarCollapsed: boolean;
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
  openPreview(path: string, title: string, kind: UiState["previewTabs"][number]["kind"]): void;
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
  openWizard(): void;
  closeWizard(): void;
}

const isView = (value: unknown): value is UiState["view"] => value === "chat" || value === "skills" || value === "artifacts" || value === "scheduled" || value === "learning";
const isSection = (value: unknown): value is UiState["settingsSection"] =>
  value === "models" || value === "momo" || value === "web" || value === "permissions" || value === "usage" || value === "extensions" || value === "general";

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
        const exists = state.previewTabs.some((tab) => tab.path === path);
        return {
          filesOpen: false,
          previewOpen: true,
          previewActivePath: path,
          previewTabs: exists ? state.previewTabs : [...state.previewTabs, { path, title, kind }],
        };
      });
    },
    closePreview: () => set({ previewOpen: false, previewActivePath: null }),
    closePreviewTab: (path) => set((state) => {
      const tabs = state.previewTabs.filter(t => t.path !== path);
      let activePath = state.previewActivePath;
      if (activePath === path) {
        const idx = state.previewTabs.findIndex(t => t.path === path);
        activePath = tabs[idx - 1]?.path ?? tabs[idx]?.path ?? null;
      }
      return { previewTabs: tabs, previewActivePath: activePath, previewOpen: tabs.length > 0 };
    }),
    closeAllPreviewTabs: () => set({ previewTabs: [], previewActivePath: null, previewOpen: false }),
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
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    openWizard: () => set({ wizardOpen: true }),
    closeWizard: () => set({ wizardOpen: false }),
  }));
}
