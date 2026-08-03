import { describe, expect, it } from "vitest";
import { createUiStore } from "./ui";

describe("ui store", () => {
  it("starts with the chat surface and closed overlays", () => {
    expect(createUiStore().getState()).toMatchObject({
      view: "chat", settingsOpen: false, settingsSection: "general", searchOpen: false,
      notifPanelOpen: false, wizardOpen: false, previewOpen: false, previewWidthPx: 420,
      previewTabs: [], previewActivePath: null, filesOpen: false, sidebarCollapsed: false,
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

    expect(store.getState()).toMatchObject({ view: "skills", filesOpen: true, sidebarCollapsed: true, wizardOpen: false });
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
});
