import { describe, expect, it, vi } from "vitest";
import {
  createSkillAdminMcp,
  LEEMO_SKILL_ADMIN_TOOL_NAMES,
  type SkillAdminMcpResult,
} from "../../src/bridge/skill-admin-mcp";

const inspection = {
  sourceKind: "github" as const,
  sourceLabel: "社区作者",
  resolvedSource: "https://github.com/example/skills/tree/abc123/demo",
  repository: "example/skills",
  revision: "abc123",
  license: "MIT",
  candidates: [{
    name: "demo",
    description: "把资料整理成清晰摘要。",
  }],
};

const scannedInspection = {
  ...inspection,
  candidates: [{
    ...inspection.candidates[0],
    scan: { status: "scanned" as const, findings: [], analyzedFiles: 1, analysis: "static" as const },
  }],
};

function textOf(result: SkillAdminMcpResult): string {
  return result.text;
}

describe("createSkillAdminMcp", () => {
  it("exposes read-only inspection separately from mutating skill actions", () => {
    const mcp = createSkillAdminMcp({
      inspect: async () => inspection,
      listCatalog: async () => [],
      installCatalog: vi.fn(),
      scanInstalled: vi.fn(),
      install: vi.fn(async () => ({
        installed: [{
          id: "managed:demo",
          name: "demo",
          description: "把资料整理成清晰摘要。",
          trust: "community" as const,
          sourceKind: "github" as const,
          sourceLabel: "社区作者",
          scanStatus: "scanned" as const,
          canUpdate: true,
        }],
        receipt: "已安装 demo · 来源 社区作者 · 已扫描",
      })),
      remove: vi.fn(async () => undefined),
    });

    expect(mcp.server).toMatchObject({ type: "sdk", name: "leemo-skill-admin" });
    expect(LEEMO_SKILL_ADMIN_TOOL_NAMES).toEqual({
      inspect: "mcp__leemo-skill-admin__inspect_skill_source",
      scan: "mcp__leemo-skill-admin__scan_skill_source",
      listCatalog: "mcp__leemo-skill-admin__list_community_skills",
      installCatalog: "mcp__leemo-skill-admin__install_community_skill",
      scanInstalled: "mcp__leemo-skill-admin__scan_installed_skill",
      install: "mcp__leemo-skill-admin__install_skill",
      remove: "mcp__leemo-skill-admin__remove_skill",
    });
  });

  it("reads a source without scanning or leaking the local source path", async () => {
    const inspect = vi.fn(async () => inspection);
    const mcp = createSkillAdminMcp({ inspect, listCatalog: vi.fn(async () => []), installCatalog: vi.fn(), scanInstalled: vi.fn(), install: vi.fn(), remove: vi.fn() });

    const result = await mcp.runInspect({ source: "C:\\Downloads\\demo.zip" });

    expect(result).toMatchObject({ isError: false });
    expect(textOf(result)).toContain("demo");
    expect(textOf(result)).toContain("尚未扫描");
    expect(textOf(result)).not.toContain("C:\\Downloads");
    expect(inspect).toHaveBeenCalledWith("C:\\Downloads\\demo.zip", { securityScan: false });
  });

  it("offers an explicit read-only scan tool", async () => {
    const inspect = vi.fn(async () => scannedInspection);
    const mcp = createSkillAdminMcp({ inspect, listCatalog: vi.fn(async () => []), installCatalog: vi.fn(), scanInstalled: vi.fn(), install: vi.fn(), remove: vi.fn() });

    const result = await mcp.runScan({ source: "https://github.com/example/skills/tree/main/demo" });

    expect(result).toMatchObject({ isError: false });
    expect(textOf(result)).toContain("未发现明显风险");
    expect(inspect).toHaveBeenCalledWith("https://github.com/example/skills/tree/main/demo", { securityScan: true });
  });

  it("installs without a mandatory scan and asks one lightweight follow-up", async () => {
    const install = vi.fn(async () => ({
      installed: [{
        id: "managed:demo",
        name: "demo",
        description: "把资料整理成清晰摘要。",
        trust: "community" as const,
        sourceKind: "github" as const,
        sourceLabel: "社区作者",
        scanStatus: "unscanned" as const,
        canUpdate: true,
      }],
      receipt: "已安装 demo · 来源 社区作者 · 未扫描",
    }));
    const mcp = createSkillAdminMcp({ inspect: vi.fn(), listCatalog: vi.fn(async () => []), installCatalog: vi.fn(), scanInstalled: vi.fn(), install, remove: vi.fn() });

    const result = await mcp.runInstall({
      source: "https://github.com/example/skills/tree/abc123/demo",
      candidate: "demo",
    });

    expect(result).toMatchObject({ isError: false });
    expect(textOf(result)).toContain("已安装 demo · 来源 社区作者 · 未扫描");
    expect(textOf(result)).toContain("要我检查提示词注入、敏感信息读取和远程脚本风险吗");
    expect(install).toHaveBeenCalledWith({
      source: "https://github.com/example/skills/tree/abc123/demo",
      candidate: "demo",
    });
  });

  it("lists and installs curated Skills by product name without asking for a URL", async () => {
    const listCatalog = vi.fn(async () => [{
      id: "grill-me",
      name: "grill-me",
      description: "逐问压力测试一个计划。",
      category: "thinking",
      categoryLabel: "思考与决策",
      featured: true,
      author: "Matt Pocock",
      repository: "mattpocock/skills",
      revision: "abc123",
      license: "MIT",
      sourceUrl: "https://github.com/mattpocock/skills/tree/abc123/skills/productivity/grilling",
      installed: false,
      scanStatus: "scanned" as const,
    }]);
    const installCatalog = vi.fn(async () => ({
      installed: [{
        id: "managed:grill",
        name: "grill-me",
        description: "逐问压力测试一个计划。",
        trust: "community" as const,
        sourceKind: "github" as const,
        sourceLabel: "Matt Pocock",
        scanStatus: "scanned" as const,
        canUpdate: true,
      }],
      receipt: "已安装 grill-me · 来源 Matt Pocock · 已通过预审",
    }));
    const mcp = createSkillAdminMcp({ inspect: vi.fn(), listCatalog, installCatalog, scanInstalled: vi.fn(), install: vi.fn(), remove: vi.fn() });

    expect((await mcp.runListCatalog()).text).toContain("grill-me");
    expect((await mcp.runInstallCatalog({ id: "grill-me" })).text).toContain("已安装 grill-me");
    expect(installCatalog).toHaveBeenCalledWith("grill-me");
  });

  it("scans an installed Skill by name only when asked", async () => {
    const scanInstalled = vi.fn(async () => ({
      id: "managed:demo",
      name: "demo",
      description: "Demo",
      trust: "personal" as const,
      sourceKind: "github" as const,
      sourceLabel: "author",
      scanStatus: "review" as const,
      canUpdate: true,
      findings: [{ rule: "credential-access", severity: "high" as const, title: "疑似读取凭据", detail: "风险", file: "SKILL.md" }],
    }));
    const mcp = createSkillAdminMcp({ inspect: vi.fn(), listCatalog: vi.fn(async () => []), installCatalog: vi.fn(), scanInstalled, install: vi.fn(), remove: vi.fn() });

    const result = await mcp.runScanInstalled({ id: "demo" });
    expect(result.text).toContain("发现需留意内容");
    expect(result.text).toContain("不会自动卸载");
  });

  it("turns service failures into concise model-facing errors without stack details", async () => {
    const mcp = createSkillAdminMcp({
      inspect: async () => { throw new Error("这个 Skill 需要明确确认风险后才能安装。 C:\\secret\\registry.json"); },
      listCatalog: vi.fn(async () => []),
      installCatalog: vi.fn(),
      scanInstalled: vi.fn(),
      install: vi.fn(),
      remove: vi.fn(),
    });

    const result = await mcp.runInspect({ source: "https://example.invalid/skill" });

    expect(result).toMatchObject({ isError: true });
    expect(textOf(result)).toContain("需要明确确认风险");
    expect(textOf(result)).not.toContain("Error:");
    expect(textOf(result)).not.toContain("registry.json");
  });
});
