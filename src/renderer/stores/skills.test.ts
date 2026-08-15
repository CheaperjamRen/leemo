import { describe, it, expect, vi } from "vitest";
import { createSkillsStore, selectEnabledQualifiedNames, resolveEnabledSkills } from "./skills";
import type { BridgeClient } from "../bridge/client";
import type { CommunitySkillView, SkillInfo } from "../../bridge/contract";
import type { SkillSourceInspectionView } from "../../bridge/contract";

function skill(name: string, description = `${name} 的说明`): SkillInfo {
  return {
    name,
    description,
    qualifiedName: `leemo:${name}`,
    dir: `C:\\Users\\Rengar\\Leemo\\.leemo\\skills\\${name}`,
    source: "user",
  };
}

const SUPERPOWERS_NAMES = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

function superpowersSkills(): SkillInfo[] {
  return SUPERPOWERS_NAMES.map((name) => ({
    id: `superpowers:${name}`,
    name,
    description: `${name} 的开发方法`,
    qualifiedName: `superpowers:${name}`,
    source: "builtin",
    category: "developer",
    defaultEnabled: false,
    available: true,
    collectionId: "superpowers",
    collectionLabel: "Superpowers 开发方法套件",
  }));
}

const XHS_NAMES = ["xhs-auth", "xhs-content-ops", "xhs-explore", "xhs-interact", "xhs-publish"] as const;

function xhsFamilySkills(): SkillInfo[] {
  return XHS_NAMES.map((name) => ({
    id: `managed:${name}`,
    name,
    description: `${name} 的小红书能力`,
    qualifiedName: `leemo-community-xhs:${name}`,
    source: "user",
    category: "social-publishing",
    trust: "community",
    sourceKind: "github",
    sourceLabel: "社区精选",
    scanStatus: "scanned",
    canRemove: true,
    canUpdate: false,
    collectionId: "family:xiaohongshu-toolkit",
    collectionLabel: "小红书工具组",
    collectionMemberCount: 5,
  }));
}

function makeClient(list: SkillInfo[] = [], opts: { failList?: boolean; failSync?: boolean } = {}) {
  const calls: { channel: string; req: unknown }[] = [];
  const client = {
    invoke: vi.fn(async (channel: string, req: unknown) => {
      calls.push({ channel, req });
      if (channel === "bridge:listSkills") {
        if (opts.failList) throw new Error("host exploded");
        return list;
      }
      if (channel === "bridge:syncEnabledSkills" && opts.failSync) throw new Error("sync failed");
      if (channel === "bridge:openSkillsDir") return undefined;
      return undefined;
    }),
    subscribe: vi.fn(() => () => {}),
  } as unknown as BridgeClient & { invoke: ReturnType<typeof vi.fn> };
  return { client, calls };
}

describe("skills store — refresh", () => {
  it("loads the installed skills from the bridge", async () => {
    const { client } = makeClient([skill("pdf"), skill("期末速通")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    expect(store.getState().list.map((s) => s.name)).toEqual(["pdf", "期末速通"]);
    expect(store.getState().status).toBe("ready");
  });

  it("starts empty and loading before the first refresh", () => {
    const { client } = makeClient();
    const store = createSkillsStore(client);
    expect(store.getState().list).toEqual([]);
    expect(store.getState().status).toBe("loading");
  });

  it("degrades to an empty list instead of throwing when the host fails", async () => {
    // A broken scan must leave the SkillsPage usable (empty state), not crash it.
    const { client } = makeClient([], { failList: true });
    const store = createSkillsStore(client);
    await expect(store.getState().refresh()).resolves.toBeUndefined();
    expect(store.getState().list).toEqual([]);
    expect(store.getState().status).toBe("error");
  });

  it("keeps a skill the user disabled disabled across a refresh", async () => {
    const { client } = makeClient([skill("pdf"), skill("docx")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    store.getState().toggle("pdf");
    await store.getState().refresh();
    expect(store.getState().disabled).toEqual(["pdf"]);
    expect(selectEnabledQualifiedNames(store.getState())).toEqual(["leemo:docx"]);
  });

  it("refreshes any preparing bundled capability without relying on an Office-only id prefix", async () => {
    vi.useFakeTimers();
    try {
      const preparing: SkillInfo = {
        id: "bundled:frontend-design",
        name: "frontend-design",
        description: "设计真实产品界面",
        qualifiedName: "leemo-library:frontend-design",
        source: "builtin",
        defaultEnabled: true,
        available: false,
        unavailableReason: "正在准备内置技能，稍后即可使用。",
      };
      let reads = 0;
      const client = {
        invoke: vi.fn(async (channel: string) => {
          if (channel === "bridge:listSkills") {
            reads += 1;
            return reads === 1 ? [preparing] : [{ ...preparing, available: true, unavailableReason: undefined }];
          }
          if (channel === "bridge:listCommunitySkills") return [];
          return undefined;
        }),
        subscribe: vi.fn(() => () => {}),
      } as unknown as BridgeClient;
      const store = createSkillsStore(client);

      await store.getState().refresh();
      expect(store.getState().list[0]?.available).toBe(false);

      await vi.advanceTimersByTimeAsync(1_600);
      expect(store.getState().list[0]?.available).toBe(true);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("skills store — built-in defaults and persisted overrides", () => {
  const builtin = (id: string, name: string, defaultEnabled: boolean): SkillInfo => ({
    id,
    name,
    description: `${name} 的明确用途说明`,
    qualifiedName: `leemo-library:${name}`,
    source: "builtin",
    category: "learning",
    requirements: ["core"],
    defaultEnabled,
    available: true,
  });

  it("uses stable ids and enables only catalog defaults on first refresh", async () => {
    const list = [builtin("daily-plan", "每日计划", true), builtin("quiz-generator", "出题测验", false)];
    const { client } = makeClient(list);
    const saved: Record<string, boolean> = {};
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore: (id, previous) => {
        if (previous === undefined) delete saved[id];
        else saved[id] = previous;
      },
    });
    await store.getState().refresh();
    expect(store.getState().disabled).toEqual(["quiz-generator"]);
    expect(resolveEnabledSkills(store.getState())).toEqual(["leemo-library:每日计划"]);
  });

  it("applies a persisted override before resolving the first allow-list", async () => {
    const list = [builtin("daily-plan", "每日计划", true), builtin("quiz-generator", "出题测验", false)];
    const { client } = makeClient(list);
    const saved = { "daily-plan": false, "quiz-generator": true };
    const store = createSkillsStore(client, {
      get: (id) => saved[id as keyof typeof saved],
      set: () => {},
      restore: () => {},
    });
    await store.getState().refresh();
    expect(store.getState().disabled).toEqual(["daily-plan"]);
    expect(resolveEnabledSkills(store.getState())).toEqual(["leemo-library:出题测验"]);
  });

  it("rolls back the switch and preference when host sync fails", async () => {
    const list = [builtin("daily-plan", "每日计划", true)];
    const { client } = makeClient(list, { failSync: true });
    const saved: Record<string, boolean> = {};
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore: (id, previous) => {
        if (previous === undefined) delete saved[id];
        else saved[id] = previous;
      },
    });
    await store.getState().refresh();
    store.getState().toggle("daily-plan");
    expect(store.getState().disabled).toEqual(["daily-plan"]);
    await vi.waitFor(() => expect(store.getState().error).toBe("sync failed"));
    expect(store.getState().disabled).toEqual([]);
    expect(saved).toEqual({});
  });
});

describe("skills store — collection controls", () => {
  const unrelated: SkillInfo = {
    id: "daily-plan",
    name: "每日计划",
    description: "安排当天的重点",
    qualifiedName: "leemo-library:daily-plan",
    source: "builtin",
    category: "learning",
    defaultEnabled: true,
    available: true,
  };

  it("updates the whole collection in one store transaction and one host sync", async () => {
    const list = [...superpowersSkills(), unrelated];
    const { client, calls } = makeClient(list);
    const saved: Record<string, boolean> = {};
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore: (id, previous) => {
        if (previous === undefined) delete saved[id];
        else saved[id] = previous;
      },
    });
    await store.getState().refresh();

    let transactions = 0;
    const unsubscribe = store.subscribe(() => { transactions += 1; });
    store.getState().setCollectionEnabled("superpowers", true);
    expect(transactions).toBe(1);
    unsubscribe();

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.channel === "bridge:syncEnabledSkills")).toHaveLength(1);
    });
    expect(store.getState().disabled).toEqual([]);
    expect(Object.fromEntries(SUPERPOWERS_NAMES.map((name) => [
      `superpowers:${name}`,
      saved[`superpowers:${name}`],
    ]))).toEqual(Object.fromEntries(SUPERPOWERS_NAMES.map((name) => [`superpowers:${name}`, true])));
    expect(calls.find((call) => call.channel === "bridge:syncEnabledSkills")?.req).toEqual({
      enabledQualifiedNames: [
        ...SUPERPOWERS_NAMES.map((name) => `superpowers:${name}`),
        "leemo-library:daily-plan",
      ],
    });
  });

  it("rolls back only members that the user did not change while a suite sync was pending", async () => {
    const list = [...superpowersSkills(), unrelated];
    const saved: Record<string, boolean> = Object.fromEntries(
      SUPERPOWERS_NAMES.map((name, index) => [`superpowers:${name}`, index === 0]),
    );
    let rejectSuiteSync!: (reason?: unknown) => void;
    const suiteSync = new Promise<never>((_resolve, reject) => { rejectSuiteSync = reject; });
    let syncCalls = 0;
    const syncRequests: string[][] = [];
    const client = {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        if (channel === "bridge:listSkills") return list;
        if (channel === "bridge:listCommunitySkills") return [];
        if (channel === "bridge:syncEnabledSkills") {
          syncCalls += 1;
          syncRequests.push([...(request as { enabledQualifiedNames: string[] }).enabledQualifiedNames]);
          if (syncCalls === 1) return suiteSync;
          return { updatedConversations: 1 };
        }
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore: (id, previous) => {
        if (previous === undefined) delete saved[id];
        else saved[id] = previous;
      },
    });
    await store.getState().refresh();

    store.getState().setCollectionEnabled("superpowers", true);
    store.getState().toggle("superpowers:brainstorming");
    rejectSuiteSync(new Error("suite sync failed"));

    await vi.waitFor(() => expect(store.getState().error).toBe("suite sync failed"));
    expect(store.getState().disabled).toEqual(SUPERPOWERS_NAMES.map((name) => `superpowers:${name}`));
    expect(Object.values(saved)).toEqual(Array.from({ length: 14 }, () => false));
    expect(syncCalls).toBe(3);
    expect(syncRequests.at(-1)).toEqual(["leemo-library:daily-plan"]);
  });

  it("reports one failed reconciliation without recursively retrying", async () => {
    const list = superpowersSkills();
    const saved: Record<string, boolean> = {};
    let syncCalls = 0;
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listSkills") return list;
        if (channel === "bridge:listCommunitySkills") return [];
        if (channel === "bridge:syncEnabledSkills") {
          syncCalls += 1;
          throw new Error(syncCalls === 1 ? "suite sync failed" : "reconcile failed");
        }
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore: (id, previous) => {
        if (previous === undefined) delete saved[id];
        else saved[id] = previous;
      },
    });
    await store.getState().refresh();

    store.getState().setCollectionEnabled("superpowers", true);

    await vi.waitFor(() => expect(store.getState().error).toContain("恢复后的技能状态仍未同步"));
    expect(store.getState().error).toContain("suite sync failed");
    expect(store.getState().error).toContain("reconcile failed");
    expect(store.getState().disabled).toEqual(SUPERPOWERS_NAMES.map((name) => `superpowers:${name}`));
    expect(saved).toEqual({});
    expect(syncCalls).toBe(2);
  });

  it("restores one enabled and thirteen disabled members without rewriting defaults", async () => {
    const list = superpowersSkills();
    const saved: Record<string, boolean> = Object.fromEntries(
      SUPERPOWERS_NAMES.map((name, index) => [`superpowers:${name}`, index === 0]),
    );
    const write = vi.fn((id: string, enabled: boolean) => { saved[id] = enabled; });
    const { client, calls } = makeClient(list);
    const preferences = {
      get: (id: string) => saved[id],
      set: write,
      restore: vi.fn(),
    };
    const firstRun = createSkillsStore(client, preferences);
    await firstRun.getState().refresh();
    await firstRun.getState().refresh();

    const restarted = createSkillsStore(client, preferences);
    await restarted.getState().refresh();

    const expectedDisabled = SUPERPOWERS_NAMES.slice(1).map((name) => `superpowers:${name}`);
    expect(firstRun.getState().disabled).toEqual(expectedDisabled);
    expect(restarted.getState().disabled).toEqual(expectedDisabled);
    expect(write).not.toHaveBeenCalled();
    expect(calls.some((call) => call.channel === "bridge:syncEnabledSkills")).toBe(false);
  });
});

describe("skills store — toggle (disabled list stores BARE names, user's view)", () => {
  it("disables an enabled skill and re-enables it on a second toggle", async () => {
    const { client } = makeClient([skill("pdf")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    expect(store.getState().disabled).toEqual([]);

    store.getState().toggle("pdf");
    expect(store.getState().disabled).toEqual(["pdf"]);

    store.getState().toggle("pdf");
    expect(store.getState().disabled).toEqual([]);
  });

  it("stores the BARE name in `disabled`, never the qualified one", async () => {
    // 铁律 §二: the prefix exists in qualifiedName only. `disabled` is user-facing
    // state (it mirrors the switches they flipped), so it holds bare names.
    const { client } = makeClient([skill("pdf")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    store.getState().toggle("pdf");
    for (const name of store.getState().disabled) expect(name).not.toContain(":");
  });

  it("ignores a toggle for a name that is not installed", async () => {
    const { client } = makeClient([skill("pdf")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    store.getState().toggle("ghost");
    expect(store.getState().disabled).toEqual([]);
  });

  it("does not duplicate an entry when toggled twice off via stale UI", async () => {
    const { client } = makeClient([skill("pdf")]);
    const store = createSkillsStore(client);
    await store.getState().refresh();
    store.getState().toggle("pdf");
    // Simulate a double-fire (two rapid clicks on the same switch): the second
    // one flips it back on rather than appending a duplicate.
    store.getState().toggle("pdf");
    store.getState().toggle("pdf");
    expect(store.getState().disabled).toEqual(["pdf"]);
  });
});

describe("skills store — openDir", () => {
  it("asks the bridge to reveal the skills directory", async () => {
    const { client, calls } = makeClient([skill("pdf")]);
    const store = createSkillsStore(client);
    await store.getState().openDir();
    expect(calls.map((c) => c.channel)).toContain("bridge:openSkillsDir");
  });

  it("swallows a failure (nothing to show the user, nothing to crash)", async () => {
    const client = {
      invoke: vi.fn(async () => {
        throw new Error("no shell");
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createSkillsStore(client);
    await expect(store.getState().openDir()).resolves.toBeUndefined();
  });
});

describe("skills store — managed installation journey", () => {
  const communityEntry: CommunitySkillView = {
    id: "grill-me",
    name: "grill-me",
    description: "用追问检验方案是否真的站得住。",
    category: "workbench",
    categoryLabel: "通用工作台",
    featured: true,
    author: "Matt Pocock",
    repository: "mattpocock/skills",
    revision: "abc123",
    license: "MIT",
    sourceUrl: "https://github.com/mattpocock/skills/tree/abc123/skills/productivity/grilling",
    installed: false,
    scanStatus: "scanned",
  };
  const inspection: SkillSourceInspectionView = {
    sourceKind: "github",
    sourceLabel: "community-author",
    resolvedSource: "https://github.com/community/skills/tree/abc123/demo",
    repository: "community/skills",
    revision: "abc123",
    license: "MIT",
    candidates: [{
      name: "demo",
      description: "把网页内容整理成干净 Markdown。",
    }],
  };
  const scannedInspection: SkillSourceInspectionView = {
    ...inspection,
    candidates: [{
      ...inspection.candidates[0],
      scan: { status: "scanned", findings: [], analyzedFiles: 2, analysis: "static" },
    }],
  };

  function adminClient() {
    let list: SkillInfo[] = [skill("existing")];
    let community = [communityEntry];
    const calls: { channel: string; req: unknown }[] = [];
    const client = {
      invoke: vi.fn(async (channel: string, req: unknown) => {
        calls.push({ channel, req });
        if (channel === "bridge:listSkills") return list;
        if (channel === "bridge:listCommunitySkills") return community;
        if (channel === "bridge:pickSkillSource") return { path: "C:\\Downloads\\demo.zip" };
        if (channel === "bridge:inspectSkillSource") {
          return (req as { securityScan?: boolean }).securityScan ? scannedInspection : inspection;
        }
        if (channel === "bridge:installSkill") {
          list = [...list, {
            id: "managed:demo",
            name: "demo",
            description: "把网页内容整理成干净 Markdown。",
            qualifiedName: "leemo:demo",
            source: "user",
            trust: "personal",
            sourceKind: "github",
            sourceLabel: "community-author",
            scanStatus: "unscanned",
            canRemove: true,
            canUpdate: true,
          }];
          return {
            installed: [{
              id: "managed:demo",
              name: "demo",
              description: "把网页内容整理成干净 Markdown。",
              trust: "personal",
              sourceKind: "github",
              sourceLabel: "community-author",
              scanStatus: "unscanned",
              canUpdate: true,
            }],
            receipt: "已安装 demo · 来源 community-author · 未扫描",
          };
        }
        if (channel === "bridge:installCommunitySkill") {
          list = [...list, {
            id: "managed:grill-me",
            name: "grill-me",
            description: communityEntry.description,
            qualifiedName: "leemo:grill-me",
            source: "user",
            category: "workbench",
            categoryLabel: "通用工作台",
            trust: "community",
            sourceKind: "github",
            sourceLabel: "Matt Pocock",
            scanStatus: "scanned",
            canRemove: true,
            canUpdate: false,
          }];
          community = [{ ...communityEntry, installed: true }];
          return {
            installed: [],
            receipt: "已安装 grill-me",
          };
        }
        if (channel === "bridge:scanInstalledSkill") {
          return {
            id: "managed:demo",
            name: "demo",
            description: "Demo",
            trust: "personal",
            sourceKind: "github",
            sourceLabel: "GitHub",
            scanStatus: "review",
            securityFindings: [{
              rule: "credential-access",
              severity: "high",
              title: "会读取凭据",
              detail: "说明中要求读取本地凭据。",
              file: "SKILL.md",
            }],
            canUpdate: true,
          };
        }
        if (channel === "bridge:removeSkill") {
          list = list.filter((candidate) => candidate.id !== (req as { id: string }).id);
          return undefined;
        }
        if (channel === "bridge:syncEnabledSkills") return { updatedConversations: 1 };
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient & { invoke: ReturnType<typeof vi.fn> };
    return { client, calls };
  }

  it("picks a local source through the native bridge", async () => {
    const { client } = adminClient();
    const store = createSkillsStore(client);

    await expect(store.getState().pickSource("archive")).resolves.toBe("C:\\Downloads\\demo.zip");
    expect(client.invoke).toHaveBeenCalledWith("bridge:pickSkillSource", { kind: "archive" });
  });

  it("loads the open community catalog alongside installed skills", async () => {
    const { client } = adminClient();
    const store = createSkillsStore(client);

    await store.getState().refresh();

    expect(store.getState().community).toEqual([communityEntry]);
  });

  it("installs a pre-reviewed catalog skill and refreshes both lists", async () => {
    const { client, calls } = adminClient();
    const store = createSkillsStore(client);
    await store.getState().refresh();

    await expect(store.getState().installCommunity("grill-me")).resolves.toBe(true);

    expect(store.getState().list.map((candidate) => candidate.name)).toContain("grill-me");
    expect(store.getState().community.find((candidate) => candidate.id === "grill-me")?.installed).toBe(true);
    expect(calls).toContainEqual({ channel: "bridge:installCommunitySkill", req: { id: "grill-me" } });
  });

  it("reports an installed-skill scan without disabling or removing the skill", async () => {
    const { client } = adminClient();
    const store = createSkillsStore(client);
    await store.getState().refresh();
    const before = store.getState().list.map((candidate) => candidate.name);

    await expect(store.getState().scanInstalled("managed:demo")).resolves.toBe(true);

    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(before);
    expect(store.getState().scanResult).toMatchObject({ name: "demo", scanStatus: "review" });
    expect(client.invoke).toHaveBeenCalledWith("bridge:scanInstalledSkill", { id: "managed:demo" });
  });

  it("keeps inspection evidence for the install review without changing the catalog", async () => {
    const { client } = adminClient();
    const store = createSkillsStore(client);
    await store.getState().refresh();

    await expect(store.getState().inspectSource("https://github.com/community/skills/tree/main/demo"))
      .resolves.toEqual(inspection);
    expect(store.getState()).toMatchObject({
      adminStatus: "idle",
      inspectedSource: "https://github.com/community/skills/tree/main/demo",
      inspection,
    });
    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(["existing"]);
    expect(client.invoke).toHaveBeenCalledWith("bridge:inspectSkillSource", {
      source: "https://github.com/community/skills/tree/main/demo",
      securityScan: false,
    });
  });

  it("runs the optional security scan only when explicitly requested", async () => {
    const { client } = adminClient();
    const store = createSkillsStore(client);

    await expect(store.getState().inspectSource(
      "https://github.com/community/skills/tree/main/demo",
      true,
    )).resolves.toEqual(scannedInspection);
    expect(client.invoke).toHaveBeenCalledWith("bridge:inspectSkillSource", {
      source: "https://github.com/community/skills/tree/main/demo",
      securityScan: true,
    });
  });

  it("refreshes and synchronizes enabled skills after a successful install", async () => {
    const { client, calls } = adminClient();
    const store = createSkillsStore(client);
    await store.getState().refresh();
    await store.getState().inspectSource("https://github.com/community/skills/tree/main/demo");

    await expect(store.getState().installSource({
      source: "https://github.com/community/skills/tree/main/demo",
      candidate: "demo",
    })).resolves.toBe(true);

    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(["existing", "demo"]);
    expect(store.getState().receipt).toBe("已安装 demo · 来源 community-author · 未扫描");
    expect(store.getState().inspection).toBeUndefined();
    expect(calls).toContainEqual({
      channel: "bridge:syncEnabledSkills",
      req: { enabledQualifiedNames: ["leemo:existing", "leemo:demo"] },
    });
  });

  it("keeps existing skills intact when installation fails", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listSkills") return [skill("existing")];
        if (channel === "bridge:installSkill") throw new Error("连接 GitHub 超时。");
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createSkillsStore(client);
    await store.getState().refresh();

    await expect(store.getState().installSource({ source: "https://github.com/community/skills" }))
      .resolves.toBe(false);
    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(["existing"]);
    expect(store.getState().adminError).toContain("连接 GitHub 超时");
    expect(store.getState().receipt).toBeUndefined();
  });

  it("removes only the managed skill, refreshes, and synchronizes the remaining allow-list", async () => {
    const { client, calls } = adminClient();
    const store = createSkillsStore(client);
    await store.getState().refresh();
    await store.getState().installSource({ source: "https://github.com/community/skills", candidate: "demo" });

    await expect(store.getState().removeSkill("managed:demo")).resolves.toBe(true);

    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(["existing"]);
    expect(store.getState().receipt).toBe("已卸载 demo");
    expect(calls.at(-1)).toEqual({
      channel: "bridge:syncEnabledSkills",
      req: { enabledQualifiedNames: ["leemo:existing"] },
    });
  });

  it("removes a shared-runtime family once and clears every member preference", async () => {
    const existing = skill("existing");
    let list = [existing, ...xhsFamilySkills()];
    const calls: { channel: string; req: unknown }[] = [];
    const client = {
      invoke: vi.fn(async (channel: string, req: unknown) => {
        calls.push({ channel, req });
        if (channel === "bridge:listSkills") return list;
        if (channel === "bridge:listCommunitySkills") return [];
        if (channel === "bridge:removeSkill") {
          list = [existing];
          return undefined;
        }
        if (channel === "bridge:syncEnabledSkills") return { updatedConversations: 1 };
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const saved: Record<string, boolean> = {
      existing: false,
      ...Object.fromEntries(XHS_NAMES.map((name) => [`managed:${name}`, true])),
    };
    const restore = vi.fn((id: string, previous: boolean | undefined) => {
      if (previous === undefined) delete saved[id];
      else saved[id] = previous;
    });
    const store = createSkillsStore(client, {
      get: (id) => saved[id],
      set: (id, enabled) => { saved[id] = enabled; },
      restore,
    });
    await store.getState().refresh();

    await expect(store.getState().removeSkill("managed:xhs-auth")).resolves.toBe(true);

    expect(calls.filter((call) => call.channel === "bridge:removeSkill")).toEqual([{
      channel: "bridge:removeSkill",
      req: { id: "managed:xhs-auth" },
    }]);
    expect(store.getState().list.map((candidate) => candidate.name)).toEqual(["existing"]);
    expect(store.getState().receipt).toBe("已卸载 小红书工具组");
    expect(restore.mock.calls).toEqual(XHS_NAMES.map((name) => [`managed:${name}`, undefined]));
    expect(saved).toEqual({ existing: false });
    expect(calls.at(-1)).toEqual({
      channel: "bridge:syncEnabledSkills",
      req: { enabledQualifiedNames: [] },
    });
  });
});

describe("selectEnabledQualifiedNames — the ONLY place prefixes are produced", () => {
  it("maps enabled skills to their qualified names", () => {
    const state = { list: [skill("pdf"), skill("docx")], disabled: [] } as never;
    expect(selectEnabledQualifiedNames(state)).toEqual(["leemo:pdf", "leemo:docx"]);
  });

  it("filters out disabled skills by bare name", () => {
    const state = { list: [skill("pdf"), skill("docx")], disabled: ["docx"] } as never;
    expect(selectEnabledQualifiedNames(state)).toEqual(["leemo:pdf"]);
  });

  it("returns [] when everything is disabled", () => {
    const state = { list: [skill("pdf")], disabled: ["pdf"] } as never;
    expect(selectEnabledQualifiedNames(state)).toEqual([]);
  });
});

describe("resolveEnabledSkills — [] vs undefined is a REAL distinction (sdk.d.ts:1877)", () => {
  // The SDK treats an omitted `skills` as "no SDK auto-configuration, CLI
  // defaults still apply" — explicitly NOT skills-off — while `[]` is a real,
  // empty allow-list. Collapsing the two would either (a) leave a skill the user
  // switched off still firing, or (b) silently strip CC's own built-in skills
  // from every conversation on a machine that has no Leemo skills at all.
  it("returns undefined when NO skills are installed (leave today's behaviour alone)", () => {
    expect(resolveEnabledSkills({ list: [], disabled: [] } as never)).toBeUndefined();
  });

  it("returns [] — not undefined — when skills exist but the user disabled them all", () => {
    const result = resolveEnabledSkills({ list: [skill("pdf")], disabled: ["pdf"] } as never);
    expect(result).toEqual([]);
    expect(result).not.toBeUndefined();
  });

  it("returns the qualified allow-list when some are enabled", () => {
    expect(
      resolveEnabledSkills({ list: [skill("pdf"), skill("docx")], disabled: ["docx"] } as never),
    ).toEqual(["leemo:pdf"]);
  });

  // 用户 2026-07-26 拍板: the switch HIDES, it does not sandbox. In the partial
  // case the plugin stays loaded for the skills still on, so a switched-off skill
  // remains reachable by typing its exact name (slash commands are expanded by
  // the CLI before the allow-list is consulted). Pinned as a test so a later
  // reader does not mistake the switch for a security boundary and "fix" it into
  // one without a product decision.
  it("documents that a switched-off skill is HIDDEN, not sandboxed (partial case)", () => {
    const state = { list: [skill("pdf"), skill("docx")], disabled: ["docx"] };
    // docx is withheld from the model's listing…
    expect(resolveEnabledSkills(state as never)).toEqual(["leemo:pdf"]);
    // …but it is still installed on disk and the plugin carrying it is still
    // loaded (the host only drops the plugin when EVERYTHING is off — see
    // bridge-host.test.ts "omits the plugin entirely when the user disabled
    // every skill"). So `disabled` is a UI/context filter, not a guarantee.
    expect(state.list.some((s) => s.name === "docx")).toBe(true);
  });
});
