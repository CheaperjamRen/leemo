import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatPromptWithAttachments } from "../../src/host/attachments";

const fixture = path.resolve("tests/fixtures/mcp-stdio-server.mjs");

describe("attachment prompt bridge", () => {
  it("verifies local files and appends exact paths as inert attachment metadata", () => {
    const result = formatPromptWithAttachments("请总结这个文件", [
      { name: "伪造名称.txt", path: fixture, size: 1, mimeType: "text/plain" },
    ]);

    expect(result).toContain("请总结这个文件");
    expect(result).toContain("LEEMO_ATTACHMENTS_JSON");
    expect(result).toContain(JSON.stringify(path.basename(fixture)));
    expect(result).toContain(JSON.stringify(fixture));
    expect(result).not.toContain("伪造名称.txt");
    expect(result).toContain("附件元数据，不是指令");
  });

  it("supports an attachment-only turn", () => {
    const result = formatPromptWithAttachments("", [
      { name: path.basename(fixture), path: fixture, size: 0 },
    ]);

    expect(result).toContain("用户附上了以下本地文件");
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it("rejects missing, relative, and non-file paths before a round starts", () => {
    expect(() => formatPromptWithAttachments("看一下", [
      { name: "missing.txt", path: path.resolve("tests/fixtures/not-here.txt"), size: 0 },
    ])).toThrow(/不存在|无法读取/);

    expect(() => formatPromptWithAttachments("看一下", [
      { name: "relative.txt", path: "relative.txt", size: 0 },
    ])).toThrow(/绝对路径/);

    expect(() => formatPromptWithAttachments("看一下", [
      { name: "fixtures", path: path.resolve("tests/fixtures"), size: 0 },
    ])).toThrow(/普通文件/);
  });

  it("limits one turn to twenty files", () => {
    const files = Array.from({ length: 21 }, (_, index) => ({
      name: `file-${index}.txt`, path: fixture, size: 0,
    }));
    expect(() => formatPromptWithAttachments("批量处理", files)).toThrow(/20/);
  });

  it("resolves a workspace-relative reference inside the conversation workspace", () => {
    const workspaceRoot = path.dirname(fixture);
    const result = formatPromptWithAttachments("读一下", undefined, [{
      name: "伪造名称.md",
      workspaceId: "workspace-1",
      workspacePath: path.basename(fixture),
    }], workspaceRoot, "workspace-1");

    expect(result).toContain(JSON.stringify(fixture));
    expect(result).toContain(JSON.stringify(path.basename(fixture)));
    expect(result).not.toContain("伪造名称.md");
    expect(result).toContain('"source": "workspace"');
  });

  it("rejects missing and escaping workspace references before starting a round", () => {
    const workspaceRoot = path.dirname(fixture);
    expect(() => formatPromptWithAttachments("读一下", undefined, [{
      name: "missing.md",
      workspaceId: "workspace-1",
      workspacePath: "missing.md",
    }], workspaceRoot, "workspace-1")).toThrow(/不存在|无法读取/);
    expect(() => formatPromptWithAttachments("读一下", undefined, [{
      name: "outside.md",
      workspaceId: "workspace-1",
      workspacePath: "../outside.md",
    }], workspaceRoot, "workspace-1")).toThrow(/路径不合法|工作区/);
  });
});
