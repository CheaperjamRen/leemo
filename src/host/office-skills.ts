import type { SkillInfo, SkillRequirement } from "../bridge/contract";

export const OFFICE_SKILL_PLUGIN_NAME = "leemo-office";

export type OfficeSkillId = "docx" | "xlsx" | "pptx" | "pdf";

export type OfficeSkillRuntimeSnapshot =
  | { status: "preparing" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      pluginPath: string;
      revision?: string;
      source?: "bundled";
    };

export interface OfficeSkillRuntime {
  snapshot(): OfficeSkillRuntimeSnapshot;
  /** Idempotent and concurrency-safe. Failures are returned as state so chat
   * can keep its deterministic document tools instead of failing to start. */
  ensureReady(): Promise<OfficeSkillRuntimeSnapshot>;
}

export interface OfficeSkillDefinition extends SkillInfo {
  id: `office-${OfficeSkillId}`;
  officeId: OfficeSkillId;
  source: "builtin";
  category: "research-office";
  requirements: SkillRequirement[];
  defaultEnabled: true;
}

export const OFFICE_SKILL_DEFINITIONS: readonly OfficeSkillDefinition[] = [
  {
    id: "office-docx",
    officeId: "docx",
    name: "Word 文档",
    commandName: "docx",
    description: "创建、读取和精修 Word 文档，保留原稿并检查最终版式。",
    qualifiedName: `${OFFICE_SKILL_PLUGIN_NAME}:docx`,
    source: "builtin",
    category: "research-office",
    requirements: ["filesystem", "document-read", "document-create"],
    defaultEnabled: true,
  },
  {
    id: "office-xlsx",
    officeId: "xlsx",
    name: "Excel 表格",
    commandName: "xlsx",
    description: "读取和修改工作簿，处理公式、格式、数据分析与图表。",
    qualifiedName: `${OFFICE_SKILL_PLUGIN_NAME}:xlsx`,
    source: "builtin",
    category: "research-office",
    requirements: ["filesystem", "document-read", "document-create"],
    defaultEnabled: true,
  },
  {
    id: "office-pptx",
    officeId: "pptx",
    name: "演示文稿",
    commandName: "pptx",
    description: "创建和编辑演示文稿，并通过渲染检查排版与视觉质量。",
    qualifiedName: `${OFFICE_SKILL_PLUGIN_NAME}:pptx`,
    source: "builtin",
    category: "research-office",
    requirements: ["filesystem", "document-read", "document-create"],
    defaultEnabled: true,
  },
  {
    id: "office-pdf",
    officeId: "pdf",
    name: "PDF 文档",
    commandName: "pdf",
    description: "读取、生成、拆分、合并和处理 PDF 内容与表单。",
    qualifiedName: `${OFFICE_SKILL_PLUGIN_NAME}:pdf`,
    source: "builtin",
    category: "research-office",
    requirements: ["filesystem", "document-read", "document-create"],
    defaultEnabled: true,
  },
];

export function officeSkillForQualifiedName(name: string): OfficeSkillDefinition | undefined {
  return OFFICE_SKILL_DEFINITIONS.find((skill) => skill.qualifiedName === name);
}

export function officeSkillMetadata(snapshot: OfficeSkillRuntimeSnapshot): SkillInfo[] {
  const available = snapshot.status === "ready";
  const unavailableReason = snapshot.status === "preparing"
    ? "正在准备 Office 能力，稍后即可使用。"
    : snapshot.status === "error"
      ? snapshot.error
      : undefined;

  return OFFICE_SKILL_DEFINITIONS.map(({ officeId: _officeId, ...skill }) => ({
    ...skill,
    trust: "leemo" as const,
    sourceKind: "leemo" as const,
    sourceLabel: "Leemo 内置",
    scanStatus: "scanned" as const,
    canRemove: false,
    canUpdate: false,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  }));
}
