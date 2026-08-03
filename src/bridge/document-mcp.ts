import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  DEFAULT_DOCUMENT_TEXT_LIMIT,
  MAX_DOCUMENT_TEXT_LIMIT,
  DocumentToolError,
  createDocxBuffer,
  createPptxBuffer,
  createXlsxBuffer,
  editDocxTextBuffer,
  readDocumentFile,
  writeDocumentAtomically,
  type DocxDraft,
  type DocxTextReplacement,
  type PptxDraft,
  type XlsxDraft,
} from "../host/document-engine";
import { isPathInside, resolvePathWithinBoundary } from "./filesystem-boundary";
import { defaultWordEditOutputPath } from "./document-paths";

const DOCUMENT_SERVER = "leemo-documents";
const TOOL_NAMES = {
  read: "read_document",
  editWord: "edit_word_document",
  createWord: "create_word_document",
  createPresentation: "create_presentation",
  createSpreadsheet: "create_spreadsheet",
} as const;

export const LEEMO_DOCUMENT_TOOL_NAMES = {
  read: `mcp__${DOCUMENT_SERVER}__${TOOL_NAMES.read}`,
  editWord: `mcp__${DOCUMENT_SERVER}__${TOOL_NAMES.editWord}`,
  createWord: `mcp__${DOCUMENT_SERVER}__${TOOL_NAMES.createWord}`,
  createPresentation: `mcp__${DOCUMENT_SERVER}__${TOOL_NAMES.createPresentation}`,
  createSpreadsheet: `mcp__${DOCUMENT_SERVER}__${TOOL_NAMES.createSpreadsheet}`,
} as const;

interface ReadInput {
  file_path: string;
  max_chars?: number;
}

interface CreateWordInput extends DocxDraft {
  file_path: string;
  overwrite?: boolean;
}

interface EditWordInput {
  file_path: string;
  output_path?: string;
  replacements: DocxTextReplacement[];
}

interface CreatePresentationInput extends PptxDraft {
  file_path: string;
  overwrite?: boolean;
}

interface CreateSpreadsheetInput extends XlsxDraft {
  file_path: string;
  overwrite?: boolean;
}

export interface DocumentMcpResult {
  text: string;
  isError: boolean;
  actualPath?: string;
}

export interface DocumentMcpOptions {
  workspaceRoot: string;
  cwd: string;
  routeRootWritePath?: (relativePath: string) => string;
}

export interface DocumentMcp {
  server: McpSdkServerConfigWithInstance;
  runReadDocument(input: ReadInput): Promise<DocumentMcpResult>;
  runEditWordDocument(input: EditWordInput): Promise<DocumentMcpResult>;
  runCreateWordDocument(input: CreateWordInput): Promise<DocumentMcpResult>;
  runCreatePresentation(input: CreatePresentationInput): Promise<DocumentMcpResult>;
  runCreateSpreadsheet(input: CreateSpreadsheetInput): Promise<DocumentMcpResult>;
}

const paragraphList = z.array(z.string().min(1).max(5_000)).max(500).optional();
const docxSections = z.array(z.object({
  heading: z.string().min(1).max(200).optional(),
  paragraphs: paragraphList,
  bullets: paragraphList,
})).min(1).max(60);
const docxTextReplacements = z.array(z.object({
  find: z.string().min(1).max(5_000),
  replace: z.string().max(5_000),
  expectedMatches: z.number().int().min(1).max(100).optional(),
})).min(1).max(20);
const pptxSlides = z.array(z.object({
  title: z.string().min(1).max(200),
  bullets: z.array(z.string().min(1).max(180)).max(10),
})).min(1).max(40);
const spreadsheetCell = z.union([z.string().max(5_000), z.number().finite(), z.boolean(), z.null()]);
const spreadsheetSheets = z.array(z.object({
  name: z.string().min(1).max(31),
  rows: z.array(z.array(spreadsheetCell).max(50)).max(1_000),
})).min(1).max(12);

function safeError(error: unknown): DocumentMcpResult {
  if (error instanceof DocumentToolError) return { text: error.userMessage, isError: true };
  return { text: "文档处理失败了，文件没有被改动。请检查路径或换一份文件再试。", isError: true };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLocaleLowerCase() === path.resolve(b).toLocaleLowerCase();
}

function governedMemoryPath(workspaceRoot: string, target: string): boolean {
  const memoryRoot = resolvePathWithinBoundary(workspaceRoot, workspaceRoot, ".leemo/memory");
  return memoryRoot !== undefined && isPathInside(memoryRoot, target);
}

export function createDocumentMcp(options: DocumentMcpOptions): DocumentMcp {
  const resolveReadPath = (rawPath: string): string => {
    const requested = rawPath.trim();
    if (!requested) throw new DocumentToolError("invalid_input", "请选择要读取的文档。");
    const resolved = resolvePathWithinBoundary(options.workspaceRoot, options.cwd, requested);
    if (!resolved) {
      throw new DocumentToolError("io", "这个文档不在当前工作区内；请先打开它所在的文件夹。");
    }
    return resolved;
  };

  const requireDocxPath = (actualPath: string, label: string): void => {
    if (path.extname(actualPath).toLocaleLowerCase() !== ".docx") {
      throw new DocumentToolError("invalid_input", `${label}必须是 .docx 文件。`);
    }
  };

  const resolveWritePath = (rawPath: string, extension: ".docx" | ".pptx" | ".xlsx"): string => {
    let requested = rawPath.trim();
    if (!requested) throw new DocumentToolError("invalid_input", "请给新文档一个文件名。");
    const currentExtension = path.extname(requested).toLocaleLowerCase();
    if (!currentExtension) requested += extension;
    else if (currentExtension !== extension) {
      throw new DocumentToolError("invalid_input", `这个工具只能创建 ${extension} 文件。`);
    }
    if (!path.isAbsolute(requested) && samePath(options.cwd, options.workspaceRoot)) {
      requested = options.routeRootWritePath?.(requested) ?? requested;
    }
    const resolved = resolvePathWithinBoundary(options.workspaceRoot, options.cwd, requested);
    if (!resolved) {
      throw new DocumentToolError("io", "新文档只能保存到当前工作区内。");
    }
    if (governedMemoryPath(options.workspaceRoot, resolved)) {
      throw new DocumentToolError("io", "长期记忆由 Leemo 管理；普通文档请写入工作区。");
    }
    return resolved;
  };

  const runReadDocument = async (input: ReadInput): Promise<DocumentMcpResult> => {
    try {
      const actualPath = resolveReadPath(input.file_path);
      const read = await readDocumentFile(actualPath, {
        maxChars: input.max_chars ?? DEFAULT_DOCUMENT_TEXT_LIMIT,
      });
      const count = read.pages !== undefined
        ? `${read.pages} 页`
        : read.slides !== undefined
          ? `${read.slides} 页幻灯片`
          : read.sheets !== undefined
            ? `${read.sheets} 个工作表`
            : "文本已提取";
      const truncation = read.truncated ? "；内容较长，已按上限截取" : "";
      return {
        text: `已读取 ${path.basename(actualPath)}（${count}，${formatBytes(read.bytes)}${truncation}）。\n\n${read.text}`,
        isError: false,
        actualPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const runEditWordDocument = async (input: EditWordInput): Promise<DocumentMcpResult> => {
    try {
      const sourcePath = resolveReadPath(input.file_path);
      requireDocxPath(sourcePath, "要修改的 Word 文档");

      const requestedOutput = input.output_path?.trim();
      const outputPath = requestedOutput
        ? resolvePathWithinBoundary(options.workspaceRoot, options.cwd, requestedOutput)
        : path.join(path.dirname(sourcePath), path.basename(defaultWordEditOutputPath(sourcePath)));
      if (!outputPath) throw new DocumentToolError("io", "修改后的 Word 副本只能保存到当前工作区内。");
      requireDocxPath(outputPath, "修改后的 Word 副本");
      if (samePath(sourcePath, outputPath)) {
        throw new DocumentToolError("invalid_input", "Word 修改会另存副本，输出路径不能和原文件相同。");
      }
      if (governedMemoryPath(options.workspaceRoot, outputPath)) {
        throw new DocumentToolError("io", "长期记忆由 Leemo 管理；Word 副本请写入工作区。");
      }

      let source: Buffer;
      try {
        source = await fs.readFile(sourcePath);
      } catch (error) {
        throw new DocumentToolError("io", `无法读取“${path.basename(sourcePath)}”，请确认文件仍存在且没有被占用。`, error);
      }
      const edited = editDocxTextBuffer(source, input.replacements);
      await writeDocumentAtomically(outputPath, edited.buffer);
      return {
        text: `已修改 Word 文档副本：${outputPath}（${edited.replacements} 处）。`,
        isError: false,
        actualPath: outputPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const runCreateWordDocument = async (input: CreateWordInput): Promise<DocumentMcpResult> => {
    try {
      const actualPath = resolveWritePath(input.file_path, ".docx");
      const buffer = await createDocxBuffer(input);
      await writeDocumentAtomically(actualPath, buffer, { overwrite: input.overwrite ?? false });
      return {
        text: `已创建 Word 文档：${actualPath}（${input.sections.length} 个章节，${formatBytes(buffer.byteLength)}）。`,
        isError: false,
        actualPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const runCreatePresentation = async (input: CreatePresentationInput): Promise<DocumentMcpResult> => {
    try {
      const actualPath = resolveWritePath(input.file_path, ".pptx");
      const buffer = await createPptxBuffer(input);
      await writeDocumentAtomically(actualPath, buffer, { overwrite: input.overwrite ?? false });
      return {
        text: `已创建演示文稿：${actualPath}（${input.slides.length + 1} 页，${formatBytes(buffer.byteLength)}）。`,
        isError: false,
        actualPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const runCreateSpreadsheet = async (input: CreateSpreadsheetInput): Promise<DocumentMcpResult> => {
    try {
      const actualPath = resolveWritePath(input.file_path, ".xlsx");
      const buffer = createXlsxBuffer(input);
      await writeDocumentAtomically(actualPath, buffer, { overwrite: input.overwrite ?? false });
      return {
        text: `已创建 Excel 表格：${actualPath}（${input.sheets.length} 个工作表，${formatBytes(buffer.byteLength)}）。`,
        isError: false,
        actualPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const readTool = tool(
    TOOL_NAMES.read,
    "Read and extract text from a local PDF, DOCX, PPTX, or XLSX inside the current workspace. " +
      "Use this instead of treating Office files as plain text. It never edits the source file.",
    {
      file_path: z.string().min(1).describe("Path inside the current workspace"),
      max_chars: z.number().int().min(1_000).max(MAX_DOCUMENT_TEXT_LIMIT).optional(),
    },
    async (args) => {
      const output = await runReadDocument(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );
  const createWordTool = tool(
    TOOL_NAMES.createWord,
    "Create a new Word document from structured sections. This creates DOCX only; it does not edit an existing template.",
    {
      file_path: z.string().min(1),
      title: z.string().min(1).max(200),
      subtitle: z.string().min(1).max(200).optional(),
      sections: docxSections,
      overwrite: z.boolean().optional(),
    },
    async (args) => {
      const output = await runCreateWordDocument(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );
  const editWordTool = tool(
    TOOL_NAMES.editWord,
    "Make exact literal text changes in an existing DOCX and save a new copy. " +
      "Use only when the original text is known exactly. The source is never overwritten; ambiguous matches fail without writing.",
    {
      file_path: z.string().min(1).describe("Existing DOCX path inside the current workspace"),
      output_path: z.string().min(1).optional().describe("Optional new DOCX copy path inside the workspace"),
      replacements: docxTextReplacements,
    },
    async (args) => {
      const output = await runEditWordDocument(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );
  const createPresentationTool = tool(
    TOOL_NAMES.createPresentation,
    "Create a new 16:9 PowerPoint presentation from a title and concise slides. This creates PPTX only.",
    {
      file_path: z.string().min(1),
      title: z.string().min(1).max(200),
      subtitle: z.string().min(1).max(200).optional(),
      slides: pptxSlides,
      overwrite: z.boolean().optional(),
    },
    async (args) => {
      const output = await runCreatePresentation(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );
  const createSpreadsheetTool = tool(
    TOOL_NAMES.createSpreadsheet,
    "Create a new Excel workbook from structured rows. This creates XLSX only and preserves strings, finite numbers, booleans, and blank cells.",
    {
      file_path: z.string().min(1),
      sheets: spreadsheetSheets,
      overwrite: z.boolean().optional(),
    },
    async (args) => {
      const output = await runCreateSpreadsheet(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );

  return {
    server: createSdkMcpServer({
      name: DOCUMENT_SERVER,
      version: "1.0.0",
      tools: [readTool, editWordTool, createWordTool, createPresentationTool, createSpreadsheetTool],
    }),
    runReadDocument,
    runEditWordDocument,
    runCreateWordDocument,
    runCreatePresentation,
    runCreateSpreadsheet,
  };
}
