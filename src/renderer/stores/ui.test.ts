import { describe, expect, it } from "vitest";
import { createUiStore, pickPersistedWorkbenchUi } from "./ui";

describe("ui store", () => {
  it("starts with the chat surface and closed overlays", () => {
    expect(createUiStore().getState()).toMatchObject({
      view: "chat", settingsOpen: false, settingsSection: "general", searchOpen: false,
      notifPanelOpen: false, wizardOpen: false, previewOpen: false, previewWidthPx: 420,
      previewTabs: [], previewActivePath: null, filesOpen: false, workbenchSidebarPreference: "auto",
      workspaceTransitioning: false, contextHint: null,
    });
  });

  it("keeps settings, search, and notifications mutually exclusive", () => {
    const store = createUiStore();
    store.getState().openSettings("permissions");
    expect(store.getState()).toMatchObject({ settingsOpen: true, searchOpen: false, notifPanelOpen: false });

    store.getState().toggleSearch();
    expect(store.getState()).toMatchObject({ settingsOpen: false, searchOpen: true, notifPanelOpen: false });

    store.getState().toggleNotifPanel();
    expect(store.getState()).toMatchObject({ settingsOpen: false, searchOpen: false, notifPanelOpen: true });

    store.getState().closeTopOverlay();
    expect(store.getState()).toMatchObject({ settingsOpen: false, searchOpen: false, notifPanelOpen: false });
  });

  it("opens general by default but preserves an explicitly requested section", () => {
    const store = createUiStore();
    store.getState().openSettings();
    expect(store.getState()).toMatchObject({ settingsOpen: true, settingsSection: "general" });
    store.getState().closeSettings();
    store.getState().openSettings("models");
    expect(store.getState()).toMatchObject({ settingsOpen: true, settingsSection: "models" });
  });

  it("handles view, files, sidebar, and wizard actions", () => {
    const store = createUiStore();
    store.getState().setView("skills");
    store.getState().openFiles();
    store.getState().toggleSidebar();
    store.getState().openWizard();
    store.getState().closeWizard();

    expect(store.getState()).toMatchObject({ view: "skills", filesOpen: true, workbenchSidebarPreference: "compact", wizardOpen: false });
  });

  it("stores all sidebar preferences, falls back on invalid hydrate, and persists the projection", () => {
    const store = createUiStore();
    expect(store.getState().workbenchSidebarPreference).toBe("auto");

    for (const preference of ["compact", "pinned", "auto"] as const) {
      store.getState().setWorkbenchSidebarPreference(preference);
      expect(store.getState().workbenchSidebarPreference).toBe(preference);
    }

    store.getState().setWorkbenchSidebarPreference("pinned");
    store.getState().hydrateWorkbenchUi({ sidebarPreference: "not-a-mode" });
    expect(store.getState().workbenchSidebarPreference).toBe("auto");
    expect(pickPersistedWorkbenchUi(store.getState()).sidebarPreference).toBe("auto");
  });

  it("opens the requested workboard section from a desktop notification", () => {
    const store = createUiStore();
    store.getState().openOrganizer("tasks");

    expect(store.getState()).toMatchObject({ view: "organizer", organizerTab: "tasks" });
  });

  it("deduplicates preview tabs while activating the requested path", () => {
    const store = createUiStore();
    store.getState().openPreview("/a.md", "A", "markdown");
    const tabs = store.getState().previewTabs;
    store.getState().openPreview("/b.pdf", "B", "pdf");
    store.getState().openPreview("/a.md", "A changed", "markdown");

    expect(store.getState().previewTabs).toEqual([
      { path: "/a.md", title: "A", kind: "markdown" },
      { path: "/b.pdf", title: "B", kind: "pdf" },
    ]);
    expect(store.getState().previewTabs).not.toBe(tabs);
    expect(store.getState().previewActivePath).toBe("/a.md");
    expect(store.getState().previewOpen).toBe(true);
    store.getState().closePreview();
    expect(store.getState()).toMatchObject({ previewOpen: false, previewActivePath: null });
  });

  it("treats the file tree as a temporary drawer when opening a preview", () => {
    const store = createUiStore();
    store.getState().openFiles();
    expect(store.getState().filesOpen).toBe(true);

    store.getState().openPreview("/notes.md", "Notes", "markdown");

    expect(store.getState()).toMatchObject({
      filesOpen: false,
      previewOpen: true,
      previewActivePath: "/notes.md",
    });
  });

  it("clamps preview width to 300 and rejects non-finite values", () => {
    const store = createUiStore();
    store.getState().setPreviewWidth(100);
    expect(store.getState().previewWidthPx).toBe(300);
    store.getState().setPreviewWidth(Number.NaN);
    expect(store.getState().previewWidthPx).toBe(300);
    store.getState().setPreviewWidth(640);
    expect(store.getState().previewWidthPx).toBe(640);
  });

  it("clamps and hydrates the persisted workbench sidebar width", () => {
    const store = createUiStore();
    store.getState().setWorkbenchSidebarWidth(100);
    expect(store.getState().workbenchSidebarWidth).toBe(252);
    store.getState().setWorkbenchSidebarWidth(500);
    expect(store.getState().workbenchSidebarWidth).toBe(360);
    store.getState().hydrateWorkbenchUi({ sidebarWidth: 312 });
    expect(store.getState().workbenchSidebarWidth).toBe(312);
    store.getState().hydrateWorkbenchUi({ sidebarWidth: "bad" });
    expect(store.getState().workbenchSidebarWidth).toBe(312);
  });

  it("keeps a separate session for each notebook scope", () => {
    const store = createUiStore();
    store.getState().activateWorkbenchScope("notebook:math");
    store.getState().openScopeConversation("math-conversation");
    store.getState().setScopeSurface("file");
    store.getState().setScopeSplitRatio(0.9);

    store.getState().activateWorkbenchScope("global");
    expect(store.getState().activeScopeKey).toBe("global");
    expect(store.getState().scopeSessions.global?.openConversationIds).toEqual([]);

    store.getState().activateWorkbenchScope("notebook:math");
    expect(store.getState().scopeSessions["notebook:math"]).toMatchObject({
      openConversationIds: ["math-conversation"],
      activeConversationId: "math-conversation",
      surfacePreference: "file",
      splitRatio: 0.75,
    });
  });

  it("restores each scope's active file projection when switching scopes", () => {
    const store = createUiStore();
    store.getState().openPreview("global.md", "Global", "markdown");

    store.getState().activateWorkbenchScope("notebook:math");
    expect(store.getState()).toMatchObject({
      previewOpen: false,
      previewTabs: [],
      previewActivePath: null,
    });
    store.getState().openPreview("math/notes.md", "Notes", "markdown");

    store.getState().activateWorkbenchScope("global");
    expect(store.getState()).toMatchObject({
      previewOpen: true,
      previewTabs: [{ path: "global.md", title: "Global", kind: "markdown" }],
      previewActivePath: "global.md",
    });

    store.getState().activateWorkbenchScope("notebook:math");
    expect(store.getState()).toMatchObject({
      previewOpen: true,
      previewTabs: [{ path: "math/notes.md", title: "Notes", kind: "markdown" }],
      previewActivePath: "math/notes.md",
    });
  });

  it("persists only sanitized scope state and restores active references", () => {
    const store = createUiStore();
    store.getState().hydrateWorkbenchUi({
      sidebarWidth: 300,
      activeScopeKey: "notebook:math",
      scopeSessions: {
        "notebook:math": {
          openConversationIds: ["a", "a", "b"],
          activeConversationId: "b",
          fileTabs: [{ workspaceId: "home", path: "notes.md", title: "Notes", kind: "markdown" }],
          activeFileKey: "home\u0000notes.md",
          surfacePreference: "split",
          splitRatio: 0.5,
        },
      },
    });

    expect(store.getState().activeScopeKey).toBe("notebook:math");
    expect(store.getState().scopeSessions["notebook:math"]).toMatchObject({
      openConversationIds: ["a", "b"],
      activeConversationId: "b",
      surfacePreference: "split",
      splitRatio: 0.5,
    });
    expect(store.getState().scopeSessions["notebook:math"]?.fileTabs).toHaveLength(1);
    expect(store.getState().scopeSessions["notebook:math"]?.activeFileKey).toBe("home\u0000notes.md");
    expect(store.getState()).toMatchObject({
      previewOpen: true,
      previewTabs: [{ path: "notes.md", title: "Notes", kind: "markdown" }],
      previewActivePath: "notes.md",
    });
  });

  it("closePreviewTab removes tab and switches active to left neighbor", () => {
    const store = createUiStore();
    store.getState().openPreview("/a.md", "A", "markdown");
    store.getState().openPreview("/b.md", "B", "markdown");
    store.getState().openPreview("/c.md", "C", "markdown");
    // active is /c.md; close it -> left neighbor is /b.md
    store.getState().closePreviewTab("/c.md");
    expect(store.getState().previewTabs).toEqual([
      { path: "/a.md", title: "A", kind: "markdown" },
      { path: "/b.md", title: "B", kind: "markdown" },
    ]);
    expect(store.getState().previewActivePath).toBe("/b.md");
    expect(store.getState().previewOpen).toBe(true);
  });

  it("closePreviewTab on last tab closes the preview column", () => {
    const store = createUiStore();
    store.getState().openPreview("/a.md", "A", "markdown");
    store.getState().closePreviewTab("/a.md");
    expect(store.getState().previewTabs).toEqual([]);
    expect(store.getState().previewActivePath).toBeNull();
    expect(store.getState().previewOpen).toBe(false);
  });

  it("closes every preview tab in one state transition", () => {
    const store = createUiStore();
    store.getState().openPreview("/a.md", "A", "markdown");
    store.getState().openPreview("/b.pdf", "B", "pdf");

    store.getState().closeAllPreviewTabs();

    expect(store.getState().previewTabs).toEqual([]);
    expect(store.getState().previewActivePath).toBeNull();
    expect(store.getState().previewOpen).toBe(false);
  });

  it("shares the workspace transition lock with the preview editor", () => {
    const store = createUiStore();
    store.getState().setWorkspaceTransitioning(true);
    expect(store.getState().workspaceTransitioning).toBe(true);
    store.getState().setWorkspaceTransitioning(false);
    expect(store.getState().workspaceTransitioning).toBe(false);
  });

  it("closePreviewTab on non-active tab does not change activePath", () => {
    const store = createUiStore();
    store.getState().openPreview("/a.md", "A", "markdown");
    store.getState().openPreview("/b.md", "B", "markdown");
    // active is /b.md; close /a.md
    store.getState().closePreviewTab("/a.md");
    expect(store.getState().previewTabs).toEqual([
      { path: "/b.md", title: "B", kind: "markdown" },
    ]);
    expect(store.getState().previewActivePath).toBe("/b.md");
  });

  it("only clears the context hint that owns the timer", () => {
    const store = createUiStore();
    store.getState().noteContextApplied(2, 100);
    store.getState().clearContextHint(99);
    expect(store.getState().contextHint).toEqual({ at: 100, count: 2 });

    store.getState().clearContextHint(100);
    expect(store.getState().contextHint).toBeNull();
  });

  it("keeps the workbench tool rail mutually exclusive and remembers each width", () => {
    const store = createUiStore();
    expect(store.getState().activeWorkbenchTool).toBeNull();

    store.getState().toggleWorkbenchTool("files");
    expect(store.getState().activeWorkbenchTool).toBe("files");
    store.getState().setWorkbenchToolWidth("files", 460);
    store.getState().toggleWorkbenchTool("overview");
    expect(store.getState().activeWorkbenchTool).toBe("overview");
    expect(store.getState().workbenchToolWidths.files).toBe(460);
    store.getState().toggleWorkbenchTool("overview");
    expect(store.getState().activeWorkbenchTool).toBeNull();
  });

  it("clamps tool widths and restores them from persisted UI state", () => {
    const store = createUiStore();
    store.getState().setWorkbenchToolWidth("search", 100);
    expect(store.getState().workbenchToolWidths.search).toBe(280);
    store.getState().setWorkbenchToolWidth("search", 900);
    expect(store.getState().workbenchToolWidths.search).toBe(520);
    store.getState().hydrateWorkbenchUi({
      toolWidths: { files: 312, overview: 410, search: 390 },
      activeWorkbenchTool: "search",
      workbenchToolFocused: true,
    });
    expect(store.getState()).toMatchObject({
      activeWorkbenchTool: "search",
      workbenchToolFocused: true,
      workbenchToolWidths: { files: 312, overview: 410, search: 390 },
    });

    store.getState().hydrateWorkbenchUi({
      activeWorkbenchTool: null,
      workbenchToolFocused: true,
    });
    expect(store.getState()).toMatchObject({
      activeWorkbenchTool: null,
      workbenchToolFocused: false,
    });
  });
});
