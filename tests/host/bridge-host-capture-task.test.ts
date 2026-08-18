import { describe, expect, it, vi } from "vitest";
import { createBridgeHost } from "../../src/host/bridge-host";
import type { CaptureAdminService } from "../../src/main/capture-admin";
import type { TaskAdminService } from "../../src/main/task-admin";
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

describe("bridge-host notes and tasks", () => {
  it("registers momo's workboard tools only when both main-process services exist", async () => {
    const captures: CaptureAdminService = {
      getQuickDraft: vi.fn(),
      saveQuickDraft: vi.fn(),
      commitQuickDraft: vi.fn(),
      listNotes: vi.fn(() => []),
      listArchivedNotes: vi.fn(() => []),
      getNote: vi.fn(() => null),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      moveNote: vi.fn(),
      setNotePinned: vi.fn(),
      markNoteOrganized: vi.fn(),
      archiveNote: vi.fn(),
      unarchiveNote: vi.fn(),
      deleteNote: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    const tasks: TaskAdminService = {
      listTasks: vi.fn(() => []),
      createTask: vi.fn(),
      createManyTasks: vi.fn(() => []),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
    };
    const host = createBridgeHost({
      catalog,
      dataDir: "C:\\data",
      workspaceRoot: "C:\\Leemo",
      captures,
      tasks,
      push: () => {},
    });

    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "demo",
      modelId: "demo",
      workspaceId: "leemo-home",
    });

    expect(host.inspect(created.conversationId)?.mcpServerNames).toContain("leemo-workboard");
    host.dispose();
  });
});
