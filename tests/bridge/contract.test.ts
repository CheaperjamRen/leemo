import { describe, it, expect } from "vitest";
import {
  BRIDGE_CHANNELS,
  KNOWN_PROVIDER_KINDS,
  type ProviderSpec,
  type ProviderAuthMode,
  type ProviderKind,
  type ProviderCapabilities,
  type UsageSummary,
  type UsageSummaryQuery,
  type BridgeInvokeMap,
  type BridgeEventMap,
  type CreateConversationRequest,
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

  it("authMode union is exactly the two reserved values", () => {
    const a: ProviderAuthMode = "api-key";
    const b: ProviderAuthMode = "oauth-subscription";
    expect([a, b]).toEqual(["api-key", "oauth-subscription"]);
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
      "bridge:disposeConversation",
      "bridge:listProviders",
      "bridge:fetchBalance",
      "bridge:usageSummary",
      "bridge:approvalDecision",
      "bridge:askUserAnswer",
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
});
