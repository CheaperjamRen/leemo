import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BridgeProvider, useConversations } from "../../bridge/context";
import Timeline from "./Timeline";
import type { BridgeClient } from "../../bridge/client";
import type { BridgeEventEnvelope } from "../../../bridge/contract";

function timelineClient(): BridgeClient & { emit(envelope: BridgeEventEnvelope): void } {
  let callback: ((envelope: BridgeEventEnvelope) => void) | undefined;
  let sequence = 0;
  return {
    invoke: async (channel) => {
      if (channel === "bridge:createConversation") return { conversationId: `conv-${++sequence}` } as never;
      return undefined as never;
    },
    subscribe: (channel, cb) => {
      if (channel === "bridge:event") callback = cb as unknown as (envelope: BridgeEventEnvelope) => void;
      return () => {};
    },
    emit: (envelope) => callback?.(envelope),
  } as BridgeClient & { emit(envelope: BridgeEventEnvelope): void };
}

function TimelineSeeder({ client }: { client: ReturnType<typeof timelineClient> }) {
  const createConversation = useConversations((state) => state.createConversation);
  const send = useConversations((state) => state.send);
  const switchActive = useConversations((state) => state.switchActive);
  useEffect(() => {
    void (async () => {
      const a = await createConversation({ source: "buddy" });
      const b = await createConversation({ source: "buddy" });
      await send(a, "A prompt");
      await send(b, "B prompt");
      client.emit({ conversationId: a, event: { type: "text.final", text: "A reply" } });
      client.emit({ conversationId: b, event: { type: "text.final", text: "B reply" } });
      switchActive(a);
    })();
  }, [client, createConversation, send, switchActive]);
  return <Timeline />;
}

describe("Timeline groups items into per-run TurnBlocks", () => {
  it("renders safely when no conversation is active", () => {
    const { container } = render(
      <BridgeProvider client={timelineClient()}>
        <Timeline />
      </BridgeProvider>,
    );
    expect(container.querySelector("*")).toBeTruthy();
    expect(screen.queryByText(/复制/)).not.toBeInTheDocument();
  });

  it("renders only the active conversation timeline after an active switch", async () => {
    const client = timelineClient();
    render(<BridgeProvider client={client}><TimelineSeeder client={client} /></BridgeProvider>);

    expect(await screen.findByText("A reply")).toBeInTheDocument();
    expect(screen.queryByText("B reply")).not.toBeInTheDocument();
  });
});
