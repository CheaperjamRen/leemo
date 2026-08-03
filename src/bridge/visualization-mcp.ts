import path from "node:path";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  LEEMO_VISUALIZATION_SERVER,
  LEEMO_VISUALIZATION_TOOL,
  LEEMO_VISUALIZATION_TOOL_NAME,
  ensureVisualizationHtmlExtension,
  visualizationInputSchema,
  type VisualizationInput,
} from "./visualization-spec";
import { isPathInside, resolvePathWithinBoundary } from "./filesystem-boundary";
import { DocumentToolError, writeDocumentAtomically } from "../host/document-engine";
import { renderVisualizationHtml } from "../host/visualization-renderer";

export { LEEMO_VISUALIZATION_TOOL_NAME };

export interface VisualizationMcpOptions {
  workspaceRoot: string;
  cwd: string;
  routeRootWritePath?: (relativePath: string) => string;
}

export interface VisualizationMcpResult {
  text: string;
  isError: boolean;
  actualPath?: string;
}

export interface VisualizationMcp {
  server: McpSdkServerConfigWithInstance;
  runCreateVisualization(input: VisualizationInput): Promise<VisualizationMcpResult>;
}

const KIND_LABELS = {
  table: "表格",
  comparison: "对比",
  timeline: "时间线",
  flow: "流程",
  bar: "图表",
} as const;

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLocaleLowerCase() === path.resolve(b).toLocaleLowerCase();
}

function safeError(error: unknown): VisualizationMcpResult {
  if (error instanceof DocumentToolError) return { text: error.userMessage, isError: true };
  return {
    text: "可视化成果没有保存，现有文件没有被改动。请检查内容或换一个文件名再试。",
    isError: true,
  };
}

export function createVisualizationMcp(options: VisualizationMcpOptions): VisualizationMcp {
  const resolveWritePath = (rawPath: string): string => {
    let requested = rawPath.trim();
    if (!requested) throw new DocumentToolError("invalid_input", "请给可视化成果一个文件名。");
    const extension = path.extname(requested).toLocaleLowerCase();
    if (!extension) requested = ensureVisualizationHtmlExtension(requested);
    else if (extension !== ".html") {
      throw new DocumentToolError("invalid_input", "可视化成果必须保存为 .html 文件。");
    }
    if (!path.isAbsolute(requested) && samePath(options.cwd, options.workspaceRoot)) {
      requested = options.routeRootWritePath?.(requested) ?? requested;
    }
    const resolved = resolvePathWithinBoundary(options.workspaceRoot, options.cwd, requested);
    if (!resolved) {
      throw new DocumentToolError("io", "可视化成果只能保存到当前工作区内。");
    }

    for (const protectedPath of [".leemo", ".claude", "memory"]) {
      const protectedRoot = resolvePathWithinBoundary(
        options.workspaceRoot,
        options.workspaceRoot,
        protectedPath,
      );
      if (protectedRoot && isPathInside(protectedRoot, resolved)) {
        throw new DocumentToolError("io", "这是 Leemo 的内部目录；可视化成果请保存到工作区。");
      }
    }
    return resolved;
  };

  const runCreateVisualization = async (input: VisualizationInput): Promise<VisualizationMcpResult> => {
    try {
      const parsed = visualizationInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DocumentToolError("invalid_input", "可视化内容不完整，请检查标题和结构化数据。");
      }
      const actualPath = resolveWritePath(parsed.data.file_path);
      const html = renderVisualizationHtml(parsed.data);
      await writeDocumentAtomically(
        actualPath,
        Buffer.from(html, "utf8"),
        { overwrite: parsed.data.overwrite ?? false },
      );
      return {
        text: `已创建可视化成果：${actualPath}（${KIND_LABELS[parsed.data.visualization.kind]}）。`,
        isError: false,
        actualPath,
      };
    } catch (error) {
      return safeError(error);
    }
  };

  const createTool = tool(
    LEEMO_VISUALIZATION_TOOL,
    "Create a durable visual artifact only when a table, comparison, timeline, process, or bar chart " +
      "is materially clearer than prose. Supply structured data only; Leemo renders safe static HTML locally. " +
      "Do not use this for decorative cards or every answer.",
    visualizationInputSchema.shape,
    async (args) => {
      const output = await runCreateVisualization(args);
      return { content: [{ type: "text", text: output.text }], isError: output.isError } as never;
    },
  );

  return {
    server: createSdkMcpServer({
      name: LEEMO_VISUALIZATION_SERVER,
      version: "1.0.0",
      tools: [createTool],
    }),
    runCreateVisualization,
  };
}
