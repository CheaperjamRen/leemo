import { describe, expect, it, vi } from "vitest";
import { createBridgeHost, type HostDeps } from "../../src/host/bridge-host";
import type { SkillAdminService } from "../../src/host/skill-admin-service";
import type { SkillsIO } from "../../src/host/skills";
import type { CatalogEntry } from "../../src/host/provider-catalog";

const MEMORY = "C:\\Users\\Rengar\\Leemo";
const SKILLS = `${MEMORY}\\.leemo\\skills`;

const demoManagedRecord = {
  id: "managed:demo",
  name: "demo-skill",
  description: "Demo description",
  dir: `${SKILLS}\\managed-demo`,
  trust: "personal" as const,
  sourceKind: "local-folder" as const,
  sourceLabel: "本地导入",
  source: "C:\\Downloads\\demo",
  resolvedSource: "C:\\Downloads\\demo",
  candidate: "demo-skill",
  scanStatus: "scanned" as const,
  findings: [],
  installedAt: 1,
  updatedAt: 1,
};

function skillIo(): SkillsIO {
  const file = `${SKILLS}\\managed-demo\\SKILL.md`;
  return {
    readdir: (dir) => dir === SKILLS ? ["managed-demo"] : [],
    readFile: (path) => path === file
      ? "---\nname: demo-skill\ndescription: Demo description\n---\nUse it."
      : "",
    exists: (path) => path === file || path === `${SKILLS}\\managed-demo` || path === SKILLS,
    writeFile: () => {},
    mkdirp: () => {},
  };
}

function admin(): SkillAdminService {
  return {
    inspect: vi.fn(async (source: string) => ({
      source,
      resolvedSource: source,
      sourceKind: "local-folder" as const,
      sourceLabel: "本地导入",
      candidates: [{
        name: "demo-skill",
        description: "Demo description",
        scan: { status: "scanned" as const, findings: [], analyzedFiles: 1, analysis: "static" as const },
      }],
    })),
    listCatalog: vi.fn(() => []),
    installCatalog: vi.fn(async () => ({ installed: [] })),
    scanManaged: vi.fn(() => ({
      ...demoManagedRecord,
      scanStatus: "scanned" as const,
      findings: [],
    })),
    install: vi.fn(async () => ({ installed: [{
      id: "managed:demo",
      name: "demo-skill",
      description: "Demo description",
      dir: `${SKILLS}\\managed-demo`,
      trust: "personal" as const,
      sourceKind: "local-folder" as const,
      sourceLabel: "本地导入",
      source: "C:\\Downloads\\demo",
      resolvedSource: "C:\\Downloads\\demo",
      candidate: "demo-skill",
      scanStatus: "scanned" as const,
      findings: [],
      installedAt: 1,
      updatedAt: 1,
    }] })),
    listManaged: vi.fn(() => []),
    remove: vi.fn(),
    metadataForDir: vi.fn((dir: string) => dir.endsWith("managed-demo") ? ({
      id: "managed:demo",
      name: "demo-skill",
      description: "Demo description",
      dir,
      trust: "personal" as const,
      sourceKind: "local-folder" as const,
      sourceLabel: "本地导入",
      source: "C:\\Downloads\\demo",
      resolvedSource: "C:\\Downloads\\demo",
      candidate: "demo-skill",
      scanStatus: "scanned" as const,
      findings: [],
      installedAt: 1,
      updatedAt: 1,
    }) : undefined),
  };
}

function hostWith(skillAdmin?: SkillAdminService, extra: Partial<HostDeps> = {}) {
  const catalog: CatalogEntry[] = [{
    provider: {
      id: "demo-provider",
      name: "Demo",
      category: "cn_official",
      apiFormat: "anthropic",
      baseUrl: "https://example.invalid",
      apiKey: "sk-test",
      models: ["demo-model"],
      modelCapabilities: { "demo-model": { thinking: false, vision: false } },
      envTemplate: {},
    },
    spec: {
      id: "demo-provider",
      name: "Demo",
      kind: "deepseek",
      category: "cn_official",
      apiFormat: "anthropic",
      authMode: "api-key",
      baseUrl: "https://example.invalid",
      apiKeyUrl: "https://example.invalid/key",
      models: ["demo-model"],
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
    },
  }];
  const deps: HostDeps & { skillAdmin?: SkillAdminService } = {
    catalog,
    dataDir: "C:\\data",
    workspaceRoot: MEMORY,
    memoryDir: MEMORY,
    skillsIO: skillIo(),
    push: () => {},
    ...(skillAdmin ? { skillAdmin } : {}),
    ...extra,
  };
  return createBridgeHost(deps);
}

describe("bridge-host Skill administration", () => {
  it("decorates a managed user Skill with provenance without exposing internal paths as its source", async () => {
    const host = hostWith(admin());

    const skill = (await host.handleInvoke("bridge:listSkills", undefined))
      .find((candidate) => candidate.name === "demo-skill");

    expect(skill).toMatchObject({
      id: "managed:demo",
      trust: "personal",
      sourceLabel: "本地导入",
      scanStatus: "scanned",
      canRemove: true,
      canUpdate: false,
    });
    expect(JSON.stringify(skill)).not.toContain("C:\\Downloads\\demo");
  });

  it("routes inspect, install, and remove through the typed administration service", async () => {
    const service = admin();
    const host = hostWith(service);
    const invoke = host.handleInvoke.bind(host) as (channel: string, request: unknown) => Promise<unknown>;

    const inspected = await invoke("bridge:inspectSkillSource", { source: "C:\\Downloads\\demo" });
    expect(inspected).toEqual(expect.objectContaining({ sourceKind: "local-folder" }));
    expect(JSON.stringify(inspected)).not.toContain("C:\\Downloads\\demo");
    await expect(invoke("bridge:installSkill", { source: "C:\\Downloads\\demo", candidate: "demo-skill" }))
      .resolves.toEqual(expect.objectContaining({ installed: [expect.objectContaining({ name: "demo-skill" })] }));
    await expect(invoke("bridge:removeSkill", { id: "managed:demo" })).resolves.toBeUndefined();

    expect(service.inspect).toHaveBeenCalledWith("C:\\Downloads\\demo", { securityScan: false });
    expect(service.install).toHaveBeenCalledWith({ source: "C:\\Downloads\\demo", candidate: "demo-skill" });
    expect(service.remove).toHaveBeenCalledWith("managed:demo");
  });

  it("runs content scanning only when the caller explicitly asks for it", async () => {
    const service = admin();
    const host = hostWith(service);

    await host.handleInvoke("bridge:inspectSkillSource", {
      source: "C:\\Downloads\\demo",
      securityScan: true,
    });
    await host.handleInvoke("bridge:installSkill", {
      source: "C:\\Downloads\\demo",
      candidate: "demo-skill",
      securityScan: true,
    });

    expect(service.inspect).toHaveBeenCalledWith("C:\\Downloads\\demo", { securityScan: true });
    expect(service.install).toHaveBeenCalledWith({
      source: "C:\\Downloads\\demo",
      candidate: "demo-skill",
      securityScan: true,
    });
  });

  it("routes catalog installation and installed-skill scans through host-owned methods", async () => {
    const service = admin();
    const host = hostWith(service);

    await host.handleInvoke("bridge:listCommunitySkills", undefined);
    await host.handleInvoke("bridge:installCommunitySkill", { id: "grill-me" });
    await host.handleInvoke("bridge:scanInstalledSkill", { id: "demo-skill" });

    expect(service.listCatalog).toHaveBeenCalled();
    expect(service.installCatalog).toHaveBeenCalledWith("grill-me");
    expect(service.scanManaged).toHaveBeenCalledWith("demo-skill");
  });

  it("uses an injected native picker for ZIPs and folders without granting the renderer filesystem access", async () => {
    const pickSkillSource = vi.fn(async (kind: "archive" | "folder") => (
      kind === "archive" ? "C:\\Downloads\\demo.zip" : "C:\\Downloads\\demo"
    ));
    const service = admin();
    const catalogHost = hostWith(service, { pickSkillSource });

    await expect(catalogHost.handleInvoke("bridge:pickSkillSource", { kind: "archive" }))
      .resolves.toEqual({ path: "C:\\Downloads\\demo.zip" });
    await expect(catalogHost.handleInvoke("bridge:pickSkillSource", { kind: "folder" }))
      .resolves.toEqual({ path: "C:\\Downloads\\demo" });
    expect(pickSkillSource).toHaveBeenNthCalledWith(1, "archive");
    expect(pickSkillSource).toHaveBeenNthCalledWith(2, "folder");
  });

  it("registers the natural-language administration MCP in a live conversation", async () => {
    const host = hostWith(admin());
    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo-provider",
      modelId: "demo-model",
    });

    expect(host.inspect(created.conversationId)?.mcpServerNames).toContain("leemo-skill-admin");
  });

  it("reports administration as unavailable instead of pretending an install succeeded", async () => {
    const host = hostWith();
    const invoke = host.handleInvoke.bind(host) as (channel: string, request: unknown) => Promise<unknown>;

    await expect(invoke("bridge:installSkill", { source: "C:\\Downloads\\demo" }))
      .rejects.toThrow("没有启用 Skill 安装服务");
  });
});
