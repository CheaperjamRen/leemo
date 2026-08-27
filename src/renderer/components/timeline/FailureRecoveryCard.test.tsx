import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineItem } from "../../stores/message-model";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../../bridge/context";
import { FixtureBridgeClient } from "../../bridge/fixture-client";
import TurnBlock from "./TurnBlock";

const RUN_ID = "run-failed";

const userTurn: Extract<TimelineItem, { kind: "text" }> = {
  kind: "text",
  id: "user",
  runId: RUN_ID,
  role: "user",
  text: "帮我把这个岗位的 JD 和简历对比一下",
  streaming: false,
};

const momoTurn: TimelineItem = {
  kind: "text",
  id: "momo",
  runId: RUN_ID,
  role: "momo",
  text: "简历已经读完，但岗位页面暂时没有打开。",
  streaming: false,
};

const plan: TimelineItem = {
  kind: "plan",
  id: "plan",
  runId: RUN_ID,
  toolUseId: "plan-tool",
  todos: [
    { text: "简历解析 · 12 条经历与能力证据", status: "done" },
    { text: "读取岗位详情", status: "active" },
    { text: "生成岗位对比建议", status: "todo" },
  ],
};

const failedBrowser: TimelineItem = {
  kind: "tool",
  id: "browser",
  runId: RUN_ID,
  toolUseId: "browser-tool",
  name: "WebFetch",
  input: { url: "https://example.invalid/job" },
  status: "error",
  summary: "岗位页面没有打开",
};

const rawError: TimelineItem = {
  kind: "error",
  id: "error",
  runId: RUN_ID,
  message: "HTTP 401: sign-in required",
};

const failedResult: TimelineItem = {
  kind: "result",
  id: "result",
  runId: RUN_ID,
  isError: true,
  interrupted: false,
  finalText: "",
  pathAudit: { claimed: [] },
};

const interruptedResult: TimelineItem = {
  ...failedResult,
  id: "interrupted",
  isError: false,
  interrupted: true,
};

function renderFailedTurn(
  items: TimelineItem[],
  density: "buddy" | "workbench" = "buddy",
) {
  const client = new FixtureBridgeClient({ chunkDelayMs: 5_000 });
  let stores: BridgeStores | null = null;

  function Harness() {
    stores = useContext(BridgeContext);
    return (
      <>
        <TurnBlock items={items} active={false} runId={RUN_ID} density={density} />
        <textarea aria-label="输入消息" />
      </>
    );
  }

  const view = render(
    <BridgeProvider client={client}>
      <Harness />
    </BridgeProvider>,
  );

  return {
    ...view,
    client,
    getStores: () => {
      if (!stores) throw new Error("Bridge stores were not mounted");
      return stores;
    },
  };
}

async function seedRetryDraft(stores: BridgeStores): Promise<string> {
  let conversationId = "";
  await act(async () => {
    conversationId = await stores.conversations.getState().createConversation({
      source: "buddy",
      bookId: null,
    });
  });
  act(() => {
    stores.conversations.setState((state) => ({
      ...state,
      pendingSends: {
        ...state.pendingSends,
        [conversationId]: {
          runId: RUN_ID,
          text: userTurn.text,
          attachments: [],
          providerId: "deepseek",
          modelId: "deepseek-chat",
          errorMessage: "HTTP 401: sign-in required",
        },
      },
    }));
  });
  return conversationId;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buddy failure recovery receipt", () => {
  it("renders only explicit completed and unfinished facts for a terminal failure", () => {
    renderFailedTurn([userTurn, momoTurn, plan, failedBrowser, rawError, failedResult]);

    expect(screen.getByTestId("buddy-failure-recovery")).toBeInTheDocument();
    expect(screen.getByText("网页读取失败")).toBeInTheDocument();
    expect(screen.getByText("岗位页面没有打开")).toBeInTheDocument();
    expect(screen.getByTestId("failure-completed-row")).toHaveTextContent(
      "简历解析 · 12 条经历与能力证据",
    );
    expect(screen.getByTestId("failure-unfinished-row")).toHaveTextContent("读取岗位详情");
    expect(screen.getByTestId("failure-unfinished-row")).toHaveTextContent("生成岗位对比建议");
  });

  it("does not invent a completed row when the timeline has no completed fact", () => {
    renderFailedTurn([userTurn, rawError, failedResult]);

    expect(screen.getByTestId("buddy-failure-recovery")).toBeInTheDocument();
    expect(screen.queryByTestId("failure-completed-row")).not.toBeInTheDocument();
  });

  it("keeps the original error collapsed until the user opens details", () => {
    renderFailedTurn([userTurn, failedBrowser, rawError, failedResult]);

    expect(screen.queryByText("HTTP 401: sign-in required")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看错误详情" }));
    expect(screen.getByText("HTTP 401: sign-in required")).toBeInTheDocument();
  });

  it("places the recovery receipt after momo's last factual message", () => {
    const lateMomo: Extract<TimelineItem, { kind: "text" }> = {
      ...momoTurn,
      id: "late-momo",
      text: "简历已经读完，但岗位页面需要登录。",
    };
    renderFailedTurn([userTurn, plan, failedBrowser, lateMomo, rawError, failedResult]);

    const message = screen.getByText(lateMomo.text);
    const receipt = screen.getByTestId("buddy-failure-recovery");
    expect(message.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("retries the matching preserved draft and can paste clipboard text into the real composer draft", async () => {
    const { getStores } = renderFailedTurn([userTurn, failedBrowser, rawError, failedResult]);
    const stores = getStores();
    const conversationId = await seedRetryDraft(stores);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("完整岗位 JD") },
    });

    fireEvent.click(await screen.findByRole("button", { name: "粘贴 JD 继续" }));
    await waitFor(() => {
      expect(Object.values(stores.composerDrafts!.getState().drafts).some((draft) => draft.text === "完整岗位 JD")).toBe(true);
    });
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(stores.conversations.getState().pendingSends[conversationId]?.errorMessage).toBeUndefined();
    });
  });

  it("can explicitly discard only the preserved retry entry", async () => {
    const { getStores } = renderFailedTurn([userTurn, failedBrowser, rawError, failedResult]);
    const stores = getStores();
    const conversationId = await seedRetryDraft(stores);

    fireEvent.click(await screen.findByRole("button", { name: "更多恢复操作" }));
    fireEvent.click(screen.getByRole("button", { name: "不再显示恢复入口" }));

    expect(stores.conversations.getState().pendingSends[conversationId]).toBeUndefined();
  });

  it("dismisses the secondary recovery menu when clicking elsewhere", async () => {
    const { getStores } = renderFailedTurn([userTurn, failedBrowser, rawError, failedResult]);
    await seedRetryDraft(getStores());

    fireEvent.click(await screen.findByRole("button", { name: "更多恢复操作" }));
    expect(screen.getByRole("button", { name: "不再显示恢复入口" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "不再显示恢复入口" })).not.toBeInTheDocument();
  });

  it("does not turn an ordinary interruption into a recovery card, but keeps actionable workbench failures recoverable", async () => {
    const interrupted = renderFailedTurn([userTurn, plan, interruptedResult]);
    expect(screen.queryByTestId("buddy-failure-recovery")).not.toBeInTheDocument();
    interrupted.unmount();

    const workbench = renderFailedTurn([userTurn, plan, failedResult], "workbench");
    await seedRetryDraft(workbench.getStores());
    expect(await screen.findByTestId("buddy-failure-recovery")).toBeInTheDocument();
    expect(screen.getByText("任务未完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
