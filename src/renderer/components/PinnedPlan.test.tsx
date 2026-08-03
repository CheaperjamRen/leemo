import { useEffect } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BridgeProvider, useConversations } from "../bridge/context";
import PinnedPlan from "./PinnedPlan";
import type { BridgeClient } from "../bridge/client";
import type { BridgeEventEnvelope } from "../../bridge/contract";

function seededPlanClient(): BridgeClient & { emitPlan(): void; emitFinished(): void } {
  let callback: ((event: BridgeEventEnvelope) => void) | undefined;
  return {
    invoke: async (channel) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-plan" } as never;
      return undefined as never;
    },
    subscribe: (channel, cb) => {
      if (channel === "bridge:event") callback = cb as unknown as (event: BridgeEventEnvelope) => void;
      return () => {};
    },
    emitPlan: () => callback?.({
      conversationId: "conv-plan",
      event: {
        type: "tool.started", toolUseId: "p1", name: "TodoWrite", subagent: false,
        input: { todos: [
          { content: "提取 pptx", status: "completed" },
          { content: "生成草稿", status: "in_progress" },
        ] },
      },
    }),
    emitFinished: () => callback?.({
      conversationId: "conv-plan",
      event: {
        type: "run.finished",
        subtype: "success",
        isError: false,
        finalText: "草稿好了",
        pathAudit: { claimed: [] },
      },
    }),
  } as BridgeClient & { emitPlan(): void; emitFinished(): void };
}

function PlanSeeder({ client }: { client: ReturnType<typeof seededPlanClient> }) {
  const createConversation = useConversations((state) => state.createConversation);
  useEffect(() => {
    void createConversation({ source: "buddy" }).then(() => client.emitPlan());
  }, [client, createConversation]);
  return <PinnedPlan />;
}

describe("PinnedPlan", () => {
  it("renders nothing when there is no active conversation", () => {
    const noPlan = { invoke: async () => undefined as never, subscribe: () => () => {} } as BridgeClient;
    const { container } = render(<BridgeProvider client={noPlan}><PinnedPlan /></BridgeProvider>);
    expect(container.textContent).not.toMatch(/当前任务/);
  });

  it("shows the active conversation's seeded latest plan and expands its todos", async () => {
    const client = seededPlanClient();
    render(<BridgeProvider client={client}><PlanSeeder client={client} /></BridgeProvider>);

    expect(await screen.findByText(/当前任务/)).toBeInTheDocument();
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("生成草稿")).toBeInTheDocument();
  });

  it("hides the pinned current-task plan as soon as that run finishes", async () => {
    const client = seededPlanClient();
    render(<BridgeProvider client={client}><PlanSeeder client={client} /></BridgeProvider>);

    expect(await screen.findByText(/当前任务/)).toBeInTheDocument();
    act(() => client.emitFinished());
    expect(screen.queryByText(/当前任务/)).not.toBeInTheDocument();
  });
});
