import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";
import { ArtifactsPage } from "./ArtifactsPage";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { ArtifactEntry } from "../stores/artifacts";

const ENTRIES: ArtifactEntry[] = [
  {
    id: "a-file",
    kind: "file",
    path: "数据结构/复习提纲.md",
    title: "复习提纲.md",
    bookId: "数据结构",
    sourceConversationId: "conv-source",
    sourceRunId: "run-1",
    createdAt: 100,
    escaped: false,
  },
  {
    id: "a-viz",
    kind: "visualization",
    path: "数据结构/复杂度图.html",
    title: "复杂度图.html",
    bookId: "数据结构",
    sourceConversationId: "conv-source",
    sourceRunId: "run-2",
    createdAt: 200,
    escaped: false,
  },
];

function renderPage({
  entries = ENTRIES,
  status = "ready",
  error = null,
  activeWorkspaceId = "leemo-home",
}: {
  entries?: ArtifactEntry[];
  status?: "loading" | "ready" | "error";
  error?: string | null;
  activeWorkspaceId?: string;
} = {}) {
  let stores!: BridgeStores;
  function Seed() {
    stores = useContext(BridgeContext)!;
    stores.artifacts.setState({ entries, status, error });
    stores.notebooks.setState({
      list: [{ id: "数据结构", title: "数据结构", dir: "C:\\Leemo\\数据结构", color: "blue", hasMemory: false }],
    });
    stores.conversations.setState({
      byId: {
        "conv-source": {
          id: "conv-source",
          title: "期末复习任务",
          titleManuallyUpdated: true,
          bookId: "数据结构",
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 1,
          lastActivityAt: 1,
          unread: false,
        },
      },
      order: ["conv-source"],
    });
    stores.workspaces?.setState({
      activeId: activeWorkspaceId,
      list: [
        {
          id: "leemo-home",
          name: "Leemo",
          displayPath: "C:\\Leemo",
          kind: "home",
          available: true,
          lastOpenedAt: 0,
        },
        {
          id: "workspace-project",
          name: "Demo",
          displayPath: "D:\\Projects\\demo",
          kind: "external",
          available: true,
          lastOpenedAt: 1,
        },
      ],
    });
    return <ArtifactsPage />;
  }
  const view = render(
    <BridgeProvider>
      <Seed />
    </BridgeProvider>,
  );
  return { ...view, stores };
}

describe("ArtifactsPage", () => {
  it("renders a deliberate empty state with a real route back to chat", async () => {
    const user = userEvent.setup();
    const { stores } = renderPage({ entries: [] });
    act(() => stores.ui.getState().setView("artifacts"));
    expect(screen.getByRole("heading", { name: "成果" })).toBeInTheDocument();
    expect(screen.getByText("还没有成果")).toBeInTheDocument();
    expect(screen.queryByLabelText("成果类型")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "回到对话" }));
    expect(stores.ui.getState().view).toBe("chat");
  });

  it("renders loading state from the real store lifecycle", () => {
    renderPage({ entries: [], status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("正在整理成果");
  });

  it("renders an error from the real store lifecycle", () => {
    renderPage({ entries: [], status: "error", error: "成果记录读取失败" });
    expect(screen.getByText("成果记录读取失败")).toBeInTheDocument();
  });

  it("groups populated results and filters files from visualizations", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText("数据结构")).toBeInTheDocument();
    expect(screen.getByText("复习提纲.md")).toBeInTheDocument();
    expect(screen.getByText("复杂度图.html")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByText("复习提纲.md")).toBeInTheDocument();
    expect(screen.queryByText("复杂度图.html")).not.toBeInTheDocument();
  });

  it("opens a real preview with the file's actual kind", async () => {
    const user = userEvent.setup();
    const { stores } = renderPage();
    await user.click(screen.getByRole("button", { name: "预览 复习提纲.md" }));
    expect(stores.ui.getState().previewActivePath).toBe("数据结构/复习提纲.md");
    expect(stores.ui.getState().previewTabs.at(-1)?.kind).toBe("markdown");
  });

  it("returns to the artifact's source conversation", async () => {
    const user = userEvent.setup();
    const { stores } = renderPage();
    act(() => stores.ui.getState().setView("artifacts"));
    await user.click(screen.getByRole("button", { name: "回到 复习提纲.md 的来源对话" }));
    expect(stores.conversations.getState().activeId).toBe("conv-source");
    expect(stores.ui.getState().view).toBe("chat");
  });

  it("shows only artifacts from the active workspace", () => {
    renderPage({
      activeWorkspaceId: "workspace-project",
      entries: [
        ...ENTRIES,
        {
          ...ENTRIES[0],
          id: "project-file",
          workspaceId: "workspace-project",
          path: "README.md",
          title: "README.md",
          bookId: null,
        },
      ],
    });

    expect(screen.getAllByText("README.md")).toHaveLength(2);
    expect(screen.queryByText("复习提纲.md")).not.toBeInTheDocument();
    expect(screen.queryByText("复杂度图.html")).not.toBeInTheDocument();
    expect(screen.getByText("1 项")).toBeInTheDocument();
  });
});
