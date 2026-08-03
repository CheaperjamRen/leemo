import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph } from "docx";
import {
  createDocumentMcp,
  LEEMO_DOCUMENT_TOOL_NAMES,
} from "../../src/bridge/document-mcp";
import { LEEMO_DOCUMENT_CREATE_TOOL_NAMES } from "../../src/renderer/bridge/tool-names";
import { expectSameExistingPath } from "../helpers/path-identity";

const temporaryDirectories: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-document-mcp-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "默认工作区"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
describe("document MCP", () => {
  it("uses stable, exact qualified tool names", () => {
    expect(LEEMO_DOCUMENT_TOOL_NAMES).toEqual({
      read: "mcp__leemo-documents__read_document",
      editWord: "mcp__leemo-documents__edit_word_document",
      createWord: "mcp__leemo-documents__create_word_document",
      createPresentation: "mcp__leemo-documents__create_presentation",
      createSpreadsheet: "mcp__leemo-documents__create_spreadsheet",
    });
    expect(LEEMO_DOCUMENT_CREATE_TOOL_NAMES).toEqual({
      editWord: LEEMO_DOCUMENT_TOOL_NAMES.editWord,
      createWord: LEEMO_DOCUMENT_TOOL_NAMES.createWord,
      createPresentation: LEEMO_DOCUMENT_TOOL_NAMES.createPresentation,
      createSpreadsheet: LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet,
    });
  });

  it("edits an existing Word document into a default copy and keeps the source unchanged", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const source = path.join(cwd, "简历.docx");
    const sourceBytes = await Packer.toBuffer(new Document({
      sections: [{ children: [new Paragraph("擅长旧技术栈")]}],
    }));
    fs.writeFileSync(source, sourceBytes);
    const documents = createDocumentMcp({ workspaceRoot: root, cwd });

    const edited = await documents.runEditWordDocument({
      file_path: "简历.docx",
      replacements: [{ find: "旧技术栈", replace: "AI Agent 产品开发" }],
    });

    const output = path.join(cwd, "简历-修改版.docx");
    expect(edited).toMatchObject({ isError: false });
    expectSameExistingPath(edited.actualPath, output);
    expect(edited.text).toContain("已修改 Word 文档副本");
    expect(edited.text).toContain("1 处");
    expect(fs.readFileSync(source)).toEqual(sourceBytes);
    expect((await documents.runReadDocument({ file_path: "简历-修改版.docx" })).text)
      .toContain("AI Agent 产品开发");
  });

  it("accepts an explicit copy path but never writes outside the workspace, into memory, over source, or over a file", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const source = path.join(cwd, "原稿.docx");
    fs.writeFileSync(source, await Packer.toBuffer(new Document({
      sections: [{ children: [new Paragraph("原文")] }],
    })));
    fs.writeFileSync(path.join(cwd, "已存在.docx"), "keep");
    const documents = createDocumentMcp({ workspaceRoot: root, cwd });
    const request = { file_path: "原稿.docx", replacements: [{ find: "原文", replace: "新文" }] };

    const explicit = await documents.runEditWordDocument({ ...request, output_path: "版本/第二版.docx" });
    expect(explicit).toMatchObject({ isError: false });
    expectSameExistingPath(explicit.actualPath, path.join(cwd, "版本", "第二版.docx"));
    for (const output_path of [
      "原稿.docx",
      "已存在.docx",
      "../../越界.docx",
      "../.leemo/memory/污染.docx",
      "错误.pdf",
    ]) {
      const failed = await documents.runEditWordDocument({ ...request, output_path });
      expect(failed.isError, output_path).toBe(true);
    }
    expect(fs.readFileSync(path.join(cwd, "已存在.docx"), "utf8")).toBe("keep");
  });

  it("does not create a copy when exact-match validation fails, then recovers on the next request", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    fs.writeFileSync(path.join(cwd, "重复.docx"), await Packer.toBuffer(new Document({
      sections: [{ children: [new Paragraph("目标，目标")] }],
    })));
    const documents = createDocumentMcp({ workspaceRoot: root, cwd });

    const failed = await documents.runEditWordDocument({
      file_path: "重复.docx",
      replacements: [{ find: "目标", replace: "方向" }],
    });
    expect(failed).toMatchObject({ isError: true });
    expect(failed.text).toContain("实际找到 2 处");
    expect(fs.existsSync(path.join(cwd, "重复-修改版.docx"))).toBe(false);

    const recovered = await documents.runEditWordDocument({
      file_path: "重复.docx",
      replacements: [{ find: "目标", replace: "方向", expectedMatches: 2 }],
    });
    expect(recovered.isError).toBe(false);
  });

  it("routes a root Word artifact into 默认工作区 and reads it back", async () => {
    const root = workspace();
    const documents = createDocumentMcp({
      workspaceRoot: root,
      cwd: root,
      routeRootWritePath: (relativePath) => path.join("默认工作区", relativePath),
    });
    const created = await documents.runCreateWordDocument({
      file_path: "英语周报.docx",
      title: "英语周报",
      sections: [{ heading: "进展", paragraphs: ["完成三次写作练习。"], bullets: [] }],
      overwrite: false,
    });
    const expectedPath = path.join(root, "默认工作区", "英语周报.docx");
    expect(created).toMatchObject({ isError: false });
    expectSameExistingPath(created.actualPath, expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const read = await documents.runReadDocument({ file_path: path.join("默认工作区", "英语周报.docx") });
    expect(read.isError).toBe(false);
    expect(read.text).toContain("英语周报");
    expect(read.text).toContain("三次写作练习");
  });

  it("creates PPTX and XLSX files with truthful lightweight receipts", async () => {
    const root = workspace();
    const documents = createDocumentMcp({ workspaceRoot: root, cwd: path.join(root, "默认工作区") });
    const presentation = await documents.runCreatePresentation({
      file_path: "复盘.pptx",
      title: "面试复盘",
      slides: [{ title: "证据", bullets: ["回答缺少量化"] }],
      overwrite: false,
    });
    const spreadsheet = await documents.runCreateSpreadsheet({
      file_path: "计划.xlsx",
      sheets: [{ name: "本周", rows: [["任务", "完成"], ["英语写作", true]] }],
      overwrite: false,
    });
    expect(presentation).toMatchObject({ isError: false });
    expect(presentation.text).toMatch(/已创建演示文稿.*2 页/);
    expect(spreadsheet).toMatchObject({ isError: false });
    expect(spreadsheet.text).toMatch(/已创建 Excel.*1 个工作表/);
    expect(fs.existsSync(path.join(root, "默认工作区", "复盘.pptx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "默认工作区", "计划.xlsx"))).toBe(true);
  });

  it("refuses traversal, governed memory, wrong extensions, and silent overwrite", async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    const documents = createDocumentMcp({ workspaceRoot: root, cwd });
    const draft = {
      file_path: "报告.docx",
      title: "报告",
      sections: [{ paragraphs: ["第一版"], bullets: [] }],
      overwrite: false,
    };
    expect((await documents.runCreateWordDocument({ ...draft, file_path: "..\\..\\outside.docx" })).isError).toBe(true);
    expect((await documents.runCreateWordDocument({ ...draft, file_path: "..\\.leemo\\memory\\事实.docx" })).isError).toBe(true);
    expect((await documents.runCreateWordDocument({ ...draft, file_path: "报告.pdf" })).isError).toBe(true);
    expect((await documents.runCreateWordDocument(draft)).isError).toBe(false);
    const duplicate = await documents.runCreateWordDocument(draft);
    expect(duplicate).toMatchObject({ isError: true });
    expect(duplicate.text).toContain("已经存在");
    expect((await documents.runCreateWordDocument({ ...draft, overwrite: true })).isError).toBe(false);
  });

  it("returns one actionable error and remains usable after a corrupt read", { timeout: 20_000 }, async () => {
    const root = workspace();
    const cwd = path.join(root, "默认工作区");
    fs.writeFileSync(path.join(cwd, "坏文件.pdf"), "not a pdf");
    const documents = createDocumentMcp({ workspaceRoot: root, cwd });
    const failed = await documents.runReadDocument({ file_path: "坏文件.pdf" });
    expect(failed).toMatchObject({ isError: true });
    expect(failed.text).toContain("无法解析");
    expect(failed.text).not.toContain("InvalidPDFException");

    const created = await documents.runCreateSpreadsheet({
      file_path: "恢复.xlsx",
      sheets: [{ name: "结果", rows: [["状态"], ["成功"]] }],
      overwrite: false,
    });
    expect(created.isError).toBe(false);
  });
});
