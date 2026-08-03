import { describe, expect, it } from "vitest";
import {
  LEEMO_VISUALIZATION_TOOL_NAME,
  parseVisualizationInput,
} from "../../src/bridge/visualization-spec";

const base = {
  file_path: "复习进度.html",
  title: "本周复习",
};

describe("visualization specification", () => {
  it("uses one stable first-party qualified tool name", () => {
    expect(LEEMO_VISUALIZATION_TOOL_NAME)
      .toBe("mcp__leemo-visualization__create_visualization");
  });

  it.each([
    { kind: "table", columns: ["任务", "状态"], rows: [{ cells: ["阅读", "完成"] }] },
    { kind: "comparison", columns: ["现在", "目标"], rows: [{ cells: ["每天 10 分钟", "每天 20 分钟"] }] },
    { kind: "timeline", events: [{ label: "开始", date: "8 月 2 日" }, { label: "复测", detail: "检查进步" }] },
    { kind: "flow", steps: [{ label: "阅读" }, { label: "复述", detail: "不用看原文" }] },
    { kind: "bar", values: [{ label: "阅读", value: 4 }, { label: "写作", value: -2 }], unit: "次" },
  ])("accepts the bounded $kind carrier", (visualization) => {
    expect(parseVisualizationInput({ ...base, visualization })).toMatchObject({
      file_path: base.file_path,
      visualization: { kind: visualization.kind },
    });
  });

  it("rejects raw HTML and every unknown field", () => {
    expect(parseVisualizationInput({
      ...base,
      html: "<script>alert(1)</script>",
      visualization: { kind: "bar", values: [{ label: "阅读", value: 4 }] },
    })).toBeNull();
    expect(parseVisualizationInput({
      ...base,
      visualization: {
        kind: "bar",
        values: [{ label: "阅读", value: 4, onClick: "steal()" }],
      },
    })).toBeNull();
  });

  it("rejects table rows whose cell count does not match the columns", () => {
    expect(parseVisualizationInput({
      ...base,
      visualization: {
        kind: "table",
        columns: ["任务", "状态"],
        rows: [{ cells: ["只有一格"] }],
      },
    })).toBeNull();
  });

  it("rejects unbounded or structurally empty visualizations", () => {
    expect(parseVisualizationInput({
      ...base,
      visualization: { kind: "flow", steps: [{ label: "只有一步" }] },
    })).toBeNull();
    expect(parseVisualizationInput({
      ...base,
      visualization: { kind: "bar", values: [{ label: "坏值", value: Number.POSITIVE_INFINITY }] },
    })).toBeNull();
    expect(parseVisualizationInput({
      ...base,
      visualization: { kind: "table", columns: ["一", "二"], rows: [] },
    })).toBeNull();
  });
});
