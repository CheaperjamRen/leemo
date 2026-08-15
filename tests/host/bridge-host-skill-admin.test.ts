import { describe, expect, it, vi } from "vitest";
import { createBridgeHost, type HostDeps } from "../../src/host/bridge-host";
import type { ManagedSkillRecord, SkillAdminService } from "../../src/host/skill-admin-service";
import type { SkillsIO } from "../../src/host/skills";
import type { CatalogEntry } from "../../src/host/provider-catalog";

const MEMORY = "C:\\Users\\Rengar\\Leemo";
const SKILLS = `${MEMORY}\\.leemo\\skills`;
const FAMILY_PLUGIN = `${MEMORY}\\.leemo\\packages\\managed-family`;

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
    loadCatalogDetails: vi.fn(async () => ({ markdown: "# 真实技能说明" })),
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
    pluginPathForQualifiedName: vi.fn(() => undefined),
  };
}

function familyRecords(): ManagedSkillRecord[] {
  return ["auth", "content", "explore", "interact", "publish"].map((name, index) => ({
    id: `managed:family-${name}`,
    name: `Family ${name}`,
    description: `${name} description`,
    dir: `${FAMILY_PLUGIN}\\skills\\family-${name}`,
    trust: "community" as const,
    sourceKind: "github" as const,
    sourceLabel: "Trusted Author",
    source: "https://github.com/trusted/family",
    resolvedSource: "https://github.com/trusted/family",
    candidate: `family-${name}`,
    scanStatus: "scanned" as const,
    findings: [],
    category: "productivity",
    categoryLabel: "效率",
    catalogId: `family-${name}`,
    packageId: "package:family",
    familyCatalogId: "trusted-family",
    familyLabel: "Trusted Family",
    qualifiedName: `leemo-community-family:family-${name}`,
    available: true,
    setupRequired: true,
    setupMessage: "首次使用需先完成 Python / uv 环境设置。",
    installedAt: 10 + index,
    updatedAt: 10 + index,
    repository: "trusted/family",
    revision: "0123456789abcdef0123456789abcdef01234567",
    license: "MIT",
  }));
}

function familyAdmin(initiallyInstalled = true): SkillAdminService {
  const base = admin();
  let records = initiallyInstalled ? familyRecords() : [];
  return {
    ...base,
    installCatalog: vi.fn(async () => {
      records = familyRecords();
      return { installed: records.map((record) => ({ ...record, findings: [] })) };
    }),
    listManaged: vi.fn(() => records.map((record) => ({ ...record, findings: [] }))),
    remove: vi.fn(() => { records = []; }),
    metadataForDir: vi.fn(() => undefined),
    pluginPathForQualifiedName: vi.fn((qualifiedName: string) => (
      records.some((record) => record.qualifiedName === qualifiedName) ? FAMILY_PLUGIN : undefined
    )),
  };
}

function hostWith(skillAdmin?: SkillAdminService, extra: Partial<HostDeps> = {}) {
  const catalog: CatalogEntry[] = [{
    executionEngine: "claude-agent-sdk",
    provider: {
      id: "demo-provider",
      name: "Demo",
      category: "cn_official",
      apiFormat: "anthropic",
      baseUrl: "https://example.invalid",
      apiKey: "test-key",
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
    await host.handleInvoke("bridge:getCommunitySkillDetails", { id: "grill-me" });
    await host.handleInvoke("bridge:installCommunitySkill", { id: "grill-me" });
    await host.handleInvoke("bridge:scanInstalledSkill", { id: "demo-skill" });

    expect(service.listCatalog).toHaveBeenCalled();
    expect(service.loadCatalogDetails).toHaveBeenCalledWith("grill-me");
    expect(service.installCatalog).toHaveBeenCalledWith("grill-me");
    expect(service.scanManaged).toHaveBeenCalledWith("demo-skill");
  });

  it("reads an installed Skill's local SKILL.md before falling back to the community catalog", async () => {
    const service = admin();
    const host = hostWith(service);

    await expect(host.handleInvoke("bridge:getCommunitySkillDetails", { id: "managed:demo" }))
      .resolves.toEqual({
        markdown: "---\nname: demo-skill\ndescription: Demo description\n---\nUse it.",
      });
    expect(service.loadCatalogDetails).not.toHaveBeenCalled();
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

  it("lists five family members as one collection without inventing a sixth root card", async () => {
    const host = hostWith(familyAdmin());

    const family = (await host.handleInvoke("bridge:listSkills", undefined))
      .filter((skill) => skill.collectionId === "family:trusted-family");

    expect(family).toHaveLength(5);
    expect(family.every((skill) => (
      skill.collectionLabel === "Trusted Family"
      && skill.collectionMemberCount === 5
      && skill.canUpdate === false
      && skill.available === true
      && skill.setupRequired === true
      && skill.setupMessage === "首次使用需先完成 Python / uv 环境设置。"
    ))).toBe(true);
    expect(family.map((skill) => skill.commandName).sort()).toEqual([
      "family-auth",
      "family-content",
      "family-explore",
      "family-interact",
      "family-publish",
    ]);
    expect(JSON.stringify(family)).not.toContain(FAMILY_PLUGIN);
  });

  it("routes one enabled family member through one shared plugin and one exact allow-list name", async () => {
    const seen: Record<string, unknown>[] = [];
    const queryImpl: HostDeps["queryImpl"] = (params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never;
    const host = hostWith(familyAdmin(), { queryImpl });
    const qualifiedName = "leemo-community-family:family-explore";
    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo-provider",
      modelId: "demo-model",
      enabledSkills: [qualifiedName],
    });

    await host.handleInvoke("bridge:send", { conversationId: created.conversationId, prompt: "explore" });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0].plugins).toEqual([{ type: "local", path: FAMILY_PLUGIN }]);
    expect(seen[0].skills).toEqual([qualifiedName]);
  });

  it("hot-removes every family member from a live conversation after any member is removed", async () => {
    const seen: Record<string, unknown>[] = [];
    let finished = 0;
    const queryImpl: HostDeps["queryImpl"] = (params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never;
    const service = familyAdmin();
    const host = hostWith(service, {
      queryImpl,
      push: ((channel: string, payload: unknown) => {
        if (
          channel === "bridge:event"
          && (payload as { event?: { type?: string } }).event?.type === "run.finished"
        ) finished += 1;
      }) as HostDeps["push"],
    });
    const allNames = familyRecords().map((record) => record.qualifiedName!);
    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo-provider",
      modelId: "demo-model",
      enabledSkills: allNames,
    });
    await host.handleInvoke("bridge:send", { conversationId: created.conversationId, prompt: "first" });
    await vi.waitFor(() => expect(finished).toBe(1));
    expect(seen[0].plugins).toEqual([{ type: "local", path: FAMILY_PLUGIN }]);
    expect(seen[0].skills).toEqual(allNames);

    await host.handleInvoke("bridge:removeSkill", { id: "managed:family-explore" });
    await host.handleInvoke("bridge:send", { conversationId: created.conversationId, prompt: "second" });
    await vi.waitFor(() => expect(finished).toBe(2));

    expect(service.remove).toHaveBeenCalledWith("managed:family-explore");
    expect("plugins" in seen[1]).toBe(false);
    expect("skills" in seen[1]).toBe(false);
  });

  it("hot-adds all five exact family names through one shared plugin after one catalog install", async () => {
    const seen: Record<string, unknown>[] = [];
    const queryImpl: HostDeps["queryImpl"] = (params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never;
    const service = familyAdmin(false);
    const host = hostWith(service, { queryImpl });
    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo-provider",
      modelId: "demo-model",
      enabledSkills: [],
    });

    const outcome = await host.handleInvoke("bridge:installCommunitySkill", { id: "trusted-family" });
    expect(outcome.receipt).toBe("已安装 Trusted Family · 5 个技能 · 来源 Trusted Author · 已通过预审");
    await host.handleInvoke("bridge:send", { conversationId: created.conversationId, prompt: "use family" });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0].plugins).toEqual([{ type: "local", path: FAMILY_PLUGIN }]);
    expect(seen[0].skills).toEqual(familyRecords().map((record) => record.qualifiedName));
  });
});
