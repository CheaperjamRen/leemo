import { useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BridgeProvider, useConversations } from "../../bridge/context";
import Timeline from "./Timeline";
import { FixtureBridgeClient } from "../../bridge/fixture-client";
import type { AskUserPayload } from "../../../bridge/contract";

/** jsdom never lays anything out, so scrollHeight/clientHeight/scrollTop are
 *  always 0 — useScrollFollow's `atBottom` would never flip false without
 *  this. Force the "scrolled up" geometry, then fire the scroll handler. */
function mockScrolledUp(container: HTMLElement): void {
  const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
  Object.defineProperty(scrollEl, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(scrollEl, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });
  fireEvent.scroll(scrollEl);
}

function Seeder({ client, askPayload }: { client: FixtureBridgeClient; askPayload?: AskUserPayload }) {
  const createConversation = useConversations((s) => s.createConversation);
  const send = useConversations((s) => s.send);
  useEffect(() => {
    void (async () => {
      await createConversation({ source: "buddy" });
      await send("conv-1", "hi");
      if (askPayload) client.emitAskUser(askPayload);
    })();
  }, [client, createConversation, send, askPayload]);
  return <Timeline />;
}

function DeferredAskSeeder({ client }: { client: FixtureBridgeClient }) {
  const createConversation = useConversations((s) => s.createConversation);
  const send = useConversations((s) => s.send);
  useEffect(() => {
    void (async () => {
      await createConversation({ source: "buddy" });
      await send("conv-1", "hi");
    })();
  }, [client, createConversation, send]);
  return (
    <>
      <button type="button" onClick={() => client.emitAskUser(ASK_PAYLOAD)}>emit pending question</button>
      <Timeline />
    </>
  );
}

const ASK_PAYLOAD: AskUserPayload = {
  id: "q1",
  conversationId: "conv-1",
  questions: [{ question: "选择环境？", options: [{ label: "开发" }] }],
};

describe("Timeline — scroll-out-of-view hint (卡 D §6): pill and BackToBottom are mutually exclusive", () => {
  it("shows plain BackToBottom when scrolled up with no pending question", async () => {
    const client = new FixtureBridgeClient();
    const { container } = render(
      <BridgeProvider client={client}>
        <Seeder client={client} />
      </BridgeProvider>
    );
    await screen.findByText("hi");
    expect(screen.getByTestId("timeline-content")).toHaveClass("space-y-3", "max-w-[900px]", "xl:max-w-[960px]");
    mockScrolledUp(container);

    expect(await screen.findByLabelText("回到底部")).toBeInTheDocument();
    expect(screen.queryByText(/有个问题等你回答/)).not.toBeInTheDocument();
  });

  it("shows the labeled pill instead of BackToBottom when a question is pending and scrolled up", async () => {
    const client = new FixtureBridgeClient();
    const { container } = render(
      <BridgeProvider client={client}>
        <Seeder client={client} askPayload={ASK_PAYLOAD} />
      </BridgeProvider>
    );
    await screen.findByText("hi");
    await screen.findByText("选择环境？");
    mockScrolledUp(container);

    expect(await screen.findByText(/有个问题等你回答/)).toBeInTheDocument();
    expect(screen.queryByLabelText("回到底部")).not.toBeInTheDocument();
  });

  it("shows neither when already at the bottom, even with a pending question", async () => {
    const client = new FixtureBridgeClient();
    render(
      <BridgeProvider client={client}>
        <Seeder client={client} askPayload={ASK_PAYLOAD} />
      </BridgeProvider>
    );
    await screen.findByText("选择环境？");
    // No mockScrolledUp() call — jsdom's default zeroed-out geometry means
    // atBottom stays true, so neither affordance should render.
    expect(screen.queryByLabelText("回到底部")).not.toBeInTheDocument();
    expect(screen.queryByText(/有个问题等你回答/)).not.toBeInTheDocument();
  });

  it("keeps a newly pending question in view while following the bottom", async () => {
    const client = new FixtureBridgeClient({ chunkDelayMs: 100_000 });
    const { container } = render(
      <BridgeProvider client={client}>
        <DeferredAskSeeder client={client} />
      </BridgeProvider>
    );
    await screen.findByText("hi");

    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
    let scrollHeight = 2_000;
    Object.defineProperty(scrollEl, "scrollHeight", { get: () => scrollHeight, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 1_500, configurable: true, writable: true });
    fireEvent.scroll(scrollEl);

    scrollHeight = 2_200;
    fireEvent.click(screen.getByRole("button", { name: "emit pending question" }));
    await screen.findByText("选择环境？");

    expect(scrollEl.scrollTop).toBe(2_200);
  });

  it("keeps the visible edge pinned when the timeline layout resizes", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let notifyResize: (() => void) | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      value: TestResizeObserver,
      configurable: true,
      writable: true,
    });

    try {
      const client = new FixtureBridgeClient({ chunkDelayMs: 100_000 });
      const { container } = render(
        <BridgeProvider client={client}>
          <DeferredAskSeeder client={client} />
        </BridgeProvider>
      );
      await screen.findByText("hi");

      const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
      let scrollHeight = 2_000;
      Object.defineProperty(scrollEl, "scrollHeight", { get: () => scrollHeight, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 500, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", { value: 1_500, configurable: true, writable: true });
      fireEvent.scroll(scrollEl);

      scrollHeight = 2_200;
      notifyResize?.();

      expect(scrollEl.scrollTop).toBe(2_200);
    } finally {
      Object.defineProperty(globalThis, "ResizeObserver", {
        value: originalResizeObserver,
        configurable: true,
        writable: true,
      });
    }
  });
});
