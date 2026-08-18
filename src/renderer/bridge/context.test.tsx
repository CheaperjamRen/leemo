import { StrictMode, useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSpec } from "../../bridge/contract";
import type { BridgeClient } from "./client";
import { BridgeContext, BridgeProvider, type BridgeStores } from "./context";
import type { PersistenceClient, PersistedSnapshot } from "../persistence/client";
import type { WorkspaceClient } from "../workspace/client";
import { conversationComposerScope, workspaceComposerScope } from "../stores/composer-drafts";
import type { CaptureClient } from "../capture/client";
import type { CaptureChange, Note } from "../../captures";

const providers: ProviderSpec[] = [
  {
    id: "first-provider",
    name: "First",
    kind: "custom",
    category: "custom",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://first.invalid",
    models: ["shared-model"],
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
    configured: true,
  },
  {
    id: "chosen-provider",
    name: "Chosen",
    kind: "custom",
    category: "custom",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://chosen.invalid",
    models: ["shared-model", "chosen-model"],
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
    configured: true,
  },
];

function liveClient(skills: import("../../bridge/contract").SkillInfo[] = []): BridgeClient & { invoke: ReturnType<typeof vi.fn> } {
  let conversationSequence = 0;
  return {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "bridge:listProviders") return providers;
      if (channel === "bridge:listSkills") return skills;
      if (channel === "bridge:listMcpServers") return [];
      if (channel === "bridge:listMemory") return [];
      if (channel === "bridge:createConversation") {
        return { conversationId: `conv-${++conversationSequence}` };
      }
      if (channel === "bridge:generateGlobalPendingOverview") {
        return { ok: false, message: "offline", retryable: true };
      }
      return undefined;
    }),
    subscribe: vi.fn(() => vi.fn()),
  } as unknown as BridgeClient & { invoke: ReturnType<typeof vi.fn> };
}

function CaptureStores({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

describe("BridgeProvider capture wiring", () => {
  it("hydrates real notes and refreshes the shared store after an external change", async () => {
    const original: Note = {
      id: "note-1",
      title: "论文问题",
      markdown: "为什么这个结论成立？",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const updated = { ...original, title: "论文待确认", revision: 2, updatedAt: 2 };
    let notes = [original];
    let emitChange: ((change: CaptureChange) => void) | undefined;
    const listNotes = vi.fn(async () => notes);
    const capture = {
      listNotes,
      listArchivedNotes: vi.fn(async () => []),
      onChanged: vi.fn((listener: (change: CaptureChange) => void) => {
        emitChange = listener;
        return vi.fn();
      }),
    } as unknown as CaptureClient;
    let stores!: BridgeStores;

    render(
      <BridgeProvider capture={capture}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.captures!.getState().notes).toEqual([original]));
    notes = [updated];
    act(() => emitChange?.({
      entity: "note",
      action: "updated",
      id: updated.id,
      revision: updated.revision,
    }));

    await waitFor(() => expect(stores.captures!.getState().notes).toEqual([updated]));
    expect(listNotes).toHaveBeenCalledTimes(2);
  });
});

describe("BridgeProvider desktop notification navigation", () => {
  it("opens the matching conversation or the tasks workboard", async () => {
    let navigate: ((target: unknown) => void) | undefined;
    Object.defineProperty(window, "leemoDesktop", {
      configurable: true,
      value: {
        configure: vi.fn(),
        chooseCaptureStorageRoot: vi.fn(),
        onNavigate: vi.fn((listener: (target: unknown) => void) => {
          navigate = listener;
          return vi.fn();
        }),
      },
    });
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );
    await waitFor(() => expect(navigate).toBeTypeOf("function"));
    act(() => stores.conversations.setState({
      byId: {
        "conv-1": {
          id: "conv-1",
          title: "需要确认",
          titleManuallyUpdated: false,
          bookId: null,
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-chat",
          unread: true,
          createdAt: 1,
          lastActivityAt: 1,
        },
      },
    } as never));

    act(() => navigate?.({ kind: "conversation", conversationId: "conv-1" }));
    expect(stores.conversations.getState().activeId).toBe("conv-1");
    expect(stores.ui.getState().view).toBe("chat");

    act(() => navigate?.({ kind: "task", taskId: "task-1" }));
    expect(stores.ui.getState()).toMatchObject({ view: "organizer", organizerTab: "tasks" });

    delete (window as Window & { leemoDesktop?: unknown }).leemoDesktop;
  });
});

function workspaceClient(): WorkspaceClient & { listNotebooks: ReturnType<typeof vi.fn> } {
  const listNotebooks = vi.fn(async () => ({
    root: "C:\\Users\\me\\Leemo",
    notebooks: [{
      id: "math",
      title: "math",
      dir: "C:\\Users\\me\\Leemo\\math",
      color: "blue" as const,
      hasMemory: false,
    }],
  }));
  return {
    listNotebooks,
    createNotebook: vi.fn(),
    ensureStarterNotebook: vi.fn(),
    readTree: vi.fn(async () => []),
    dropFiles: vi.fn(async () => []),
    moveFile: vi.fn(),
    suggestNotebook: vi.fn(async () => null),
    readTextFile: vi.fn(async () => ""),
    readPreview: vi.fn(async () => ({ kind: "text" as const, text: "", truncated: false, size: 0 })),
    reveal: vi.fn(async () => {}),
    pathForFile: vi.fn(() => ""),
  } as unknown as WorkspaceClient & { listNotebooks: ReturnType<typeof vi.fn> };
}

function persistence(snapshot: PersistedSnapshot | Error): PersistenceClient {
  return {
    loadAll: vi.fn(async () => {
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    }),
    saveConversation: vi.fn(async () => {}),
    moveConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    saveWikiEntry: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    saveGlobalPendingOverview: vi.fn(async () => {}),
  };
}

describe("BridgeProvider settings wiring", () => {
  it("checks daily overview only on a visible foreground event and not when the switch merely changes", async () => {
    const client = liveClient();
    const persist = persistence({
      conversations: [{
        meta: {
          id: "conv-overview",
          title: "打磨产品故事",
          titleManuallyUpdated: false,
          bookId: null,
          source: "workbench",
          providerId: "first-provider",
          modelId: "shared-model",
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          unread: false,
          pinned: false,
          archived: false,
          lastOpenedAt: Date.now(),
        },
        timeline: [{ kind: "text", id: "u1", runId: "r1", role: "user", text: "继续打磨产品故事", streaming: false }],
      }],
      wikiEntries: [],
      settings: {
        globalOverviewAutoEnabled: false,
        globalOverviewAutoTime: "00:00",
        defaultProviderId: "first-provider",
        defaultModelId: "shared-model",
      },
      globalPendingOverview: { version: 1, snapshot: null, overrides: [] },
    });
    let stores!: BridgeStores;

    render(
      <BridgeProvider client={client} live persist={persist}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );
    await waitFor(() => expect(stores?.providers.getState().status).toBe("ready"));

    act(() => stores.settings.getState().setGlobalOverviewAutoEnabled(true));
    await Promise.resolve();
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:generateGlobalPendingOverview", expect.anything());

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith(
      "bridge:generateGlobalPendingOverview",
      expect.objectContaining({ trigger: "scheduled" }),
    ));
    expect(persist.saveGlobalPendingOverview).toHaveBeenCalledWith(expect.objectContaining({
      lastAutoAttemptDate: expect.any(String),
    }));
  });

  it("synchronizes persisted skill overrides to the host before revealing the app", async () => {
    const client = liveClient([
      {
        id: "daily-plan",
        name: "每日计划",
        description: "规划今天",
        qualifiedName: "leemo-library:每日计划",
        source: "builtin",
        category: "learning",
        requirements: ["core"],
        defaultEnabled: true,
        available: true,
      },
      {
        id: "daily-english",
        name: "英语每日练习",
        description: "练习英语",
        qualifiedName: "leemo-library:英语每日练习",
        source: "builtin",
        category: "learning",
        requirements: ["core"],
        defaultEnabled: false,
        available: true,
      },
    ]);
    const persist = persistence({
      conversations: [],
      wikiEntries: [],
      settings: { skillOverrides: { "daily-plan": false, "daily-english": true } },
    });
    let stores!: BridgeStores;

    render(
      <BridgeProvider client={client} live persist={persist}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores?.skills.getState().status).toBe("ready"));
    expect(stores.skills.getState().disabled).toEqual(["daily-plan"]);
    expect(client.invoke).toHaveBeenCalledWith("bridge:syncEnabledSkills", {
      enabledQualifiedNames: ["leemo-library:英语每日练习"],
    });
  });

  it("loads the global governed-memory projection once in live mode", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <BridgeProvider client={client} live>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.memory.getState().loading).toBe(false));
    expect(client.invoke).toHaveBeenCalledWith("bridge:listMemory", {
      scopes: [{ type: "global" }],
    });
    expect(stores.memory.getState().records).toEqual([]);
  });

  it("uses the configured provider and model selected as the default for a new conversation", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <BridgeProvider client={client} live>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.providers.getState().status).toBe("ready"));
    act(() => stores.settings.getState().setDefaultModel("chosen-provider", "chosen-model"));
    await act(async () => { await stores.conversations.getState().createConversation({ source: "workbench" }); });

    expect(client.invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ providerId: "chosen-provider", modelId: "chosen-model" }),
    );
  });

  it("applies the selected momo flavor and relationship to new and existing conversations", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <BridgeProvider client={client} live>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.providers.getState().status).toBe("ready"));
    act(() => stores.settings.getState().setPersonaCard("momo-entp"));
    await act(async () => {
      await stores.conversations.getState().createConversation({ source: "buddy" });
    });

    expect(client.invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ personaText: expect.stringMatching(/ENTP 风味[\s\S]*搭档/) }),
    );

    act(() => stores.settings.getState().setRelationshipStyle("mentor"));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith(
      "bridge:updateContext",
      expect.objectContaining({ personaText: expect.stringMatching(/ENTP 风味[\s\S]*导师/) }),
    ));
  });

  it("uses the live provider store for new conversations under React StrictMode", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <StrictMode>
        <BridgeProvider client={client} live>
          <CaptureStores onReady={(value) => { stores = value; }} />
        </BridgeProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(stores.providers.getState().status).toBe("ready"));
    act(() => {
      stores.settings.getState().setProviderOrder(["chosen-provider", "first-provider"]);
      stores.settings.getState().setDefaultModel("chosen-provider", "chosen-model");
    });
    await act(async () => { await stores.conversations.getState().createConversation({ source: "workbench" }); });

    const createCalls = client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation");
    expect(createCalls.at(-1)?.[1]).toEqual(expect.objectContaining({
      providerId: "chosen-provider",
      modelId: "shared-model",
    }));
  });

  it("uses provider priority for new conversations without changing an existing conversation", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <BridgeProvider client={client} live>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.providers.getState().status).toBe("ready"));
    let existingId = "";
    await act(async () => {
      existingId = await stores.conversations.getState().createConversation({ source: "workbench" });
    });
    expect(stores.conversations.getState().byId[existingId]).toMatchObject({
      providerId: "first-provider",
      modelId: "shared-model",
    });

    act(() => stores.settings.getState().setProviderOrder(["chosen-provider", "first-provider"]));
    expect(stores.conversations.getState().byId[existingId]).toMatchObject({
      providerId: "first-provider",
      modelId: "shared-model",
    });
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:setModel", expect.anything());

    await act(async () => {
      await stores.conversations.getState().createConversation({ source: "buddy" });
    });
    const createCalls = client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation");
    expect(createCalls.at(-1)?.[1]).toEqual(expect.objectContaining({
      providerId: "chosen-provider",
      modelId: "shared-model",
    }));
  });

  it("sends the automatic-memory preference when creating a conversation", async () => {
    const client = liveClient();
    let stores!: BridgeStores;
    render(
      <BridgeProvider client={client} live>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores.providers.getState().status).toBe("ready"));
    act(() => stores.settings.getState().setRememberMode(false));
    await act(async () => { await stores.conversations.getState().createConversation({ source: "buddy" }); });

    expect(client.invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ rememberMode: false }),
    );
  });
});

describe("BridgeProvider artifact hydration", () => {
  it("restores only conversations that belong to the saved workbench scope", async () => {
    const persist = persistence({
      conversations: [
        {
          meta: {
            id: "conv-math",
            title: "数学",
            titleManuallyUpdated: false,
            bookId: "math",
            source: "workbench",
            providerId: "deepseek",
            modelId: "deepseek-chat",
            createdAt: 1,
            lastActivityAt: 2,
            unread: false,
          },
          timeline: [{ kind: "text", id: "math-text", runId: "run-math", role: "user", text: "q", streaming: false }],
        },
        {
          meta: {
            id: "conv-global",
            title: "搭子",
            titleManuallyUpdated: false,
            bookId: null,
            source: "buddy",
            providerId: "deepseek",
            modelId: "deepseek-chat",
            createdAt: 1,
            lastActivityAt: 2,
            unread: false,
          },
          timeline: [{ kind: "text", id: "global-text", runId: "run-global", role: "user", text: "q", streaming: false }],
        },
      ],
      wikiEntries: [],
      settings: {
        workbenchUi: {
          activeScopeKey: "notebook:math",
          scopeSessions: {
            "notebook:math": {
              openConversationIds: ["conv-math", "conv-global", "missing"],
              activeConversationId: "conv-global",
              fileTabs: [],
              activeFileKey: null,
              surfacePreference: "split",
              splitRatio: 0.42,
            },
          },
        },
      },
    });
    let stores!: BridgeStores;

    render(
      <BridgeProvider persist={persist} workspace={workspaceClient()}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores?.ui.getState().activeScopeKey).toBe("notebook:math"));
    expect(stores.notebooks.getState().activeId).toBe("math");
    expect(stores.conversations.getState().activeId).toBe("conv-math");
    expect(stores.ui.getState().scopeSessions["notebook:math"]?.openConversationIds).toEqual(["conv-math"]);
    expect(stores.ui.getState().scopeSessions["notebook:math"]?.activeConversationId).toBeNull();
  });

  it("rebuilds artifacts only after persisted conversations and real notebooks are available", async () => {
    const workspace = workspaceClient();
    const persist = persistence({
      conversations: [{
        meta: {
          id: "conv-persisted",
          title: "生成复习提纲",
          titleManuallyUpdated: true,
          bookId: "math",
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 10,
          lastActivityAt: 80,
          unread: false,
        },
        timeline: [
          {
            kind: "tool",
            id: "tool-row",
            runId: "run-7",
            toolUseId: "write-7",
            name: "Write",
            input: { file_path: "C:\\Users\\me\\Leemo\\math\\outline.md" },
            status: "ok",
          },
          {
            kind: "result",
            id: "result-row",
            runId: "run-7",
            isError: false,
            interrupted: false,
            finalText: "写好了",
            pathAudit: { claimed: [] },
            createdAt: 70,
          },
        ],
      }],
      wikiEntries: [],
      settings: {},
    });
    let stores!: BridgeStores;

    render(
      <BridgeProvider persist={persist} workspace={workspace}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores?.artifacts.getState().status).toBe("ready"));
    expect(workspace.listNotebooks).toHaveBeenCalled();
    expect(stores.artifacts.getState().entries).toEqual([
      expect.objectContaining({
        id: "conv-persisted:write-7",
        path: "math/outline.md",
        bookId: "math",
        sourceRunId: "run-7",
        createdAt: 70,
        escaped: false,
      }),
    ]);
  });

  it("surfaces artifact hydration errors without keeping the app on the bootstrap screen", async () => {
    let stores!: BridgeStores;
    render(
      <BridgeProvider persist={persistence(new Error("disk unavailable"))}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores?.artifacts.getState().status).toBe("error"));
    expect(stores.artifacts.getState().error).toMatch(/disk unavailable/);
  });
});

describe("BridgeProvider conversation lifecycle wiring", () => {
  it("moves and detaches a failed first-turn draft without losing its text", async () => {
    const persist = persistence({
      conversations: [{
        meta: {
          id: "conv-draft",
          title: "尚未发送",
          titleManuallyUpdated: false,
          workspaceId: "leemo-home",
          bookId: "math",
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 10,
          lastActivityAt: 20,
          unread: false,
        },
        timeline: [],
      }],
      wikiEntries: [],
      settings: {},
    });
    let stores!: BridgeStores;

    render(
      <BridgeProvider client={liveClient()} persist={persist}>
        <CaptureStores onReady={(value) => { stores = value; }} />
      </BridgeProvider>,
    );

    await waitFor(() => expect(stores?.conversations.getState().byId["conv-draft"]).toBeDefined());
    const sourceScope = workspaceComposerScope("leemo-home", "math");
    const movedScope = conversationComposerScope("conv-draft");
    act(() => {
      stores.composerDrafts!.getState().setText(sourceScope, "不要丢掉这段未发送内容");
      stores.composerDrafts!.getState().assignConversation(sourceScope, "conv-draft");
    });

    await act(async () => {
      await stores.conversations.getState().moveConversation("conv-draft", {
        workspaceId: "leemo-home",
        bookId: null,
      });
    });

    expect(stores.composerDrafts!.getState().drafts[sourceScope]).toBeUndefined();
    expect(stores.composerDrafts!.getState().drafts[movedScope]).toMatchObject({
      text: "不要丢掉这段未发送内容",
      assignedConversationId: "conv-draft",
    });

    await act(async () => {
      await stores.conversations.getState().deleteConversation("conv-draft");
    });

    expect(stores.composerDrafts!.getState().drafts[movedScope]).toMatchObject({
      text: "不要丢掉这段未发送内容",
      assignedConversationId: null,
    });
    expect(persist.moveConversation).toHaveBeenCalledOnce();
    expect(persist.deleteConversation).toHaveBeenCalledWith("conv-draft");
  });
});
