import { describe, expect, it } from "vitest";
import type { VisualizationInput } from "../../src/bridge/visualization-spec";
import { renderVisualizationHtml } from "../../src/host/visualization-renderer";

function input(visualization: VisualizationInput["visualization"]): VisualizationInput {
  return {
    file_path: "成果.html",
    title: "<img src=x onerror=alert(1)>",
    subtitle: "安全地解释 & 对比",
    visualization,
  };
}

describe("static visualization renderer", () => {
  it("renders a standalone script-free document and escapes every supplied string", () => {
    const html = renderVisualizationHtml(input({
      kind: "table",
      columns: ["项目", "结论"],
      rows: [{ cells: ["<script>alert(1)</script>", "A & B"] }],
    }));

    expect(html.toLocaleLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'none'");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A &amp; B");
  });

  const carriers: Array<[string, VisualizationInput["visualization"], string[]]> = [
    ["table", { kind: "table", columns: ["任务", "状态"], rows: [{ cells: ["阅读", "完成"] }] }, ["<table", "阅读"]],
    ["comparison", { kind: "comparison", columns: ["方案 A", "方案 B"], rows: [{ cells: ["快", "稳"] }] }, ["comparison-grid", "方案 A"]],
    ["timeline", { kind: "timeline", events: [{ label: "起点" }, { label: "复测", date: "周五" }] }, ["timeline-list", "周五"]],
    ["flow", { kind: "flow", steps: [{ label: "阅读" }, { label: "复述" }] }, ["flow-list", "复述"]],
    ["bar", { kind: "bar", values: [{ label: "阅读", value: 4 }, { label: "写作", value: -2 }], unit: "次" }, ["bar-chart", "-2 次"]],
  ];

  it.each(carriers)("renders the fixed %s carrier", (_kind, visualization, expected) => {
    const html = renderVisualizationHtml(input(visualization));
    for (const token of expected) expect(html).toContain(token);
  });

  it("wraps schema-valid continuous text across headers and content", () => {
    const html = renderVisualizationHtml({
      ...input({
      kind: "timeline",
      events: [{ label: "A".repeat(160) }, { label: "第二步" }],
      }),
      title: "T".repeat(160),
      subtitle: "S".repeat(500),
    });

    expect(html).toMatch(/main \{[^}]*overflow-wrap: anywhere/);
  });
});
