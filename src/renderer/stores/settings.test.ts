import { describe, expect, it } from "vitest";
import {
  buildGreeting,
  createSettingsStore,
  pickPersistedSettings,
  resolveMomoPersonaText,
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
    expect(state.surface).toBe("start");
    expect(state.mode).toBe("buddy");
    expect(state.persona).toBe("momo");
    expect(state.personaCardId).toBe("momo");
    expect(state.personaCards).toContainEqual(defaultCard);
    expect(state.personaCards).toContainEqual(expect.objectContaining({ id: "momo-entp", builtin: true }));
    expect(state.relationshipStyle).toBe("companion");
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
    expect(state.keepAwakeDuringTasks).toBe(true);
    expect(state.desktopNotifications).toBe(true);
    expect(state.taskModelParsingEnabled).toBe(true);
    expect(state.launchAtLogin).toBe(false);
    expect(state.continueInBackground).toBe(true);
    expect(state.quickCaptureShortcut).toBe("Alt+N");
    expect(state.skillOverrides).toEqual({});
    expect(state.onboardingCompleted).toBe(false);
    expect(state.relationshipInviteDismissed).toBe(false);
    expect(state.relationshipConversationId).toBeNull();
    expect(typeof state.dataDir).toBe("string");
    expect(JSON.stringify(state)).not.toMatch(/apiKey|token|secret/i);
  });

  it("updates each setting through explicit immutable actions", () => {
    const store = createSettingsStore({ personaCards: [defaultCard, { ...defaultCard, id: "work", name: "Work", builtin: false }] });
    const originalCards = store.getState().personaCards;
    store.getState().setMode("workbench");
    store.getState().setPersonaCard("work");
    store.getState().setRelationshipStyle("mentor");
    store.getState().setTalkStyle(1);
    store.getState().setDefaultModel("alpha", "model-1");
    store.getState().setProviderOrder(["alpha", "beta"]);
    store.getState().setPermissionMode("plan");
    store.getState().setDangerousCommandCaching(true);
    store.getState().setWebEnabled(true);
    store.getState().setWebSearchEnabled(true);
    store.getState().setWebFetchEnabled(true);
    store.getState().setRememberMode(false);
    store.getState().setKeepAwakeDuringTasks(false);
    store.getState().setDesktopNotifications(false);
    store.getState().setTaskModelParsingEnabled(false);
    store.getState().setLaunchAtLogin(true);
    store.getState().setContinueInBackground(false);
    store.getState().setQuickCaptureShortcut("Ctrl+Shift+N");
    store.getState().completeOnboarding();
    store.getState().dismissRelationshipInvite();
    store.getState().setRelationshipConversationId("relationship-conv");

    expect(store.getState()).toMatchObject({
      mode: "workbench", persona: "momo", personaCardId: "work", talkStyle: 1,
      relationshipStyle: "mentor",
      defaultProviderId: "alpha", defaultModelId: "model-1", permissionMode: "plan",
      providerOrder: ["alpha", "beta"],
      dangerousCommandCaching: true, webEnabled: true, webSearchEnabled: true,
      webFetchEnabled: true, rememberMode: false, keepAwakeDuringTasks: false, desktopNotifications: false, launchAtLogin: true,
      taskModelParsingEnabled: false,
      continueInBackground: false, quickCaptureShortcut: "Ctrl+Shift+N", onboardingCompleted: true,
      relationshipInviteDismissed: true, relationshipConversationId: "relationship-conv",
    });
    expect(pickPersistedSettings(store.getState()).onboardingCompleted).toBe(true);
    expect(store.getState().personaCards).toBe(originalCards);
    expect(pickPersistedSettings(store.getState()).relationshipStyle).toBe("mentor");
  });

  it("rejects invalid runtime values without corrupting state", () => {
    const store = createSettingsStore();
    const before = store.getState();
    (before.setTalkStyle as unknown as (value: number) => void)(9);
    (before.setMode as unknown as (value: string) => void)("unsafe");
    (before.setPermissionMode as unknown as (value: string) => void)("admin");
    before.setPersonaCard("missing");
    (before.setRelationshipStyle as unknown as (value: string) => void)("manager");

    expect(store.getState()).toMatchObject({ mode: "buddy", talkStyle: 3, permissionMode: "acceptEdits", personaCardId: "momo", relationshipStyle: "companion" });
  });

  it("composes a selected flavor and relationship without exposing internal ids", () => {
    const card = createSettingsStore().getState().personaCards.find((candidate) => candidate.id === "momo-entp");
    const text = resolveMomoPersonaText(card?.promptText ?? "", "mentor");
    expect(text).toContain("ENTP 风味");
    expect(text).toContain("导师");
    expect(text).not.toContain("relationshipStyle");
  });

  it("supports changing only the model while retaining provider", () => {
    const store = createSettingsStore({ defaultProviderId: "alpha", defaultModelId: "old" });
    store.getState().setDefaultModel("new");
    expect(store.getState()).toMatchObject({ defaultProviderId: "alpha", defaultModelId: "new" });
  });

  it("persists the lightweight relationship invitation and validates its conversation id", () => {
    const store = createSettingsStore();
    store.getState().dismissRelationshipInvite();
    store.getState().setRelationshipConversationId("  conv-meet-momo  ");

    expect(store.getState()).toMatchObject({
      relationshipInviteDismissed: true,
      relationshipConversationId: "conv-meet-momo",
    });
    expect(pickPersistedSettings(store.getState())).toMatchObject({
      relationshipInviteDismissed: true,
      relationshipConversationId: "conv-meet-momo",
    });

    store.getState().setRelationshipConversationId("bad\nvalue");
    expect(store.getState().relationshipConversationId).toBe("conv-meet-momo");
    store.getState().setRelationshipConversationId(null);
    expect(store.getState().relationshipConversationId).toBeNull();
  });

  it("persists background mode and only accepts plausible global accelerators", () => {
    const store = createSettingsStore();
    store.getState().hydrate({ continueInBackground: false, quickCaptureShortcut: "  Ctrl+Alt+J  " });
    expect(store.getState()).toMatchObject({
      continueInBackground: false,
      quickCaptureShortcut: "Ctrl+Alt+J",
    });
    expect(pickPersistedSettings(store.getState())).toMatchObject({
      continueInBackground: false,
      quickCaptureShortcut: "Ctrl+Alt+J",
    });

    store.getState().setQuickCaptureShortcut("N");
    expect(store.getState().quickCaptureShortcut).toBe("Ctrl+Alt+J");
    store.getState().hydrate({ quickCaptureShortcut: "not a shortcut" });
    expect(store.getState().quickCaptureShortcut).toBe("Ctrl+Alt+J");
  });

  it("persists the opt-out for model-assisted task time parsing", () => {
    const store = createSettingsStore();
    store.getState().setTaskModelParsingEnabled(false);
    expect(pickPersistedSettings(store.getState()).taskModelParsingEnabled).toBe(false);

    const restored = createSettingsStore();
    restored.getState().hydrate({ taskModelParsingEnabled: false });
    expect(restored.getState().taskModelParsingEnabled).toBe(false);
  });

  it("keeps daily global overview automation opt-in and validates its local time", () => {
    const store = createSettingsStore();
    expect(store.getState()).toMatchObject({
      globalOverviewAutoEnabled: false,
      globalOverviewAutoTime: "09:00",
    });

    store.getState().setGlobalOverviewAutoEnabled(true);
    store.getState().setGlobalOverviewAutoTime("18:30");
    expect(pickPersistedSettings(store.getState())).toMatchObject({
      globalOverviewAutoEnabled: true,
      globalOverviewAutoTime: "18:30",
    });

    const restored = createSettingsStore();
    restored.getState().hydrate({ globalOverviewAutoEnabled: true, globalOverviewAutoTime: "99:88" });
    expect(restored.getState()).toMatchObject({
      globalOverviewAutoEnabled: true,
      globalOverviewAutoTime: "09:00",
    });
  });

  it("persists a distinct Start surface without widening the Agent runtime mode", () => {
    const store = createSettingsStore({ mode: "workbench" });
    store.getState().setSurface("start");
    expect(store.getState()).toMatchObject({ surface: "start", mode: "workbench" });
    expect(pickPersistedSettings(store.getState())).toMatchObject({ surface: "start", mode: "workbench" });

    store.getState().setSurface("buddy");
    expect(store.getState()).toMatchObject({ surface: "buddy", mode: "buddy" });

    const legacy = createSettingsStore();
    legacy.getState().hydrate({ mode: "workbench" });
    expect(legacy.getState()).toMatchObject({ surface: "workbench", mode: "workbench" });
  });

  it("keeps file storage unset until the user chooses it and persists the future file-drop preference", () => {
    const store = createSettingsStore();
    expect(store.getState()).toMatchObject({
      captureStorageRoot: undefined,
      captureFileDropMode: "reference",
    });

    store.getState().hydrate({
      captureStorageRoot: "  E:/Leemo files  ",
      captureFileDropMode: "copy",
    });
    expect(pickPersistedSettings(store.getState())).toMatchObject({
      captureStorageRoot: "E:/Leemo files",
      captureFileDropMode: "copy",
    });
  });

  it("persists the user-selected default workspace without accepting arbitrary ids", () => {
    const store = createSettingsStore();
    expect(store.getState().defaultWorkspaceId).toBe("leemo-home");

    store.getState().setDefaultWorkspaceId("workspace-0123456789abcdef0123");
    expect(pickPersistedSettings(store.getState()).defaultWorkspaceId).toBe("workspace-0123456789abcdef0123");

    store.getState().setDefaultWorkspaceId("C:/not-an-id");
    expect(store.getState().defaultWorkspaceId).toBe("workspace-0123456789abcdef0123");

    const restored = createSettingsStore();
    restored.getState().hydrate({ defaultWorkspaceId: "workspace-fedcba9876543210abcd" });
    expect(restored.getState().defaultWorkspaceId).toBe("workspace-fedcba9876543210abcd");
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
      keepAwakeDuringTasks: false,
      defaultProviderId: "glm",
      defaultModelId: "glm-5.2",
      providerOrder: ["glm", "deepseek"],
      onboardingCompleted: true,
      relationshipInviteDismissed: true,
      relationshipConversationId: "conv-relationship",
      relationshipStyle: "senior",
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
      keepAwakeDuringTasks: false,
      defaultProviderId: "glm",
      defaultModelId: "glm-5.2",
      providerOrder: ["glm", "deepseek"],
      onboardingCompleted: true,
      relationshipInviteDismissed: true,
      relationshipConversationId: "conv-relationship",
      relationshipStyle: "senior",
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

  it("丢弃损坏的关系仪式状态，避免重启后指向不存在的控制字符 id", () => {
    const store = createSettingsStore();
    store.getState().hydrate({
      relationshipInviteDismissed: "yes",
      relationshipConversationId: "bad\nvalue",
      mode: "workbench",
    });

    expect(store.getState()).toMatchObject({
      relationshipInviteDismissed: false,
      relationshipConversationId: null,
      mode: "workbench",
    });
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
