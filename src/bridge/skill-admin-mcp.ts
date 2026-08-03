import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  CommunitySkillView,
  SkillInstallOutcome,
  SkillMutationItem,
  SkillSecurityFindingView,
  SkillSourceInspectionView,
} from "./contract";

const SKILL_ADMIN_SERVER = "leemo-skill-admin";
const TOOL_NAMES = {
  inspect: "inspect_skill_source",
  scan: "scan_skill_source",
  listCatalog: "list_community_skills",
  installCatalog: "install_community_skill",
  scanInstalled: "scan_installed_skill",
  install: "install_skill",
  remove: "remove_skill",
} as const;

export const LEEMO_SKILL_ADMIN_TOOL_NAMES = {
  inspect: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.inspect}`,
  scan: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.scan}`,
  listCatalog: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.listCatalog}`,
  installCatalog: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.installCatalog}`,
  scanInstalled: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.scanInstalled}`,
  install: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.install}`,
  remove: `mcp__${SKILL_ADMIN_SERVER}__${TOOL_NAMES.remove}`,
} as const;

export interface SkillAdminMcpResult {
  text: string;
  isError: boolean;
}

export interface SkillInspectInput {
  source: string;
}

export interface SkillScanInput {
  source: string;
}

export interface SkillInstallInput {
  source: string;
  candidate?: string;
  securityScan?: boolean;
}

export interface SkillRemoveInput {
  id: string;
}

export interface SkillCatalogInput {
  id: string;
}

export interface SkillInstalledScanInput {
  id: string;
}

export interface SkillAdminMcpOptions {
  inspect(source: string, options?: { securityScan?: boolean }): Promise<SkillSourceInspectionView>;
  listCatalog(): Promise<CommunitySkillView[]> | CommunitySkillView[];
  installCatalog(id: string): Promise<SkillInstallOutcome>;
  scanInstalled(id: string): Promise<SkillMutationItem & {
    findings?: SkillSecurityFindingView[];
    securityFindings?: SkillSecurityFindingView[];
  }> | (SkillMutationItem & {
    findings?: SkillSecurityFindingView[];
    securityFindings?: SkillSecurityFindingView[];
  });
  install(input: SkillInstallInput): Promise<SkillInstallOutcome>;
  remove(id: string): Promise<{ name?: string } | void>;
}

export interface SkillAdminMcp {
  server: McpSdkServerConfigWithInstance;
  runInspect(input: SkillInspectInput): Promise<SkillAdminMcpResult>;
  runScan(input: SkillScanInput): Promise<SkillAdminMcpResult>;
  runListCatalog(): Promise<SkillAdminMcpResult>;
  runInstallCatalog(input: SkillCatalogInput): Promise<SkillAdminMcpResult>;
  runScanInstalled(input: SkillInstalledScanInput): Promise<SkillAdminMcpResult>;
  runInstall(input: SkillInstallInput): Promise<SkillAdminMcpResult>;
  runRemove(input: SkillRemoveInput): Promise<SkillAdminMcpResult>;
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutStack = raw.split("\n", 1)[0].replace(/^Error:\s*/u, "");
  const withoutSecrets = withoutStack
    .replace(/(?:sk|key|token|secret)[-_][a-z0-9._-]{8,}/giu, "敏感值")
    .replace(/[A-Za-z]:\\[^\s；;，,。]+/gu, "本地路径")
    .replace(/(?:\\\\|\/)(?:[^\s；;，,。]+[\\/])+[^\s；;，,。]*/gu, "本地路径");
  return withoutSecrets.length > 240 ? `${withoutSecrets.slice(0, 237)}…` : withoutSecrets;
}

function failure(error: unknown): SkillAdminMcpResult {
  return { text: `Skill 操作没有完成：${sanitizeError(error)}`, isError: true };
}

function scanLabel(status: NonNullable<SkillSourceInspectionView["candidates"][number]["scan"]>["status"]): string {
  switch (status) {
    case "scanned": return "未发现明显风险";
    case "review": return "发现需留意内容";
    case "blocked": return "发现高风险内容";
    default: return "尚未扫描";
  }
}

function inspectionText(inspection: SkillSourceInspectionView): string {
  const header = `已读取 Skill 来源：${inspection.sourceLabel}`;
  const metadata = [
    inspection.repository ? `仓库 ${inspection.repository}` : undefined,
    inspection.revision ? `版本 ${inspection.revision.slice(0, 12)}` : undefined,
    inspection.license ? `许可 ${inspection.license}` : undefined,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const candidates = inspection.candidates.map((candidate) => {
    const findings = candidate.scan && candidate.scan.findings.length > 0
      ? `；${candidate.scan.findings.map((finding) => `${finding.title}（${finding.severity}）`).join("、")}`
      : "";
    return `- ${candidate.name}：${candidate.description} · ${candidate.scan ? scanLabel(candidate.scan.status) : "尚未扫描"}${findings}`;
  });
  if (candidates.length === 0) return `${header}${metadata ? ` · ${metadata}` : ""}\n没有找到符合规范的 SKILL.md。`;
  return [
    `${header}${metadata ? ` · ${metadata}` : ""}`,
    ...candidates,
    "用户明确要安装时直接使用 install_skill；安全扫描是可选的，发现风险只需如实说明，不替用户拒绝。",
  ].join("\n");
}

export function createSkillAdminMcp(options: SkillAdminMcpOptions): SkillAdminMcp {
  const runInspect = async (input: SkillInspectInput): Promise<SkillAdminMcpResult> => {
    try {
      return { text: inspectionText(await options.inspect(input.source.trim(), { securityScan: false })), isError: false };
    } catch (error) {
      return failure(error);
    }
  };

  const runScan = async (input: SkillScanInput): Promise<SkillAdminMcpResult> => {
    try {
      return { text: inspectionText(await options.inspect(input.source.trim(), { securityScan: true })), isError: false };
    } catch (error) {
      return failure(error);
    }
  };

  const runListCatalog = async (): Promise<SkillAdminMcpResult> => {
    try {
      const entries = await options.listCatalog();
      if (entries.length === 0) return { text: "当前没有可安装的社区可信 Skill。", isError: false };
      return {
        text: [
          "社区可信 Skill（固定版本、许可证已核验并完成预审）：",
          ...entries.map((entry) => `- ${entry.name}：${entry.description} · ${entry.categoryLabel} · ${entry.author}${entry.installed ? " · 已安装" : ""}`),
          "用 install_community_skill 按名称安装；不要让用户寻找或粘贴链接。",
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return failure(error);
    }
  };

  const runInstallCatalog = async (input: SkillCatalogInput): Promise<SkillAdminMcpResult> => {
    try {
      return { text: (await options.installCatalog(input.id.trim())).receipt, isError: false };
    } catch (error) {
      return failure(error);
    }
  };

  const runScanInstalled = async (input: SkillInstalledScanInput): Promise<SkillAdminMcpResult> => {
    try {
      const skill = await options.scanInstalled(input.id.trim());
      const findings = skill.findings ?? skill.securityFindings ?? [];
      const status = skill.scanStatus === "review"
        ? "发现需留意内容"
        : skill.scanStatus === "blocked"
          ? "发现高风险内容"
          : "未发现明显风险";
      return {
        text: [
          `已扫描 ${skill.name}：${status}。扫描不会自动卸载或停用 Skill。`,
          ...findings.map((finding) => `- ${finding.title}（${finding.severity}）：${finding.detail}`),
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return failure(error);
    }
  };

  const runInstall = async (input: SkillInstallInput): Promise<SkillAdminMcpResult> => {
    try {
      const result = await options.install({
        source: input.source.trim(),
        ...(input.candidate?.trim() ? { candidate: input.candidate.trim() } : {}),
        ...(input.securityScan === true ? { securityScan: true } : {}),
      });
      const needsScan = result.installed.some((skill) => skill.scanStatus === "unscanned");
      return {
        text: needsScan
          ? `${result.receipt}。来源尚未扫描，要我检查提示词注入、敏感信息读取和远程脚本风险吗？`
          : result.receipt,
        isError: false,
      };
    } catch (error) {
      return failure(error);
    }
  };

  const runRemove = async (input: SkillRemoveInput): Promise<SkillAdminMcpResult> => {
    try {
      const removed = await options.remove(input.id.trim());
      return { text: `已卸载 Skill${removed && "name" in removed && removed.name ? `：${removed.name}` : ""}。`, isError: false };
    } catch (error) {
      return failure(error);
    }
  };

  const sourceSchema = z.string().trim().min(1).max(2_048).describe("GitHub、skill.sh 链接，或用户明确选择的本地 Skill 文件夹/ZIP 路径");
  const inspectTool = tool(
    TOOL_NAMES.inspect,
    "读取一个 Skill 来源的名称、说明和固定版本。只读，不安装、不删除，也不会做安全扫描；来源包含多个 Skill 时用它先选名称。skill.sh 只是发现入口，实际来源会固定到上游提交版本。",
    { source: sourceSchema },
    async (args) => {
      const result = await runInspect(args as SkillInspectInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const scanTool = tool(
    TOOL_NAMES.scan,
    "按用户要求扫描一个 Skill 来源的提示词注入、敏感信息读取和远程脚本风险。只读，不安装、不删除；报告风险但不替用户决定是否安装。",
    { source: sourceSchema },
    async (args) => {
      const result = await runScan(args as SkillScanInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const listCatalogTool = tool(
    TOOL_NAMES.listCatalog,
    "列出 Leemo 已核验来源、许可证、固定版本并完成预审的社区 Skill。只读；用户说想找、查看或安装精选 Skill 时先用它。分类只是可扩展标签，不限制可安装范围。",
    {},
    async () => {
      const result = await runListCatalog();
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const catalogIdSchema = z.string().trim().min(1).max(64).describe("社区目录中的 Skill 名称或 id，例如 grill-me");
  const installCatalogTool = tool(
    TOOL_NAMES.installCatalog,
    "安装 Leemo 社区可信目录中的一个 Skill。使用目录名称，不需要链接；固定版本会再次校验并扫描。",
    { id: catalogIdSchema },
    async (args) => {
      const result = await runInstallCatalog(args as SkillCatalogInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const scanInstalledTool = tool(
    TOOL_NAMES.scanInstalled,
    "按用户要求扫描一个已经安装的 Skill。报告提示词注入、敏感信息读取和远程脚本风险，但不会自动拒绝、停用或卸载。",
    { id: z.string().trim().min(1).max(128).describe("已安装 Skill 的名称或 id") },
    async (args) => {
      const result = await runScanInstalled(args as SkillInstalledScanInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const installTool = tool(
    TOOL_NAMES.install,
    "安装用户明确指定的 Skill。不要用 shell、npm 或下载脚本绕过此工具；它会解析来源、固定远程提交、原子写入并记录出处。默认不做内容安全扫描；用户明确要求时才传 scan_before_install=true。扫描发现风险也不会替用户拒绝安装。",
    {
      source: sourceSchema,
      candidate: z.string().trim().min(1).max(64).optional().describe("来源包含多个 Skill 时的名称"),
      scan_before_install: z.boolean().optional().describe("用户明确要求安装前扫描时填写 true；默认 false"),
    },
    async (args) => {
      const result = await runInstall({
        source: args.source,
        ...(args.candidate === undefined ? {} : { candidate: args.candidate }),
        ...(args.scan_before_install === undefined ? {} : { securityScan: args.scan_before_install }),
      });
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const removeTool = tool(
    TOOL_NAMES.remove,
    "卸载一个已经由 Leemo 管理的 Skill。只能删除注册表中的托管安装，不能删除用户自己放入技能目录的文件。",
    { id: z.string().trim().min(1).max(128).describe("Skill 名称或管理标识") },
    async (args) => {
      const result = await runRemove(args as SkillRemoveInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );

  return {
    server: createSdkMcpServer({
      name: SKILL_ADMIN_SERVER,
      version: "1.0.0",
      tools: [inspectTool, scanTool, listCatalogTool, installCatalogTool, scanInstalledTool, installTool, removeTool],
    }),
    runInspect,
    runScan,
    runListCatalog,
    runInstallCatalog,
    runScanInstalled,
    runInstall,
    runRemove,
  };
}
