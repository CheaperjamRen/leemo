import { describe, expect, it } from "vitest";
import {
  buildGreeting,
  createSettingsStore,
  pickPersistedSettings,
  webFetchActive,
  webSearchActive,
  PERSISTED_SETTING_KEYS,
} from "./settings";

const defaultCard = {
  id: "momo", name: "momo", tagline: "温柔而靠谱", promptText: "你是 momo。", builtin: true,
};

describe("buildGreeting", () => {
  it("varies by time of day", () => {
    expect(buildGreeting(8)).toContain("早");
    expect(buildGreeting(14)).toContain("下午");
    expect(buildGreeting(22)).toContain("晚");
  });
  it("weaves in a memory line when provided", () => {
    expect(buildGreeting(8, "第五章笔记整理完了")).toContain("第五章笔记整理完了");
  });
});

describe("settings store", () => {
  it("keeps legacy defaults and starts with safe, key-free foundation values", () => {
    const state = createSettingsStore().getState();
    expect(state.mode).toBe("buddy");
    expect(state.persona).toBe("momo");
    expect(state.personaCardId).toBe("momo");
    expect(state.personaCards).toContainEqual(defaultCard);
    expect(state.talkStyle).toBe(3);
    expect(state.defaultProviderId).toBeNull();
    expect(state.defaultModelId).toBeNull();
    expect(state.providerOrder).toEqual([]);
    expect(state.permissionMode).toBe("acceptEdits");
    expect(state.dangerousCommandCaching).toBe(false);
    // 统筹关 + 两个二级开 ⇒ 生效值仍是「都不能」。
    expect(state.webEnabled).toBe(false);
    expect(state.webSearchEnabled).toBe(true);
    expect(state.webFetchEnabled).toBe(true);
    expect(webSearchActive(state)).toBe(false);
    expect(webFetchActive(state)).toBe(false);
    expect(state.searchKeySources).toEqual([]);
    expect(state.rememberMode).toBe(true);
    expect(state.skillOverrides).toEqual({});
    expect(state.onboardingCompleted).toBe(false);
    expect(typeof state.dataDir).toBe("string");
    expect(JSON.stringify(state)).not.toMatch(/apiKey|token|secret/i);
  });

  it("updates each setting through explicit immutable actions", () => {
    const store = createSettingsStore({ personaCards: [defaultCard, { ...defaultCard, id: "work", name: "Work", builtin: false }] });
    const originalCards = store.getState().personaCards;
    store.getState().setMode("workbench");
    store.getState().setPersonaCard("work");
    store.getState().setTalkStyle(1);
    store.getState().setDefaultModel("alpha", "model-1");
    store.getState().setProviderOrder(["alpha", "beta"]);
    store.getState().setPermissionMode("plan");
    store.getState().setDangerousCommandCaching(true);
    store.getState().setWebEnabled(true);
    store.getState().setWebSearchEnabled(true);
    store.getState().setWebFetchEnabled(true);
    store.getState().setRememberMode(false);
    store.getState().completeOnboarding();

    expect(store.getState()).toMatchObject({
      mode: "workbench", persona: "momo", personaCardId: "work", talkStyle: 1,
      defaultProviderId: "alpha", defaultModelId: "model-1", permissionMode: "plan",
      providerOrder: ["alpha", "beta"],
      dangerousCommandCaching: true, webEnabled: true, webSearchEnabled: true,
      webFetchEnabled: true, rememberMode: false, onboardingCompleted: true,
    });
    expect(pickPersistedSettings(store.getState()).onboardingCompleted).toBe(true);
    expect(store.getState().personaCards).toBe(originalCards);
  });

  it("rejects invalid runtime values without corrupting state", () => {
    const store = createSettingsStore();
    const before = store.getState();
    (before.setTalkStyle as unknown as (value: number) => void)(9);
    (before.setMode as unknown as (value: string) => void)("unsafe");
    (before.setPermissionMode as unknown as (value: string) => void)("admin");
    before.setPersonaCard("missing");

    expect(store.getState()).toMatchObject({ mode: "buddy", talkStyle: 3, permissionMode: "acceptEdits", personaCardId: "momo" });
  });

  it("supports changing only the model while retaining provider", () => {
    const store = createSettingsStore({ defaultProviderId: "alpha", defaultModelId: "old" });
    store.getState().setDefaultModel("new");
    expect(store.getState()).toMatchObject({ defaultProviderId: "alpha", defaultModelId: "new" });
  });

  it("cleans provider priority by trimming, deduplicating, dropping non-strings, and capping at 100", () => {
    const store = createSettingsStore();
    const noisy = [" beta ", "", "alpha", "beta", 7, ...Array.from({ length: 120 }, (_, i) => `p-${i}`)];
    (store.getState().setProviderOrder as unknown as (ids: unknown[]) => void)(noisy);

    expect(store.getState().providerOrder.slice(0, 3)).toEqual(["beta", "alpha", "p-0"]);
    expect(store.getState().providerOrder).toHaveLength(100);
    expect(store.getState().defaultProviderId).toBe("beta");
  });

  it("creates, edits, and removes user persona cards without allowing builtin deletion", () => {
    const store = createSettingsStore();
    const id = store.getState().upsertPersonaCard({
      name: "理性搭档",
      tagline: "先核实，再行动",
      promptText: "先给出判断，再把用户交代的事完整做完。",
    });

    expect(id).toBe("custom-1");
    expect(store.getState().personaCardId).toBe("custom-1");
    expect(store.getState().personaCards).toContainEqual({
      id: "custom-1",
      name: "理性搭档",
      tagline: "先核实，再行动",
      promptText: "先给出判断，再把用户交代的事完整做完。",
      builtin: false,
    });

    expect(store.getState().upsertPersonaCard({
      id: "custom-1",
      name: "理性参谋",
      tagline: "证据优先",
      promptText: "保持清醒判断，并忠实执行用户任务。",
    })).toBe("custom-1");
    expect(store.getState().personaCards.find((card) => card.id === "custom-1")?.name).toBe("理性参谋");

    store.getState().deletePersonaCard("momo");
    expect(store.getState().personaCards).toContainEqual(defaultCard);

    store.getState().deletePersonaCard("custom-1");
    expect(store.getState().personaCards.some((card) => card.id === "custom-1")).toBe(false);
    expect(store.getState().personaCardId).toBe("momo");
  });
});

// 用户 7/27 拍板的三层结构：统筹「联网功能」+ 二级 WebSearch + 二级 WebFetch。
// 统筹关 = 两个都关；统筹开 = 二级各自独立控制。
describe("联网三层开关", () => {
  it("统筹关 ⇒ 两个能力都不生效，不管二级开关是什么", () => {
    for (const [search, fetch] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      const s = { webEnabled: false, webSearchEnabled: search, webFetchEnabled: fetch };
      expect(webSearchActive(s)).toBe(false);
      expect(webFetchActive(s)).toBe(false);
    }
  });

  it("统筹开 ⇒ 二级独立控制，四种组合各不相同", () => {
    const active = (search: boolean, fetch: boolean) => {
      const s = { webEnabled: true, webSearchEnabled: search, webFetchEnabled: fetch };
      return [webSearchActive(s), webFetchActive(s)];
    };
    expect(active(true, true)).toEqual([true, true]);
    expect(active(true, false)).toEqual([true, false]);
    expect(active(false, true)).toEqual([false, true]);
    expect(active(false, false)).toEqual([false, false]);
  });

  it("统筹开关只是掩码 —— 关掉再打开，用户那两个二级选择原样回来", () => {
    const store = createSettingsStore({ webEnabled: true });
    // 用户只想要抓取、不想要搜索。
    store.getState().setWebSearchEnabled(false);
    store.getState().setWebFetchEnabled(true);

    store.getState().setWebEnabled(false);
    // 掩掉了，但没被清掉。
    expect(webSearchActive(store.getState())).toBe(false);
    expect(webFetchActive(store.getState())).toBe(false);
    expect(store.getState().webSearchEnabled).toBe(false);
    expect(store.getState().webFetchEnabled).toBe(true);

    store.getState().setWebEnabled(true);
    // 回来的是用户自己那套，不是"全开"。
    expect(webSearchActive(store.getState())).toBe(false);
    expect(webFetchActive(store.getState())).toBe(true);
  });

  it("三个 setter 都拒非布尔值，不污染状态", () => {
    const store = createSettingsStore({ webEnabled: true, webSearchEnabled: true, webFetchEnabled: true });
    const bad = (fn: unknown) => (fn as (v: unknown) => void)("yes");
    bad(store.getState().setWebEnabled);
    bad(store.getState().setWebSearchEnabled);
    bad(store.getState().setWebFetchEnabled);
    expect(store.getState()).toMatchObject({ webEnabled: true, webSearchEnabled: true, webFetchEnabled: true });
  });
});

// ── 轮 7 A3: hydrate ────────────────────────────────────────────────────────
//
// 持久化的值是"可能来自旧版/新版构建的数据"，按不可信输入对待（同 IPC payload
// 的 fail-closed 姿态）：逐字段校验，坏值丢弃保默认，绝不因为一个字段坏掉而让
// 整次 hydrate 失败 —— 丢一个偏好可以，丢全部不行。
describe("settings hydrate (轮 7 A3)", () => {
  it("恢复用户存过的每一个字段", () => {
    const store = createSettingsStore();
    store.getState().hydrate({
      mode: "workbench",
      talkStyle: 1,
      permissionMode: "bypassPermissions",
      dangerousCommandCaching: true,
      webEnabled: true,
      webSearchEnabled: false,
      webFetchEnabled: true,
      rememberMode: false,
      defaultProviderId: "glm",
      defaultModelId: "glm-5.2",
      providerOrder: ["glm", "deepseek"],
      onboardingCompleted: true,
    });
    expect(store.getState()).toMatchObject({
      mode: "workbench",
      talkStyle: 1,
      permissionMode: "bypassPermissions",
      dangerousCommandCaching: true,
      webEnabled: true,
      webSearchEnabled: false,
      webFetchEnabled: true,
      rememberMode: false,
      defaultProviderId: "glm",
      defaultModelId: "glm-5.2",
      providerOrder: ["glm", "deepseek"],
      onboardingCompleted: true,
    });
  });

  it("坏值逐个丢弃，其余字段照常恢复", () => {
    const store = createSettingsStore();
    store.getState().hydrate({
      webEnabled: "true",            // 字符串不是布尔
      talkStyle: 9,                  // 不在 1|2|3
      permissionMode: "whatever",    // 不是合法档
      mode: "workbench",             // ← 这个是好的
    });
    const s = store.getState();
    expect(s.webEnabled).toBe(false);            // 保默认
    expect(s.talkStyle).toBe(3);                 // 保默认
    expect(s.permissionMode).toBe("acceptEdits");// 保默认
    expect(s.mode).toBe("workbench");            // 好字段仍生效
  });

  it("拒绝本构建里不存在的人设卡 id（防悬空 id 导致空人格）", () => {
    const store = createSettingsStore();
    store.getState().hydrate({ personaCardId: "某个已被删掉的卡" });
    expect(store.getState().personaCardId).toBe("momo");
  });

  it("只持久化用户自建人设，并能在启动时先恢复卡片再恢复选中项", () => {
    const store = createSettingsStore();
    store.getState().hydrate({
      userPersonaCards: [{
        id: "custom-7",
        name: "求职教练",
        tagline: "直接但不替你做主",
        promptText: "指出问题，然后协助用户把求职任务做完。",
        builtin: true,
      }],
      personaCardId: "custom-7",
    });

    expect(store.getState().personaCardId).toBe("custom-7");
    expect(store.getState().personaCards).toContainEqual(expect.objectContaining({
      id: "custom-7",
      name: "求职教练",
      builtin: false,
    }));
    expect(pickPersistedSettings(store.getState()).userPersonaCards).toEqual([
      expect.objectContaining({ id: "custom-7", builtin: false }),
    ]);
    expect(JSON.stringify(pickPersistedSettings(store.getState()).userPersonaCards)).not.toContain('"builtin":true');
  });

  it("persists stable skill ids and drops malformed overrides", () => {
    const store = createSettingsStore();
    store.getState().setSkillOverride("pdf-deep-reading", false);
    expect(store.getState().skillOverrides).toEqual({ "pdf-deep-reading": false });
    expect(pickPersistedSettings(store.getState()).skillOverrides).toEqual({ "pdf-deep-reading": false });

    store.getState().hydrate({
      skillOverrides: {
        "daily-plan": false,
        "bad value": true,
        "too-many": "false",
        ["x".repeat(200)]: false,
      },
    });
    expect(store.getState().skillOverrides).toEqual({ "daily-plan": false });
  });

  it("null 的默认模型是有意义的值（=未设置），要收下", () => {
    const store = createSettingsStore({ defaultModelId: "glm-5.2" });
    store.getState().hydrate({ defaultModelId: null });
    expect(store.getState().defaultModelId).toBeNull();
  });

  it("逐项清洗持久化的 providerOrder，坏数组不覆盖已有顺序", () => {
    const store = createSettingsStore({ providerOrder: ["initial"] });
    store.getState().hydrate({ providerOrder: [" b ", "a", "b", null, 3, ""] });
    expect(store.getState().providerOrder).toEqual(["b", "a"]);

    store.getState().hydrate({ providerOrder: "not-an-array" });
    expect(store.getState().providerOrder).toEqual(["b", "a"]);
  });

  it("整个 payload 不是对象时安全返回，不抛", () => {
    const store = createSettingsStore();
    expect(() => store.getState().hydrate(null as never)).not.toThrow();
    expect(() => store.getState().hydrate("nope" as never)).not.toThrow();
    expect(store.getState().talkStyle).toBe(3);
  });

  it("pickPersistedSettings 只投影声明过的键", () => {
    const store = createSettingsStore({ providerOrder: ["alpha"] });
    const picked = pickPersistedSettings(store.getState());
    expect(Object.keys(picked).sort()).toEqual([...PERSISTED_SETTING_KEYS].sort());
    (picked.providerOrder as string[]).push("external-mutation");
    expect(store.getState().providerOrder).toEqual(["alpha"]);
  });
});
