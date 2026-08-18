import { useEffect } from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import App from "./App";
import { BridgeProvider, useNotifications, useProviders, useSettings, useUi } from "../bridge/context";
import AppOverlays from "../components/AppOverlays";
import type { BridgeClient } from "../bridge/client";
import type { ProviderSpec } from "../../bridge/contract";
import type { PersistenceClient, PersistedSnapshot } from "../persistence/client";
import type { WorkspaceClient } from "../workspace/client";
import BuddyShell from "../components/BuddyShell";
import WorkbenchShell from "../components/WorkbenchShell";

const deepseekSpec: ProviderSpec = {
  id: "deepseek", name: "DeepSeek", kind: "deepseek", category: "cn_official",
  apiFormat: "anthropic", authMode: "api-key",
  baseUrl: "https://api.deepseek.com/anthropic",
  models: ["deepseek-chat"],
  capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
};

function OpenModelSettingsHarness() {
  const openSettings = useUi((state) => state.openSettings);
  useEffect(() => openSettings("models"), [openSettings]);
  return <AppOverlays />;
}

function DualShellHarness() {
  const mode = useSettings((state) => state.mode);
  return mode === "buddy" ? <BuddyShell /> : <WorkbenchShell />;
}

const draftWorkspace: WorkspaceClient = {
  listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [] }),
  createNotebook: async (title) => ({ id: title, title, dir: `/w/Leemo/${title}`, color: "blue", hasMemory: false }),
  ensureStarterNotebook: async () => ({ id: "示例", title: "示例", dir: "/w/Leemo/示例", color: "blue", hasMemory: false }),
  readTree: async () => [],
  dropFiles: async () => [],
  moveFile: async () => ({ path: "x", name: "x", bookId: null }),
  suggestNotebook: async () => null,
  readTextFile: async () => "",
  readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
  reveal: async () => {},
  pathForFile: (file) => `C:\\Downloads\\${file.name}`,
};

describe("App", () => {
  it("opens the quiet Start surface by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "开始" })).toBeInTheDocument();
    expect(screen.queryByLabelText("输入消息")).not.toBeInTheDocument();
  });

  it("loads durable notes through the desktop capture bridge", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, response: [] });
    window.leemoCapture = {
      invoke,
      onChanged: vi.fn(() => () => {}),
    };

    try {
      render(<App />);
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("listNotes", undefined));
    } finally {
      delete window.leemoCapture;
    }
  });

  it("opens the static document library without exposing an AI composer", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "我的文档" }));
    expect(await screen.findByTestId("start-documents-view")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "新建文档" })[0]);
    expect(screen.getByRole("textbox", { name: "便签正文" })).toBeInTheDocument();
    expect(screen.queryByLabelText("输入消息")).not.toBeInTheDocument();
  });

  it("keeps an unsent draft when switching between buddy and workbench", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "切换到搭子" }));
    fireEvent.change(screen.getByLabelText("输入消息"), {
      target: { value: "这段话切换模式也不能丢" },
    });

    fireEvent.click(screen.getByRole("button", { name: "切换到工作台" }));
    expect(screen.getByLabelText("输入消息")).toHaveValue("这段话切换模式也不能丢");

    fireEvent.click(screen.getByRole("button", { name: "切换到搭子" }));
    expect(screen.getByLabelText("输入消息")).toHaveValue("这段话切换模式也不能丢");
  });

  it("keeps unsent attachments when switching shells", async () => {
    render(
      <BridgeProvider workspace={draftWorkspace}>
        <DualShellHarness />
      </BridgeProvider>,
    );
    const file = new File(["notes"], "英语复习材料.pdf", { type: "application/pdf" });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(screen.getByText("英语复习材料.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换到工作台" }));
    expect(screen.getByText("英语复习材料.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换到搭子" }));
    expect(screen.getByText("英语复习材料.pdf")).toBeInTheDocument();
  });

  it("opens the settings shell immediately while loading its content on demand", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByTestId("settings-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("settings-window")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在打开设置" })).toBeInTheDocument();
    expect(await screen.findByRole("tablist", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("settings-overlay")).not.toBeInTheDocument();
  });

  it("asks before Escape closes settings with an unsaved provider draft", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "模型" }));
    const nameInput = await screen.findByLabelText("名称");
    fireEvent.change(nameInput, { target: { value: "未保存的服务商名称" } });
    await waitFor(() => expect(nameInput).toHaveValue("未保存的服务商名称"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "关闭设置" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.queryByRole("alertdialog", { name: "关闭设置" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue("未保存的服务商名称");
  });

  it("cannot leave model settings while a save is still pending", async () => {
    let resolveSave!: (spec: ProviderSpec) => void;
    const savePending = new Promise<ProviderSpec>((resolve) => { resolveSave = resolve; });
    const invoke = vi.fn((channel: string) => {
      if (channel === "bridge:getProviderConfig") {
        return Promise.resolve({
          ...deepseekSpec,
          hasApiKey: true,
          apiKeyMasked: "····test",
          saved: true,
        });
      }
      if (channel === "bridge:saveProvider") return savePending;
      if (channel === "bridge:listProviders") return Promise.resolve([deepseekSpec]);
      if (channel === "bridge:listWhitelist") return Promise.resolve([]);
      if (channel === "bridge:usageSummary") {
        return Promise.resolve({ range: "all", inputTokens: 0, outputTokens: 0, costUsd: 0, byProvider: [] });
      }
      return Promise.resolve(undefined);
    });
    const client = { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;

    render(
      <BridgeProvider client={client}>
        <OpenModelSettingsHarness />
      </BridgeProvider>,
    );

    await screen.findByLabelText("名称");
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("bridge:saveProvider", expect.anything()));

    expect(screen.getByRole("button", { name: "关闭设置" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "通用" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("settings-overlay")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "关闭设置" })).not.toBeInTheDocument();

    await act(async () => {
      resolveSave(deepseekSpec);
      await savePending;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭设置" })).toBeEnabled());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("settings-overlay")).not.toBeInTheDocument();
  });

  it("default browser fixture sends events back into the same conversation", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "切换到搭子" }));
    fireEvent.change(screen.getByPlaceholderText("输入消息…"), { target: { value: "整理课程笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    // Query and assert in one callback: the second text.delta replaces the
    // first rendered node, so awaiting the first node can leave a stale DOM
    // reference before the matcher runs under full-suite scheduling.
    await waitFor(() => {
      expect(screen.getByText(/好，我先通读一遍，列个计划再动手/)).toBeInTheDocument();
    });
  });
});

describe("BridgeProvider live mode", () => {
  function makeLiveClient(spec = deepseekSpec): BridgeClient {
    return {
      invoke: vi.fn().mockResolvedValue([spec]),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
  }

  function ProviderList() {
    const list = useProviders((s) => s.list);
    return <ul>{list.map((p) => <li key={p.id}>{p.id}</li>)}</ul>;
  }

  function NotificationCount() {
    return <span data-testid="notification-count">{useNotifications((s) => s.items.length)}</span>;
  }

  it("calls refresh on mount when live=true and populates providers list from client", async () => {
    const client = makeLiveClient();
    await act(async () => {
      render(
        <BridgeProvider client={client} live>
          <ProviderList />
        </BridgeProvider>,
      );
    });
    expect(client.invoke).toHaveBeenCalledWith("bridge:listProviders", undefined);
    expect(screen.getByText("deepseek")).toBeInTheDocument();
  });

  it("fixture branch is unaffected when live prop is absent", () => {
    const client = makeLiveClient();
    render(
      <BridgeProvider client={client}>
        <ProviderList />
      </BridgeProvider>,
    );
    // fixture seeds deepseek too, but refresh must NOT have been called
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:listProviders", undefined);
    expect(screen.getByText("deepseek")).toBeInTheDocument();
  });

  it("does not seed demo notifications into the live desktop product", () => {
    render(
      <BridgeProvider client={makeLiveClient()} live>
        <NotificationCount />
      </BridgeProvider>,
    );

    expect(screen.getByTestId("notification-count")).toHaveTextContent("0");
  });
});

describe("BridgeProvider persistence gate", () => {
  function ModeProbe() {
    return <span>{useSettings((s) => s.mode)}</span>;
  }

  it("does not flash the default buddy shell before a persisted workbench mode is restored", async () => {
    let resolveLoad!: (snapshot: PersistedSnapshot) => void;
    const persist: PersistenceClient = {
      loadAll: vi.fn(() => new Promise<PersistedSnapshot>((resolve) => { resolveLoad = resolve; })),
      saveConversation: vi.fn(async () => {}),
      moveConversation: vi.fn(async () => {}),
      deleteConversation: vi.fn(async () => {}),
      saveWikiEntry: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      saveGlobalPendingOverview: vi.fn(async () => {}),
    };

    render(
      <BridgeProvider persist={persist}>
        <ModeProbe />
      </BridgeProvider>,
    );

    expect(screen.getByTestId("app-bootstrap")).toBeInTheDocument();
    expect(screen.queryByText("buddy")).not.toBeInTheDocument();

    await act(async () => {
      resolveLoad({ conversations: [], wikiEntries: [], settings: { mode: "workbench" } });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("app-bootstrap")).not.toBeInTheDocument();
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });
});

