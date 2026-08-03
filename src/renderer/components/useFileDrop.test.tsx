import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { BridgeContext, type BridgeStores } from "../bridge/context";
import { useFileDrop } from "./useFileDrop";
import { createNotebooksStore } from "../stores/notebooks";
import { createFileTreeStore } from "../stores/file-tree";
import { createConversationsStore } from "../stores/conversations";
import { createSettingsStore } from "../stores/settings";
import { createNotificationsStore } from "../stores/notifications";
import { createApprovalsStore } from "../stores/approvals";
import { createArtifactsStore } from "../stores/artifacts";
import { createWikiEntriesStore } from "../stores/wiki-entries";
import { createProvidersStore } from "../stores/providers";
import { createUiStore } from "../stores/ui";
import { createSkillsStore } from "../stores/skills";
import { createSearchSourcesStore } from "../stores/search-sources";
import { createPreviewContentStore } from "../stores/preview-content";
import { createMcpServersStore } from "../stores/mcp-servers";
import { createUsageSummaryStore } from "../stores/usage-summary";
import { createMemoryStore } from "../stores/memory";
import { createWorkspacesStore } from "../stores/workspaces";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import type { WorkspaceClient, WorkspaceNotebook, PlacedFile, WorkspaceRootInfo } from "../workspace/client";

// The Workspace client rides its own context (BridgeProvider supplies it in the
// app). These tests mount both contexts directly, so the hook sees a fake
// filesystem with no Electron involved.
import { WorkspaceContext } from "../bridge/context";

const nb = (id: string): WorkspaceNotebook => ({
  id,
  title: id,
  dir: `/w/Leemo/${id}`,
  color: "blue",
  hasMemory: false,
});

function fakeWorkspace(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [nb("高等数学")] }),
    createNotebook: async () => nb("x"),
    ensureStarterNotebook: async () => nb("例：高等数学"),
    readTree: async () => [],
    dropFiles: async (): Promise<PlacedFile[]> => [],
    moveFile: async () => ({ path: "x", name: "x", bookId: null }),
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
    reveal: async () => {},
    // Stand-in for the preload's webUtils.getPathForFile.
    pathForFile: (f: File) => `C:\\Downloads\\${f.name}`,
    ...over,
  };
}

const HOME: WorkspaceRootInfo = {
  id: "leemo-home",
  name: "Leemo",
  displayPath: "/w/Leemo",
  kind: "home" as const,
  available: true,
  lastOpenedAt: 0,
};
const EXTERNAL: WorkspaceRootInfo = {
  id: "workspace-123",
  name: "毕业设计",
  displayPath: "D:/Projects/毕业设计",
  kind: "external" as const,
  available: true,
  lastOpenedAt: 20,
};

function mount(
  workspace: WorkspaceClient | undefined,
  activeNotebook: string | null,
  activeWorkspace: WorkspaceRootInfo = HOME,
) {
  let stores!: BridgeStores;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value = useMemo<BridgeStores>(() => {
      const c = new FixtureBridgeClient();
      const resolveDefaults = () => ({ providerId: "p", modelId: "m" });
      const notebooks = createNotebooksStore(workspace, [nb("高等数学")]);
      notebooks.setState({ activeId: activeNotebook });
      const workspaces = createWorkspacesStore(workspace, [HOME, activeWorkspace]);
      workspaces.setState({ activeId: activeWorkspace.id });
      return {
        conversations: createConversationsStore(c, { resolveConversationDefaults: resolveDefaults }),
        settings: createSettingsStore(),
        notifications: createNotificationsStore([]),
        approvals: createApprovalsStore(c, {}),
        artifacts: createArtifactsStore(),
        wikiEntries: createWikiEntriesStore(c, { resolveConversationDefaults: resolveDefaults }),
        providers: createProvidersStore(c, {}),
        ui: createUiStore(),
        notebooks,
        fileTree: createFileTreeStore(workspace, [], {
          resolveWorkspaceId: () => workspaces.getState().activeId,
        }),
        skills: createSkillsStore(c),
        searchSources: createSearchSourcesStore(c),
        previewContent: createPreviewContentStore(),
        mcpServers: createMcpServersStore(c),
        usageSummary: createUsageSummaryStore(c),
        memory: createMemoryStore(c),
        workspaces,
      };
    }, []);
    stores = value;
    return (
      <BridgeContext.Provider value={value}>
        <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
      </BridgeContext.Provider>
    );
  };
  const hook = renderHook(() => useFileDrop(), { wrapper });
  return { hook, getStores: () => stores };
}

const file = (name: string): File => new File(["x"], name, { type: "application/pdf" });

describe("useFileDrop — 06 §2.2 归类三条路", () => {
  it("with an active 本子: lands directly, no confirmation bar", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => [
      { path: "高等数学/讲义.pdf", name: "讲义.pdf", bookId: "高等数学" },
    ]);
    const suggestNotebook = vi.fn(async () => null);
    const { hook } = mount(fakeWorkspace({ dropFiles, suggestNotebook }), "高等数学");

    act(() => {
      expect(hook.result.current.handleDrop([file("讲义.pdf")])).toBe(true);
    });

    await waitFor(() =>
      expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\讲义.pdf"], "高等数学", "leemo-home"),
    );
    // The user already said where they are — asking again would be noise.
    expect(hook.result.current.pending).toBeNull();
    expect(suggestNotebook).not.toHaveBeenCalled();
  });

  it("with no 本子: asks momo, shows the confirmation bar, files nothing yet", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook } = mount(
      fakeWorkspace({ dropFiles, suggestNotebook: async () => "高等数学" }),
      null,
    );

    act(() => {
      hook.result.current.handleDrop([file("高等数学-第三章.pdf")]);
    });

    await waitFor(() => expect(hook.result.current.pending).not.toBeNull());
    expect(hook.result.current.pending).toMatchObject({
      fileName: "高等数学-第三章.pdf",
      suggestion: "高等数学",
    });
    // Nothing is copied until the user confirms.
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("confirm() files into the chosen 本子 and clears the bar", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook } = mount(fakeWorkspace({ dropFiles, suggestNotebook: async () => "高等数学" }), null);

    act(() => {
      hook.result.current.handleDrop([file("a.pdf")]);
    });
    await waitFor(() => expect(hook.result.current.pending).not.toBeNull());

    act(() => hook.result.current.confirm("高等数学"));
    await waitFor(() => expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\a.pdf"], "高等数学", "leemo-home"));
    expect(hook.result.current.pending).toBeNull();
  });

  it("confirm(null) selects the 默认工作区 fallback", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook } = mount(fakeWorkspace({ dropFiles }), null);

    act(() => {
      hook.result.current.handleDrop([file("扫描件_0413.jpg")]);
    });
    await waitFor(() => expect(hook.result.current.pending).not.toBeNull());
    // momo genuinely can't tell → no suggestion, 默认工作区 is the honest answer.
    expect(hook.result.current.pending!.suggestion).toBeNull();

    act(() => hook.result.current.confirm(null));
    await waitFor(() => expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\扫描件_0413.jpg"], null, "leemo-home"));
  });

  it("cancels a visible HOME confirmation when the user switches workspaces", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook, getStores } = mount(
      fakeWorkspace({ dropFiles, suggestNotebook: async () => "高等数学" }),
      null,
    );

    act(() => {
      hook.result.current.handleDrop([file("留在原工作区.pdf")]);
    });
    await waitFor(() => expect(hook.result.current.pending).toMatchObject({
      fileName: "留在原工作区.pdf",
      workspaceId: HOME.id,
    }));

    act(() => {
      getStores().workspaces!.setState({ list: [HOME, EXTERNAL], activeId: EXTERNAL.id });
    });
    await waitFor(() => expect(hook.result.current.pending).toBeNull());
    act(() => hook.result.current.confirm(null));

    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("does not resurrect a HOME confirmation when its suggestion resolves after a workspace switch", async () => {
    let resolveSuggestion!: (value: string | null) => void;
    const suggestionPending = new Promise<string | null>((resolve) => { resolveSuggestion = resolve; });
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook, getStores } = mount(
      fakeWorkspace({ dropFiles, suggestNotebook: () => suggestionPending }),
      null,
    );

    act(() => {
      hook.result.current.handleDrop([file("迟到建议.pdf")]);
    });
    act(() => {
      getStores().workspaces!.setState({ list: [HOME, EXTERNAL], activeId: EXTERNAL.id });
    });
    await act(async () => {
      resolveSuggestion("高等数学");
      await suggestionPending;
    });

    await waitFor(() => expect(hook.result.current.pending).toBeNull());
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("cancels a visible HOME confirmation when the user enters a managed book", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook, getStores } = mount(
      fakeWorkspace({ dropFiles, suggestNotebook: async () => "高等数学" }),
      null,
    );

    act(() => {
      hook.result.current.handleDrop([file("留在工作台.pdf")]);
    });
    await waitFor(() => expect(hook.result.current.pending).toMatchObject({
      fileName: "留在工作台.pdf",
      workspaceId: HOME.id,
    }));

    act(() => {
      getStores().notebooks.setState({ activeId: "高等数学" });
    });
    await waitFor(() => expect(hook.result.current.pending).toBeNull());
    act(() => hook.result.current.confirm(null));

    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("does not resurrect a HOME confirmation when its suggestion resolves after entering a managed book", async () => {
    let resolveSuggestion!: (value: string | null) => void;
    const suggestionPending = new Promise<string | null>((resolve) => { resolveSuggestion = resolve; });
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook, getStores } = mount(
      fakeWorkspace({ dropFiles, suggestNotebook: () => suggestionPending }),
      null,
    );

    act(() => {
      hook.result.current.handleDrop([file("迟到到另一本子.pdf")]);
    });
    act(() => {
      getStores().notebooks.setState({ activeId: "高等数学" });
    });
    await act(async () => {
      resolveSuggestion("高等数学");
      await suggestionPending;
    });

    await waitFor(() => expect(hook.result.current.pending).toBeNull());
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("in an external workspace: drops directly at the project root without notebook confirmation", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => [
      { path: "讲义.pdf", name: "讲义.pdf", bookId: null },
    ]);
    const suggestNotebook = vi.fn(async () => "高等数学");
    const { hook } = mount(fakeWorkspace({ dropFiles, suggestNotebook }), "高等数学", EXTERNAL);

    act(() => {
      expect(hook.result.current.handleDrop([file("讲义.pdf")])).toBe(true);
    });

    await waitFor(() => expect(dropFiles).toHaveBeenCalledWith(
      ["C:\\Downloads\\讲义.pdf"],
      null,
      "workspace-123",
    ));
    expect(hook.result.current.pending).toBeNull();
    expect(suggestNotebook).not.toHaveBeenCalled();
  });

  it("cancel() copies nothing at all", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => []);
    const { hook } = mount(fakeWorkspace({ dropFiles }), null);

    act(() => {
      hook.result.current.handleDrop([file("a.pdf")]);
    });
    await waitFor(() => expect(hook.result.current.pending).not.toBeNull());

    act(() => hook.result.current.cancel());
    expect(hook.result.current.pending).toBeNull();
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("still shows the bar when the suggestion lookup fails (never guesses silently)", async () => {
    const { hook } = mount(
      fakeWorkspace({ suggestNotebook: async () => { throw new Error("EPERM"); } }),
      null,
    );
    act(() => {
      hook.result.current.handleDrop([file("a.pdf")]);
    });
    await waitFor(() => expect(hook.result.current.pending).not.toBeNull());
    expect(hook.result.current.pending!.suggestion).toBeNull();
  });

  it("ignores a drag that carried no real OS file (text selection, HTML)", () => {
    const { hook } = mount(fakeWorkspace({ pathForFile: () => "" }), "高等数学");
    act(() => {
      expect(hook.result.current.handleDrop([file("a.pdf")])).toBe(false);
    });
    expect(hook.result.current.pending).toBeNull();
  });

  it("is disabled with no workspace (browser dev) and claims no drop", () => {
    const { hook } = mount(undefined, null);
    expect(hook.result.current.enabled).toBe(false);
    act(() => {
      expect(hook.result.current.handleDrop([file("a.pdf")])).toBe(false);
    });
  });
});
