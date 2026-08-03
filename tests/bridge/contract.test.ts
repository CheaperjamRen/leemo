import { describe, it, expect } from "vitest";
import {
  BRIDGE_CHANNELS,
  KNOWN_PROVIDER_KINDS,
  type ProviderSpec,
  type ProviderAuthMode,
  type ProviderKind,
  type ProviderCapabilities,
  type PermissionMode,
  type PermissionPolicy,
  type UsageSummary,
  type UsageSummaryQuery,
  type BridgeInvokeMap,
  type BridgeEventMap,
  type BridgeEventEnvelope,
  type CreateConversationRequest,
  type SendRequest,
  type ConversationRef,
} from "../../src/bridge/contract";

// B3 — contract freeze guards. contract.ts is (almost) all TYPES, erased at
// runtime, so these tests do two things a type-only module CAN assert at
// runtime: (1) exercise the runtime constants, and (2) construct typed object
// literals — which only compile if the mandated extensibility axes truly exist
// as type fields (not just prose in the 09 doc). If an axis were removed, this
// file would fail `npm run typecheck`, not just the suite.

describe("contract — extensibility axes exist in real types (not just prose)", () => {
  it("ProviderSpec carries authMode / kind / apiFormat / capabilities as real fields", () => {
    // An OAuth-subscription, CUSTOM-kind provider with quota (no balance API) —
    // the exact future shape user 7/21 called out. This ONLY compiles if every
    // axis is a real field.
    const oauthCustom: ProviderSpec = {
      id: "my-claude-max",
      name: "My Claude Max Sub",
      kind: "custom", // open string, not a closed union
      category: "custom",
      apiFormat: "anthropic",
      authMode: "oauth-subscription", // reserved axis, real field
      baseUrl: "https://example.invalid",
      models: ["some-model"],
      capabilities: {
        balanceApi: false,
        modelDiscovery: true,
        subscriptionPlan: true, // quota not balance
      },
    };
    expect(oauthCustom.authMode).toBe("oauth-subscription");
    expect(oauthCustom.capabilities.subscriptionPlan).toBe(true);
    expect(oauthCustom.capabilities.balanceApi).toBe(false);

    // A first-release api-key provider (the only authMode actually implemented).
    const apiKeyProvider: ProviderSpec = {
      id: "deepseek",
      name: "DeepSeek",
      kind: "deepseek",
      category: "cn_official",
      apiFormat: "anthropic",
      authMode: "api-key",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyUrl: "https://platform.deepseek.com",
      models: ["deepseek-chat"],
      capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
    };
    expect(apiKeyProvider.authMode).toBe("api-key");
  });

  it("ProviderKind is an OPEN string — an unknown/custom family needs no contract change", () => {
    // A brand-new family string not in KNOWN_PROVIDER_KINDS still typechecks.
    const novelKind: ProviderKind = "some-provider-invented-next-year";
    const known: ProviderKind = KNOWN_PROVIDER_KINDS[0];
    expect(typeof novelKind).toBe("string");
    expect(KNOWN_PROVIDER_KINDS).toContain(known);
    // Reference set is non-exhaustive but includes custom as first-class.
    expect(KNOWN_PROVIDER_KINDS).toContain("custom");
  });

  it("capabilities is the dispatch axis (declared), never an id→capability map", () => {
    const caps: ProviderCapabilities = {
      balanceApi: true,
      modelDiscovery: true,
      subscriptionPlan: false,
    };
    // The point: balance support is read off caps.balanceApi, NOT off the id.
    expect(caps.balanceApi).toBe(true);
  });

  it("authMode union includes the local no-key value ('none') plus the two reserved axes", () => {
    // 07/21 revision widened the union with 'none' (local models: Ollama / LM
    // Studio need no key). Still asserts every reserved axis is present.
    const a: ProviderAuthMode = "api-key";
    const b: ProviderAuthMode = "oauth-subscription";
    const c: ProviderAuthMode = "none";
    expect([a, b, c]).toEqual(["api-key", "oauth-subscription", "none"]);
  });
});

describe("contract — policy-driven approval types (07/21 B3 revision)", () => {
  it("PermissionMode carries the four Claude-Code-aligned modes incl. bypassPermissions", () => {
    const modes: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions", "plan"];
    expect(modes).toContain("bypassPermissions");
    expect(modes).toContain("plan");
    expect(modes.length).toBe(4);
  });

  it("PermissionPolicy pairs a mode with the dangerousCommandCaching toggle", () => {
    const safe: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: false };
    const loose: PermissionPolicy = { mode: "bypassPermissions", dangerousCommandCaching: true };
    expect(safe.dangerousCommandCaching).toBe(false);
    expect(loose.mode).toBe("bypassPermissions");
    expect(loose.dangerousCommandCaching).toBe(true);
  });

  it("CreateConversationRequest accepts an OPTIONAL permissionMode override", () => {
    const base: CreateConversationRequest = { providerId: "deepseek", modelId: "deepseek-chat" };
    const overridden: CreateConversationRequest = {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      permissionMode: "bypassPermissions",
    };
    expect(base.permissionMode).toBeUndefined();
    expect(overridden.permissionMode).toBe("bypassPermissions");
  });

  it("CreateConversationRequest accepts OPTIONAL momo persona context (轮2卡A)", () => {
    // Additive-only, per the Batch -1 precedent: every field is optional, so
    // existing callers (wiki popup, fixtures, tests) keep compiling untouched.
    const bare: CreateConversationRequest = { providerId: "deepseek", modelId: "deepseek-chat" };
    const withPersona: CreateConversationRequest = {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      mode: "buddy",
      personaText: "你是 momo。",
      talkStyle: 2,
      webSearchEnabled: false,
    };
    expect(bare.personaText).toBeUndefined();
    expect(bare.mode).toBeUndefined();
    expect(withPersona.mode).toBe("buddy");
    expect(withPersona.talkStyle).toBe(2);
    expect(withPersona.webSearchEnabled).toBe(false);
    // personaText carries the RESOLVED card body, never a card id: the host has
    // no persona-card registry, so an id would be unresolvable there.
    expect(withPersona.personaText).toContain("momo");
  });

  it("CreateConversationRequest accepts OPTIONAL conversationId + resumeSessionId (轮2卡C)", () => {
    // Restart continuity: the renderer re-claims a persisted conversation id
    // (host Maps are memory-only) and hands back the persisted session id as
    // the resume start point. Both optional — an ordinary create omits them.
    const fresh: CreateConversationRequest = { providerId: "deepseek", modelId: "deepseek-chat" };
    const reclaimed: CreateConversationRequest = {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      conversationId: "cid-from-sqlite",
      resumeSessionId: "sess-from-sqlite",
    };
    expect(fresh.conversationId).toBeUndefined();
    expect(fresh.resumeSessionId).toBeUndefined();
    expect(reclaimed.conversationId).toBe("cid-from-sqlite");
    expect(reclaimed.resumeSessionId).toBe("sess-from-sqlite");
  });

  it("SendRequest carries an optional renderer message id for memory provenance", () => {
    const legacy: SendRequest = { conversationId: "c-1", prompt: "继续" };
    const traced: SendRequest = {
      conversationId: "c-1",
      prompt: "记住我偏好先给结论",
      sourceMessageId: "u7",
    };
    expect(legacy.sourceMessageId).toBeUndefined();
    expect(traced.sourceMessageId).toBe("u7");
  });

  it("CreateConversationRequest constrains mode and talkStyle to their unions", () => {
    // @ts-expect-error mode is the closed 搭子/工作台 pair.
    const badMode: CreateConversationRequest = { providerId: "d", modelId: "m", mode: "kiosk" };
    // @ts-expect-error talkStyle is the three-stop slider (1|2|3).
    const badStyle: CreateConversationRequest = { providerId: "d", modelId: "m", talkStyle: 4 };
    expect(badMode.mode).toBe("kiosk");
    expect(badStyle.talkStyle).toBe(4);
  });

  it("CreateConversationRequest accepts main/wiki purpose metadata only", () => {
    const main: CreateConversationRequest = {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      purpose: "main",
    };
    const wiki: CreateConversationRequest = {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      purpose: "wiki",
    };
    // @ts-expect-error purpose is a closed two-value metadata field.
    const invalid: CreateConversationRequest = { providerId: "deepseek", modelId: "deepseek-chat", purpose: "other" };
    expect(main.purpose).toBe("main");
    expect(wiki.purpose).toBe("wiki");
    expect(invalid).toBeDefined();
  });
});

describe("contract — local no-key provider + NewMax capability axes (07/21)", () => {
  it("authMode 'none' + capabilities.local typecheck for a local provider (Ollama)", () => {
    // The exact local-model shape user 7/21 called out: no key, points at a
    // loopback endpoint. ONLY compiles if 'none' and `local` are real fields.
    const ollama: ProviderSpec = {
      id: "ollama-local",
      name: "Ollama (local)",
      kind: "custom",
      category: "custom",
      apiFormat: "openai",
      authMode: "none",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: ["llama3.1"],
      capabilities: {
        balanceApi: false,
        modelDiscovery: true,
        subscriptionPlan: false,
        local: true,
      },
    };
    expect(ollama.authMode).toBe("none");
    expect(ollama.capabilities.local).toBe(true);
  });

  it("ProviderCapabilities NewMax-parity axes are real optional fields", () => {
    const caps: ProviderCapabilities = {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      local: true,
      protocolSwitchable: true,
      multiKey: true,
      requiresProxy: true,
    };
    expect(caps.protocolSwitchable).toBe(true);
    expect(caps.multiKey).toBe(true);
    expect(caps.requiresProxy).toBe(true);
    // All optional — a minimal capabilities object (no NewMax axes) still valid.
    const minimal: ProviderCapabilities = {
      balanceApi: true,
      modelDiscovery: false,
      subscriptionPlan: false,
    };
    expect(minimal.local).toBeUndefined();
  });
});

describe("contract — reserved Phase-1 usage-summary types are usable now", () => {
  it("UsageSummaryQuery + UsageSummary construct (contract occupies the slot pre-impl)", () => {
    const q: UsageSummaryQuery = { range: "last7d", providerId: "deepseek" };
    const s: UsageSummary = {
      totalCostUsd: "1.234560",
      byProvider: [{ providerId: "deepseek", costUsd: "1.234560", inputTokens: 100, outputTokens: 50 }],
      byDay: [{ date: "2026-07-21", costUsd: "1.234560" }],
    };
    expect(q.range).toBe("last7d");
    expect(s.byProvider[0].providerId).toBe("deepseek");
  });
});

describe("contract — channel table is frozen + payload types correspond 1:1", () => {
  it("BRIDGE_CHANNELS values are the bridge: namespaced strings", () => {
    expect(BRIDGE_CHANNELS.createConversation).toBe("bridge:createConversation");
    expect(BRIDGE_CHANNELS.event).toBe("bridge:event");
    expect(BRIDGE_CHANNELS.approvalRequest).toBe("bridge:approvalRequest");
    expect(BRIDGE_CHANNELS.askUser).toBe("bridge:askUser");
    expect(BRIDGE_CHANNELS.usageSummary).toBe("bridge:usageSummary");
    expect(BRIDGE_CHANNELS.listWhitelist).toBe("bridge:listWhitelist");
    expect(BRIDGE_CHANNELS.revokeWhitelist).toBe("bridge:revokeWhitelist");
    expect(BRIDGE_CHANNELS.listMemory).toBe("bridge:listMemory");
    expect(BRIDGE_CHANNELS.undoMemory).toBe("bridge:undoMemory");
    expect(BRIDGE_CHANNELS.pickSkillSource).toBe("bridge:pickSkillSource");
  });

  it("every BRIDGE_CHANNELS value is a key in exactly one of the invoke/event maps", () => {
    // Runtime mirror of the invoke/event key sets (kept in lockstep with the
    // typed BridgeInvokeMap/BridgeEventMap — a missing entry here would be an
    // obvious drift signal in review).
    const invokeKeys = new Set<keyof BridgeInvokeMap>([
      "bridge:createConversation",
      "bridge:send",
      "bridge:interrupt",
      "bridge:setModel",
      "bridge:updateContext",
      "bridge:disposeConversation",
      "bridge:listProviders",
      "bridge:fetchBalance",
      "bridge:usageSummary",
      "bridge:listWhitelist",
      "bridge:revokeWhitelist",
      "bridge:approvalDecision",
      "bridge:askUserAnswer",
      // 轮 2 卡 E
      "bridge:listSkills",
      "bridge:openSkillsDir",
      "bridge:syncEnabledSkills",
      "bridge:inspectSkillSource",
      "bridge:pickSkillSource",
      "bridge:installSkill",
      "bridge:listCommunitySkills",
      "bridge:installCommunitySkill",
      "bridge:scanInstalledSkill",
      "bridge:removeSkill",
      // 轮 10 — governed memory management
      "bridge:listMemory",
      "bridge:updateMemory",
      "bridge:deleteMemory",
      "bridge:pinMemory",
      "bridge:memoryHistory",
      "bridge:undoMemory",
      "bridge:openMemoryDir",
      // 轮 4 卡 H — 搜索源 key
      "bridge:getSearchSources",
      "bridge:saveSearchKey",
      "bridge:searchAcademic",
      // 轮 7 — MCP + built-in browser
      "bridge:listMcpServers",
      "bridge:saveMcpServer",
      "bridge:deleteMcpServer",
      "bridge:testMcpServer",
      "bridge:readBrowserCapture",
      // 轮 3 卡 F — provider configuration
      "bridge:getProviderConfig",
      "bridge:saveProvider",
      "bridge:deleteProvider",
      "bridge:testConnection",
      "bridge:listRemoteModels",
    ]);
    const eventKeys = new Set<keyof BridgeEventMap>([
      "bridge:event",
      "bridge:approvalRequest",
      "bridge:askUser",
    ]);

    for (const value of Object.values(BRIDGE_CHANNELS)) {
      const inInvoke = invokeKeys.has(value as keyof BridgeInvokeMap);
      const inEvent = eventKeys.has(value as keyof BridgeEventMap);
      // Exactly one of the two (XOR): no channel is both, none is neither.
      expect(inInvoke !== inEvent).toBe(true);
    }
    // And the count matches (no map key without a channel constant).
    expect(invokeKeys.size + eventKeys.size).toBe(Object.keys(BRIDGE_CHANNELS).length);
  });

  it("IPC request projections reference providers by id (no key crosses)", () => {
    const req: CreateConversationRequest = { providerId: "deepseek", modelId: "deepseek-chat" };
    const ref: ConversationRef = { conversationId: "c-123" };
    expect(req.providerId).toBe("deepseek");
    expect(ref.conversationId).toBe("c-123");
    // CreateConversationRequest has no `apiKey` field — enforced structurally by
    // the type; asserted here for the reader.
    expect("apiKey" in req).toBe(false);
  });

  it("envelopes bridge:event once while keeping LeemoEvent semantic payloads bare", () => {
    const envelope: BridgeEventEnvelope = {
      conversationId: "conv-1",
      event: { type: "text.delta", text: "hello" },
    };
    const payload: BridgeEventMap["bridge:event"] = envelope;
    // @ts-expect-error bridge:event no longer accepts a naked LeemoEvent.
    const legacyPayload: BridgeEventMap["bridge:event"] = { type: "text.delta", text: "hello" };
    expect(payload.conversationId).toBe("conv-1");
    expect(payload.event).toEqual({ type: "text.delta", text: "hello" });
    expect(legacyPayload).toBeDefined();
  });

  it("adds whitelist list/revoke mappings with the existing RiskLevel", () => {
    const listRequest: BridgeInvokeMap["bridge:listWhitelist"]["request"] = undefined;
    const listResponse: BridgeInvokeMap["bridge:listWhitelist"]["response"] = [
      { toolName: "Bash", risk: "dangerous" },
    ];
    const revokeRequest: BridgeInvokeMap["bridge:revokeWhitelist"]["request"] = {
      toolName: "Bash",
      risk: "dangerous",
    };
    const revokeResponse: BridgeInvokeMap["bridge:revokeWhitelist"]["response"] = undefined;
    expect(listRequest).toBeUndefined();
    expect(listResponse).toEqual([{ toolName: "Bash", risk: "dangerous" }]);
    expect(revokeRequest).toEqual({ toolName: "Bash", risk: "dangerous" });
    expect(revokeResponse).toBeUndefined();
  });
});
