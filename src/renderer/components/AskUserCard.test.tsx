import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import AskUserCard, { type QuestionInteraction } from "./AskUserCard";
import { BridgeProvider, useConversations, useApprovals } from "../bridge/context";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import type { AskUserPayload, AskUserQuestion } from "../../bridge/contract";

// AskUserCard now renders exactly ONE paired interaction (卡 D — 启动轮 2):
// TurnBlock does the run-wide index pairing (see ask-user-pairing.test.ts) and
// hands this component a single PendingInteraction | ResolvedInteraction. The
// "resolved" (answered/cancelled) states are pure display, so those tests just
// pass a fixture directly. The pending/submit flow needs to exercise the real
// approvals store (answer() looks the id up in pendingByConversation), so
// those tests drive it through the real create→send→emitAskUser wiring, same
// as the old runId-scoped test did — only the render target changed.

const ONE_QUESTION: AskUserQuestion[] = [
  {
    question: "选择部署环境？",
    header: "ENVIRONMENT",
    options: [
      { label: "开发", description: "dev 环境" },
      { label: "生产", description: "prod 环境" },
    ],
    multiSelect: false,
  },
];

const MULTI_QUESTION: AskUserQuestion[] = [
  {
    question: "选择启用的功能？",
    options: [
      { label: "缓存", description: "启用缓存" },
      { label: "日志", description: "启用日志" },
    ],
    multiSelect: true,
  },
];

function resolved(items: { selected: string[]; other?: string }[] | null): QuestionInteraction {
  return {
    kind: "question",
    id: "ask-1",
    runId: "run-1",
    questions: ONE_QUESTION,
    items,
  } as QuestionInteraction;
}

/** Drives a pending question through the real store (createConversation →
 *  send → emitAskUser), then renders AskUserCard with whatever the store
 *  actually produced — so submit exercises the real answer() round-trip. */
function TestHarness({ client, askPayload }: { client: FixtureBridgeClient; askPayload: AskUserPayload }) {
  const createConversation = useConversations((s) => s.createConversation);
  const send = useConversations((s) => s.send);
  const pending = useApprovals((s) =>
    Object.values(s.pendingByConversation).find((p) => p?.kind === "question")
  );
  // Once answered, the interaction moves out of pendingByConversation and
  // into resolvedByRun — same transition TurnBlock's re-pairing does on the
  // next render, so the harness follows it too instead of just going blank.
  const resolved = useApprovals((s) =>
    Object.values(s.resolvedByRun)
      .flat()
      .find((r) => r.kind === "question" && r.id === askPayload.id)
  );

  useEffect(() => {
    void (async () => {
      await createConversation({ source: "buddy" });
      // A run must exist (runId) before an askUser push can attach — wiring
      // drops askUser pushes with no active run.
      await send("conv-1", "test");
      client.emitAskUser(askPayload);
    })();
  }, [createConversation, send, client, askPayload]);

  if (resolved?.kind === "question") return <AskUserCard interaction={resolved} />;
  if (pending?.kind === "question") return <AskUserCard interaction={pending} />;
  return null;
}

function renderPending(questions: AskUserQuestion[] = ONE_QUESTION) {
  const client = new FixtureBridgeClient();
  const askPayload: AskUserPayload = { id: "question-1", conversationId: "conv-1", questions };
  render(
    <BridgeProvider client={client}>
      <TestHarness client={client} askPayload={askPayload} />
    </BridgeProvider>
  );
  return { client };
}

describe("AskUserCard — pending (interactive, amber)", () => {
  it("renders the question, header and options", async () => {
    renderPending();
    expect(await screen.findByText("选择部署环境？")).toBeInTheDocument();
    expect(screen.getByText("ENVIRONMENT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开发/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生产/ })).toBeInTheDocument();
  });

  it("renders with an amber-emphasized border (pending state must stand out)", async () => {
    const { container } = render(
      <BridgeProvider>
        <AskUserCard
          interaction={{
            kind: "question",
            id: "ask-1",
            conversationId: "conv-1",
            runId: "run-1",
            questions: ONE_QUESTION,
            receivedAt: 0,
          } as QuestionInteraction}
        />
      </BridgeProvider>
    );
    await screen.findByText("选择部署环境？");
    const card = container.firstElementChild as HTMLElement;
    expect(card).toHaveClass("leemo-ask-card");
    expect(card).toHaveAttribute("data-component-role", "ask-user");
    expect(card).toHaveAttribute("data-surface-level", "raised");
    expect(card).toHaveAttribute("data-tone", "question");
    const submit = screen.getByRole("button", { name: "提交" });
    expect(submit).toHaveClass("rounded-full");
    expect(submit).toHaveAttribute("title", "请先选择或填写答案");
  });

  it("keeps the buddy question as a compact decision card with a clear interaction label", async () => {
    const { container } = render(
      <BridgeProvider>
        <AskUserCard
          density="buddy"
          interaction={{
            kind: "question",
            id: "ask-buddy",
            conversationId: "conv-buddy",
            runId: "run-buddy",
            questions: ONE_QUESTION,
            receivedAt: 0,
          } as QuestionInteraction}
        />
      </BridgeProvider>,
    );

    expect(await screen.findByText("需要你选一下")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("max-w-[520px]");
    expect(screen.getByText("dev 环境")).toBeInTheDocument();
  });

  it("renders multi-select question with independently toggleable options", async () => {
    const user = userEvent.setup();
    renderPending(MULTI_QUESTION);
    await screen.findByText("选择启用的功能？");
    const cache = screen.getByRole("button", { name: /缓存/ });
    const log = screen.getByRole("button", { name: /日志/ });
    await user.click(cache);
    await user.click(log);
    expect(cache).toHaveAttribute("aria-pressed", "true");
    expect(log).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every option container full-width and aligned when labels have different lengths", async () => {
    renderPending([{
      question: "你希望先做哪一步？",
      options: [
        { label: "先预览" },
        { label: "直接开始，但在最终提交前让我确认一次", description: "适合已经明确目标的任务" },
      ],
      multiSelect: false,
    }]);

    const shortOption = await screen.findByRole("button", { name: "先预览" });
    const longOption = screen.getByRole("button", { name: /直接开始/ });
    for (const option of [shortOption, longOption]) {
      expect(option.className).toContain("w-full");
      expect(option.className).toContain("text-left");
      expect(option.className).toContain("min-h-[50px]");
      expect(option.className).toContain("text-[13px]");
      expect(option.className).not.toContain("rounded-full");
      expect(option.firstElementChild).toHaveAttribute("data-ask-option-marker");
      expect(option).toHaveAttribute("data-option-state", "idle");
    }

    await userEvent.click(shortOption);
    expect(shortOption).toHaveAttribute("data-option-state", "selected");
  });

  it("single-select is exclusive (picking one deselects the other)", async () => {
    const user = userEvent.setup();
    renderPending();
    await screen.findByText("选择部署环境？");
    const dev = screen.getByRole("button", { name: /开发/ });
    const prod = screen.getByRole("button", { name: /生产/ });
    await user.click(dev);
    expect(dev).toHaveAttribute("aria-pressed", "true");
    await user.click(prod);
    expect(prod).toHaveAttribute("aria-pressed", "true");
    expect(dev).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps a single-select option selected under React StrictMode", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <BridgeProvider>
          <AskUserCard
            interaction={{
              kind: "question",
              id: "ask-strict",
              conversationId: "conv-strict",
              runId: "run-strict",
              questions: ONE_QUESTION,
              receivedAt: 0,
            } as QuestionInteraction}
          />
        </BridgeProvider>
      </StrictMode>,
    );
    const dev = await screen.findByRole("button", { name: /开发/ });
    await user.click(dev);
    expect(dev).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /提交/i })).not.toBeDisabled();
  });

  it("shows an Other free-text field", async () => {
    const user = userEvent.setup();
    renderPending();
    const otherInput = await screen.findByPlaceholderText("其它…");
    await user.type(otherInput, "测试环境");
    expect(otherInput).toHaveValue("测试环境");
  });

  it("disables submit until an option or Other text is provided", async () => {
    renderPending();
    await screen.findByText("选择部署环境？");
    expect(screen.getByRole("button", { name: /提交/i })).toBeDisabled();
  });

  it("allows answering with Other text only (no option picked)", async () => {
    const user = userEvent.setup();
    renderPending();
    await user.type(await screen.findByPlaceholderText("其它…"), "自定义环境");
    expect(screen.getByRole("button", { name: /提交/i })).not.toBeDisabled();
  });

  it("calls approvals.answer and the card becomes the resolved summary once it succeeds", async () => {
    const user = userEvent.setup();
    renderPending();
    await screen.findByText("选择部署环境？");

    await user.click(screen.getByRole("button", { name: /开发/ }));
    const submit = screen.getByRole("button", { name: /提交/i });
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    // Real round-trip through the store: the interactive card unmounts (props
    // update to the resolved interaction) and the chosen answer shows instead.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /提交/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/开发/)).toBeInTheDocument();
  });
});

describe("AskUserCard — resolved answered (quiet receipt, in place)", () => {
  it("shows the question and the chosen option, no interactive controls", () => {
    const { container } = render(
      <BridgeProvider>
        <AskUserCard interaction={resolved([{ selected: ["开发"], other: undefined }])} />
      </BridgeProvider>
    );
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
    expect(screen.getByText(/开发/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开发/ })).not.toBeInTheDocument(); // not clickable anymore
    const card = container.firstElementChild as HTMLElement;
    expect(card).toHaveAttribute("data-testid", "resolved-question-receipt");
    expect(card.className).not.toContain("opacity-55");
    expect(card.className).toContain("min-h-9");
  });

  it("shows Other text alongside a selected option", () => {
    render(
      <BridgeProvider>
        <AskUserCard interaction={resolved([{ selected: ["开发"], other: "备注文字" }])} />
      </BridgeProvider>
    );
    expect(screen.getByText(/开发/)).toBeInTheDocument();
    expect(screen.getByText(/备注文字/)).toBeInTheDocument();
  });

  it("shows 无 when nothing was selected and no Other text", () => {
    render(
      <BridgeProvider>
        <AskUserCard interaction={resolved([{ selected: [], other: undefined }])} />
      </BridgeProvider>
    );
    expect(screen.getByText("无")).toBeInTheDocument();
  });

  it("uses a quiet one-line answer in buddy density", () => {
    const { container } = render(
      <BridgeProvider>
        <AskUserCard
          interaction={resolved([{ selected: ["开发"], other: undefined }])}
          density="buddy"
        />
      </BridgeProvider>
    );
    expect(screen.getByText(/你选了：开发/)).toBeInTheDocument();
    expect(screen.queryByText("选择部署环境？")).not.toBeInTheDocument();
    expect(container.querySelector(".opacity-55")).toBeNull();
  });
});

describe("AskUserCard — resolved cancelled/expired (archived, marked 已取消)", () => {
  it("shows 已取消 instead of an answer when items is null", () => {
    render(
      <BridgeProvider>
        <AskUserCard interaction={resolved(null)} />
      </BridgeProvider>
    );
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交/i })).not.toBeInTheDocument();
  });
});
