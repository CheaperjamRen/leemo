import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVisualizationMcp,
  LEEMO_VISUALIZATION_TOOL_NAME,
} from "../../src/bridge/visualization-mcp";
import type { VisualizationInput } from "../../src/bridge/visualization-spec";
import { deriveArtifact } from "../../src/renderer/stores/artifacts";

const temporaryDirectories: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-visualization-mcp-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "默认工作区"), { recursive: true });
  fs.mkdirSync(path.join(root, ".leemo", "memory"), { recursive: true });
  return root;
}

function draft(overrides: Partial<VisualizationInput> = {}): VisualizationInput {
  return {
    file_path: "复习趋势.html",
    title: "复习趋势",
    visualization: {
      kind: "bar",
      values: [{ label: "阅读", value: 4 }, { label: "写作", value: 2 }],
      unit: "次",
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("visualization MCP", () => {
  it("uses the stable production tool name", () => {
    expect(LEEMO_VISUALIZATION_TOOL_NAME)
      .toBe("mcp__leemo-visualization__create_visualization");
  });

  it("creates a standalone artifact and adds the html extension", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const visualizations = createVisualizationMcp({ workspaceRoot: root, cwd });

    const result = await visualizations.runCreateVisualization(draft({ file_path: "复习趋势" }));
    const expectedPath = path.join(cwd, "复习趋势.html");

    expect(result).toMatchObject({ isError: false, actualPath: expectedPath });
    expect(result.text).toContain("已创建可视化成果");
    expect(result.text).not.toContain("<!doctype html>");
    expect(fs.readFileSync(expectedPath, "utf8")).toContain("data-kind=\"bar\"");
  });

  it("keeps an extensionless tool input aligned with the indexed artifact path", async () => {
    const root = workspace();
    const visualizations = createVisualizationMcp({
      workspaceRoot: root,
      cwd: root,
      routeRootWritePath: (relativePath) => path.join("默认工作区", relativePath),
    });
    const input = draft({ file_path: "复习趋势" });

    const result = await visualizations.runCreateVisualization(input);
    const artifact = deriveArtifact({
      kind: "tool",
      id: "tool-row",
      runId: "run-1",
      toolUseId: "tool-1",
      name: LEEMO_VISUALIZATION_TOOL_NAME,
      input,
      status: "ok",
    }, {
      conversationId: "conversation-1",
      runId: "run-1",
      books: [],
      now: 1,
      workspaceRoot: root,
      bookId: null,
    });

    expect(result.isError).toBe(false);
    expect(artifact).not.toBeNull();
    expect(path.resolve(root, artifact!.path)).toBe(result.actualPath);
  });

  it("routes a root artifact into the default workspace", async () => {
    const root = workspace();
    const visualizations = createVisualizationMcp({
      workspaceRoot: root,
      cwd: root,
      routeRootWritePath: (relativePath) => path.join("默认工作区", relativePath),
    });

    const result = await visualizations.runCreateVisualization(draft({ file_path: "计划/本周.html" }));
    const expectedPath = path.join(root, "默认工作区", "计划", "本周.html");
    expect(result).toMatchObject({ isError: false, actualPath: expectedPath });
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("rejects traversal, governed memory, wrong extensions, and raw HTML", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const visualizations = createVisualizationMcp({ workspaceRoot: root, cwd });

    for (const file_path of ["../../越界.html", "../.leemo/memory/污染.html", "错误.svg"]) {
      const result = await visualizations.runCreateVisualization(draft({ file_path }));
      expect(result.isError, file_path).toBe(true);
    }

    const rawHtml = await visualizations.runCreateVisualization({
      ...draft(),
      html: "<script>alert(1)</script>",
    } as VisualizationInput);
    expect(rawHtml.isError).toBe(true);
    expect(fs.existsSync(path.join(cwd, "复习趋势.html"))).toBe(false);
  });

  it("never overwrites silently and replaces only when overwrite is explicit", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const target = path.join(cwd, "复习趋势.html");
    const visualizations = createVisualizationMcp({ workspaceRoot: root, cwd });

    expect((await visualizations.runCreateVisualization(draft())).isError).toBe(false);
    const original = fs.readFileSync(target, "utf8");
    const changed = draft({
      title: "第二版",
      visualization: { kind: "flow", steps: [{ label: "读" }, { label: "练" }] },
    });
    const duplicate = await visualizations.runCreateVisualization(changed);
    expect(duplicate.isError).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe(original);

    const replaced = await visualizations.runCreateVisualization({ ...changed, overwrite: true });
    expect(replaced.isError).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toContain("第二版");
    expect(fs.readdirSync(cwd)).toEqual(["复习趋势.html"]);
  });

  it("escapes hostile labels in the durable file", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const visualizations = createVisualizationMcp({ workspaceRoot: root, cwd });
    const result = await visualizations.runCreateVisualization(draft({
      title: "<img src=x onerror=alert(1)>",
      visualization: {
        kind: "timeline",
        events: [{ label: "<script>alert(1)</script>" }, { label: "结束" }],
      },
    }));

    expect(result.isError).toBe(false);
    const html = fs.readFileSync(path.join(cwd, "复习趋势.html"), "utf8");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
