import { describe, expect, it, vi } from "vitest";
import { createBridgeHost } from "../../src/host/bridge-host";
import type { ScheduledTaskAdmin } from "../../src/bridge/scheduled-task-mcp";
import type { CatalogEntry } from "../../src/host/provider-catalog";

const catalog: CatalogEntry[] = [{
  executionEngine: "claude-agent-sdk",
  provider: {
    id: "demo",
    name: "Demo",
    category: "cn_official",
    apiFormat: "anthropic",
    baseUrl: "https://example.invalid",
    apiKey: "test",
    models: ["demo"],
    modelCapabilities: { demo: { thinking: false, vision: false } },
    envTemplate: {},
  },
  spec: {
    id: "demo",
    name: "Demo",
    kind: "custom",
    category: "cn_official",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://example.invalid",
    apiKeyUrl: "https://example.invalid",
    models: ["demo"],
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
  },
}];

describe("bridge-host scheduled tasks", () => {
  it("registers momo's scheduler tools only when the main-process service exists", async () => {
    const scheduledTasks: ScheduledTaskAdmin = {
      list: vi.fn(() => []),
      create: vi.fn(),
      update: vi.fn(),
      setPaused: vi.fn(),
      delete: vi.fn(),
      runNow: vi.fn(),
    };
    const host = createBridgeHost({
      catalog,
      dataDir: "C:\\data",
      workspaceRoot: "C:\\Leemo",
      scheduledTasks,
      push: () => {},
    });

    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo",
      modelId: "demo",
      workspaceId: "leemo-home",
    });

    expect(host.inspect(created.conversationId)?.mcpServerNames).toContain("leemo-scheduler");
    host.dispose();
  });
});
