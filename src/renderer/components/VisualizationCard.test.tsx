import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import VisualizationCard from "./VisualizationCard";
import { LEEMO_VISUALIZATION_TOOL_NAME } from "../bridge/tool-names";
import type { TimelineItem } from "../stores/message-model";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { VisualizationInput } from "../../bridge/visualization-spec";

describe("VisualizationCard", () => {
  const baseInput: VisualizationInput = {
    file_path: "复习趋势.html",
    title: "本周复习",
    subtitle: "阅读与写作练习",
    visualization: {
      kind: "bar",
      values: [{ label: "阅读", value: 4 }, { label: "写作", value: -2 }],
      unit: "次",
    },
  };

  const createVizItem = (
    status: "running" | "ok" | "error",
    input: unknown = baseInput,
  ): Extract<TimelineItem, { kind: "tool" }> => ({
    kind: "tool",
    id: "t1",
    runId: "run-1",
    toolUseId: "tu-1",
    name: LEEMO_VISUALIZATION_TOOL_NAME,
    input,
    status,
  });

  function renderCard(item: Extract<TimelineItem, { kind: "tool" }>) {
    let stores!: BridgeStores;
    function Capture() {
      stores = useContext(BridgeContext)!;
      return <VisualizationCard item={item} />;
    }
    const view = render(
      <BridgeProvider>
        <Capture />
      </BridgeProvider>,
    );
    return { ...view, stores };
  }

  it("renders nothing for non-visualization tools", () => {
    const item: Extract<TimelineItem, { kind: "tool" }> = {
      kind: "tool",
      id: "t1",
      runId: "run-1",
      toolUseId: "tu-1",
      name: "Read",
      input: { path: "file.txt" },
      status: "ok",
    };
    const { container } = renderCard(item);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for missing paths, raw HTML, or unknown fields", () => {
    for (const invalid of [
      { ...baseInput, file_path: undefined },
      { ...baseInput, html: "<script>alert(1)</script>" },
      { file_path: "legacy.html", html: "<div>legacy</div>" },
    ]) {
      const { container, unmount } = renderCard(createVizItem("ok", invalid));
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("keeps the running receipt compact", () => {
    renderCard(createVizItem("running"));
    expect(screen.getByText("渲染中…")).toBeInTheDocument();
    expect(screen.getByText("复习趋势.html")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "本周复习" })).not.toBeInTheDocument();
  });

  it("renders a native positive and negative bar chart without an iframe", () => {
    const { container } = renderCard(createVizItem("ok"));
    expect(screen.getByRole("heading", { name: "本周复习" })).toBeInTheDocument();
    expect(screen.getByText("阅读与写作练习")).toBeInTheDocument();
    expect(screen.getByText("4 次")).toBeInTheDocument();
    expect(screen.getByText("-2 次")).toBeInTheDocument();
    expect(container.querySelector(".leemo-viz-bar-positive")).toHaveStyle({ width: "50%" });
    expect(container.querySelector(".leemo-viz-bar-negative")).toHaveStyle({ width: "25%" });
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
  });

  it.each([
    ["table", { kind: "table", columns: ["任务", "状态"], rows: [{ cells: ["阅读", "完成"] }] }, ["任务", "完成"]],
    ["comparison", { kind: "comparison", columns: ["现在", "目标"], rows: [{ cells: ["10 分钟", "20 分钟"] }] }, ["现在", "20 分钟"]],
    ["timeline", { kind: "timeline", events: [{ label: "开始", date: "周一" }, { label: "复测", detail: "检查进步" }] }, ["周一", "检查进步"]],
    ["flow", { kind: "flow", steps: [{ label: "阅读" }, { label: "复述", detail: "不看原文" }] }, ["复述", "不看原文"]],
  ] as const)("renders the structured %s carrier", (_kind, visualization, expected) => {
    renderCard(createVizItem("ok", { ...baseInput, visualization }));
    for (const text of expected) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("wraps long timeline and flow text instead of widening a narrow conversation column", () => {
    const longToken = "SUPERCALIFRAGILISTICEXPIALIDOCIOUS0123456789";
    const { unmount } = renderCard(createVizItem("ok", {
      ...baseInput,
      visualization: { kind: "timeline", events: [{ label: longToken }, { label: "复测" }] },
    }));
    expect(screen.getByText(longToken)).toHaveClass("[overflow-wrap:anywhere]");
    unmount();

    renderCard(createVizItem("ok", {
      ...baseInput,
      visualization: { kind: "flow", steps: [{ label: longToken }, { label: "复测" }] },
    }));
    expect(screen.getByText(longToken)).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("wraps long titles and subtitles instead of clipping them", () => {
    const title = "T".repeat(160);
    const subtitle = "S".repeat(500);
    renderCard(createVizItem("ok", { ...baseInput, title, subtitle }));

    expect(screen.getByRole("heading", { name: title })).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByText(subtitle)).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("renders an honest error state without a fake retry action", () => {
    renderCard(createVizItem("error"));
    expect(screen.getByText("组件没画好")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /让 momo 重画/i })).not.toBeInTheDocument();
  });

  it("opens the durable file in preview and the artifacts view", async () => {
    const user = userEvent.setup();
    const { stores } = renderCard(createVizItem("ok"));

    await user.click(screen.getByRole("button", { name: "在成果中查看" }));
    expect(stores.ui.getState().view).toBe("artifacts");

    await user.click(screen.getByRole("button", { name: "在预览中打开" }));
    expect(stores.ui.getState().previewActivePath).toBe("复习趋势.html");
    expect(stores.ui.getState().previewTabs.at(-1)?.kind).toBe("html");
  });

  it("opens the host-projected artifact path instead of the model's root request", async () => {
    const user = userEvent.setup();
    const { stores } = renderCard(createVizItem("ok"));
    act(() => stores.artifacts.getState().registerArtifact({
      id: "conversation-1:tu-1",
      kind: "visualization",
      path: "默认工作区/复习趋势.html",
      title: "复习趋势.html",
      bookId: null,
      sourceConversationId: "conversation-1",
      sourceRunId: "run-1",
      createdAt: 1,
      escaped: false,
    }));

    expect(await screen.findByText("默认工作区/复习趋势.html")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "在预览中打开" }));
    expect(stores.ui.getState().previewActivePath).toBe("默认工作区/复习趋势.html");
  });
});
