import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BridgeContext } from "../bridge/context";
import type { BridgeStores } from "../bridge/context";
import FileTree, { kindFromName } from "./FileTree";
import { createFileTreeStore, type FileNode } from "../stores/file-tree";
import { createUiStore } from "../stores/ui";
import { createNotebooksStore, type Notebook } from "../stores/notebooks";
import { createConversationsStore } from "../stores/conversations";
import { createSettingsStore } from "../stores/settings";
import { createNotificationsStore } from "../stores/notifications";
import { createApprovalsStore } from "../stores/approvals";
import { createArtifactsStore } from "../stores/artifacts";
import { createWikiEntriesStore } from "../stores/wiki-entries";
import { createProvidersStore } from "../stores/providers";
import { createSkillsStore } from "../stores/skills";
import { createSearchSourcesStore } from "../stores/search-sources";
import { createPreviewContentStore } from "../stores/preview-content";
import { createMcpServersStore } from "../stores/mcp-servers";
import { createUsageSummaryStore } from "../stores/usage-summary";
import { createMemoryStore } from "../stores/memory";
import { createWorkspacesStore } from "../stores/workspaces";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import { FIXTURE_PROVIDERS, FIXTURE_NOTIFICATIONS } from "../bridge/fixtures";
import { wireBridgeSubscriptions } from "../bridge/wiring";
import { useContext, useMemo, useEffect, type ReactNode } from "react";

function CaptureStores({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

function TestProvider({
  roots,
  notebooks = [],
  activeNotebookId = null,
  workspaceRoot = {
    id: "leemo-home",
    name: "Leemo",
    displayPath: "/w/Leemo",
    kind: "home" as const,
    available: true,
    lastOpenedAt: 0,
  },
  children,
}: {
  roots: FileNode[];
  notebooks?: Notebook[];
  activeNotebookId?: string | null;
  workspaceRoot?: {
    id: string;
    name: string;
    displayPath: string;
    kind: "home" | "external";
    available: boolean;
    lastOpenedAt: number;
  };
  children: ReactNode;
}) {
  const stores = useMemo<BridgeStores>(() => {
    const c = new FixtureBridgeClient();
    const resolveDefaults = () => ({ providerId: FIXTURE_PROVIDERS[0].id, modelId: FIXTURE_PROVIDERS[0].models[0] });
    const workspaces = createWorkspacesStore(undefined, [workspaceRoot]);
    workspaces.setState({ activeId: workspaceRoot.id });
    return {
      conversations: createConversationsStore(c, { resolveConversationDefaults: resolveDefaults }),
      settings: createSettingsStore(),
      notifications: createNotificationsStore(FIXTURE_NOTIFICATIONS),
      approvals: createApprovalsStore(c, {}),
      artifacts: createArtifactsStore(),
      wikiEntries: createWikiEntriesStore(c, { resolveConversationDefaults: resolveDefaults }),
      providers: createProvidersStore(c, { list: FIXTURE_PROVIDERS, configuredIds: FIXTURE_PROVIDERS.map((p) => p.id) }),
      ui: createUiStore(),
      // 轮 3 卡 G: both stores now take a WorkspaceClient first. These component
      // tests exercise rendering only, so they pass none (undefined) and seed
      // state directly — no filesystem is involved.
      notebooks: (() => {
        const store = createNotebooksStore(undefined, notebooks);
        store.setState({ activeId: activeNotebookId });
        return store;
      })(),
      fileTree: createFileTreeStore(undefined, roots),
      skills: createSkillsStore(c),
      searchSources: createSearchSourcesStore(c),
      previewContent: createPreviewContentStore(),
      mcpServers: createMcpServersStore(c),
      usageSummary: createUsageSummaryStore(c),
      memory: createMemoryStore(c),
      workspaces,
    };
  }, []);

  useEffect(() => {
    const c = new FixtureBridgeClient();
    return wireBridgeSubscriptions(c, {
      conversations: stores.conversations,
      approvals: stores.approvals,
      wikiEntries: stores.wikiEntries,
    });
  }, [stores]);

  return <BridgeContext.Provider value={stores}>{children}</BridgeContext.Provider>;
}

// Workspace-RELATIVE paths whose first segment is the notebook id (轮 3 卡 G) —
// the old "/books/A/..." shape had "books" as its first segment, which is what
// made artifacts.ts bookForPath match nothing.
const SAMPLE_ROOTS: FileNode[] = [
  {
    path: "A",
    name: "A",
    kind: "dir",
    bookId: "A",
    children: [
      { path: "A/note.md", name: "note.md", kind: "file", bookId: "A", isNew: true },
      { path: "A/ref.html", name: "ref.html", kind: "file", bookId: "A", referenced: true },
    ],
  },
];

const SAMPLE_NOTEBOOKS: Notebook[] = [
  { id: "本子一", title: "本子一", dir: "/w/Leemo/本子一", color: "blue", hasMemory: false },
];

describe("FileTree", () => {
  it("renders empty state when roots is empty", () => {
    render(
      <TestProvider roots={[]}>
        <FileTree />
      </TestProvider>
    );
    // 轮 3 卡 G: the empty state now also says what to DO about it, since the
    // tree is a real directory the user can drop into.
    expect(screen.getByText("本子里还没有文件，拖一个进来试试")).toBeInTheDocument();
  });

  it("renders dir nodes", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>
    );
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows only roots owned by the active managed book", () => {
    const roots: FileNode[] = [
      { path: "A-folder", name: "A 文件", kind: "dir", bookId: "A", children: [] },
      { path: "B-folder", name: "B 文件", kind: "dir", bookId: "B", children: [] },
    ];
    render(
      <TestProvider roots={roots} activeNotebookId="A">
        <FileTree />
      </TestProvider>,
    );

    expect(screen.getByTestId("dir-row-A-folder")).toBeInTheDocument();
    expect(screen.queryByTestId("dir-row-B-folder")).not.toBeInTheDocument();
  });

  it("renders file nodes with isNew indicator", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    expect(screen.getByTestId("new-indicator")).toBeInTheDocument();
  });

  it("renders file nodes with referenced indicator", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    expect(screen.getByTestId("referenced-indicator")).toBeInTheDocument();
  });

  it("calls toggleExpand on dir click", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>
    );
    expect(screen.queryByText("note.md")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("A"));
    expect(screen.getByText("note.md")).toBeInTheDocument();
    fireEvent.click(screen.getByText("A"));
    expect(screen.queryByText("note.md")).not.toBeInTheDocument();
  });

  it("calls openPreview on file click with correct kind mapping", () => {
    let stores!: BridgeStores;
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("note.md"));
    fireEvent.click(screen.getByText("ref.html"));
    expect(stores.ui.getState().previewTabs).toEqual([
      { path: "A/note.md", title: "note.md", kind: "markdown" },
      { path: "A/ref.html", title: "ref.html", kind: "html" },
    ]);
    expect(kindFromName("note.md")).toBe("markdown");
    expect(kindFromName("research.MARKDOWN")).toBe("markdown");
    expect(kindFromName("report.PDF")).toBe("pdf");
    expect(kindFromName("notes.txt")).toBe("other");
  });

  it("exports a workspace-relative drag payload for the composer", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>,
    );
    fireEvent.click(screen.getByText("A"));
    const row = screen.getByTestId("file-row-A/note.md");
    const setData = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: "none" } });

    expect(setData).toHaveBeenCalledWith(
      "application/x-leemo-workspace-file",
      JSON.stringify({ name: "note.md", workspaceId: "leemo-home", workspacePath: "A/note.md" }),
    );
    expect(row).toHaveAttribute("draggable", "true");
  });

  it("keeps the currently open file visibly selected", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS}>
        <FileTree />
      </TestProvider>,
    );
    fireEvent.click(screen.getByText("A"));
    const row = screen.getByTestId("file-row-A/note.md");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-current", "page");
  });

  it("shows context menu on right click", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS} notebooks={SAMPLE_NOTEBOOKS}>
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.contextMenu(screen.getByTestId("file-row-A/note.md"));
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
  });

  it("disables rename/delete/show-in-folder items", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS} notebooks={SAMPLE_NOTEBOOKS}>
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.contextMenu(screen.getByTestId("file-row-A/note.md"));
    // 轮 3 卡 G: 在文件夹显示 is REAL now (the workspace is a real directory, so
    // this is just a guarded Explorer action). Rename/delete stay Phase-1 — both
    // have to repoint the bookId of conversations already filed under that name.
    expect(screen.getByTestId("rename-btn")).toBeDisabled();
    expect(screen.getByTestId("delete-btn")).toBeDisabled();
    expect(screen.getByTestId("show-in-folder-btn")).toBeEnabled();
  });

  it("calls moveToBook on notebook selection", () => {
    render(
      <TestProvider roots={SAMPLE_ROOTS} notebooks={SAMPLE_NOTEBOOKS}>
        <FileTree />
      </TestProvider>
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.contextMenu(screen.getByTestId("file-row-A/note.md"));
    fireEvent.click(screen.getByText("移入本子"));
    fireEvent.click(screen.getByTestId("move-to-book-本子一"));
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  it("treats an external folder as a project, not a collection of 本子", () => {
    render(
      <TestProvider
        roots={SAMPLE_ROOTS}
        notebooks={SAMPLE_NOTEBOOKS}
        activeNotebookId="本子一"
        workspaceRoot={{
          id: "workspace-123",
          name: "毕业设计",
          displayPath: "D:/Projects/毕业设计",
          kind: "external",
          available: true,
          lastOpenedAt: 20,
        }}
      >
        <FileTree />
      </TestProvider>,
    );
    expect(screen.getByText("毕业设计")).toBeInTheDocument();
    fireEvent.click(screen.getByText("A"));
    fireEvent.contextMenu(screen.getByTestId("file-row-A/note.md"));
    expect(screen.queryByText("移入本子")).not.toBeInTheDocument();
  });

  it("owns drops inside the file drawer instead of bubbling to the workbench", () => {
    const outerDrop = vi.fn();
    render(
      <div onDrop={outerDrop}>
        <TestProvider roots={SAMPLE_ROOTS}>
          <FileTree />
        </TestProvider>
      </div>,
    );

    fireEvent.drop(screen.getByTestId("file-tree-drop-zone"), {
      dataTransfer: { files: [] },
    });

    expect(outerDrop).not.toHaveBeenCalled();
  });
});
