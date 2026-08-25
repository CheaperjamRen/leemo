import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  normalizeSdkStream,
  buildUsageRecord,
  auditClaimedPaths,
  type LeemoEvent,
} from "../../src/bridge/events";
import {
  fullTurnStream,
  resultWithSdkCost,
  resultWithEstimatedUsage,
  resultUnpriced,
  resultError,
  type TestMsgB2,
} from "./fixtures/sdk-messages";

// B2 Step 1 — SDK message stream → LeemoEvent normalization.
//
// Every fixture message shape here is sourced from smoke/checks.mjs (the real
// harness) + the SDK d.ts files. Assertions
// check real field values (not truthiness) so this suite actually pins the
// mapping, not just "some event came out".

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function fakeStream(msgs: TestMsgB2[]): AsyncIterable<TestMsgB2> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of msgs) yield m;
    },
  };
}

const CWD = path.resolve(__dirname, "fixtures"); // a real dir, guaranteed to exist

describe("normalizeSdkStream — event-by-event mapping", () => {
  it("surfaces a native Claude retry without replaying or ending the stream", async () => {
    const messages = [
      {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 5,
        retry_delay_ms: 250,
        error_status: null,
        error: "Bearer test-key-secret-1234567890",
        session_id: "session-retry",
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "继续输出" } },
        session_id: "session-retry",
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "继续输出",
        session_id: "session-retry",
      },
    ] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events[0]).toEqual({
      type: "stream.retry",
      attempt: 1,
      maxAttempts: 5,
      summary: "正在重新连接 1/5",
      detail: "Bearer [已隐藏] · 连接错误 · 250ms 后重试",
      scope: "connection",
    });
    expect(events).toContainEqual({ type: "text.delta", text: "继续输出" });
    expect(events.at(-1)).toMatchObject({ type: "run.finished", isError: false, finalText: "继续输出" });
  });

  it("maps the full realistic stream to the expected LeemoEvent sequence, in order", async () => {
    const finalText = "Done. See leemo.config.json for the result.";
    const msgs = fullTurnStream({
      sessionId: "sess-abc",
      toolUseId: "toolu_top_001",
      subagentToolUseId: "toolu_parent_777",
      finalText,
    });

    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        cwd: CWD,
      })
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "conversation.started",
      "text.delta",
      "text.delta",
      "thinking.delta",
      "tool.started",
      "tool.finished",
      "subagent.activity", // from the parent-tagged assistant msg
      "tool.started", // the inner Agent tool_use, subagent=true
      "subagent.activity", // from the parent-tagged user msg
      "tool.finished", // the inner tool_result, isError=true
      "compact.boundary",
      "usage.final",
      "text.final",
      "run.finished",
    ]);
  });

  it("conversation.started carries the init session_id", async () => {
    const msgs = fullTurnStream({
      sessionId: "sess-xyz-999",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const [first] = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    expect(first).toEqual({ type: "conversation.started", sessionId: "sess-xyz-999" });
  });

  it("text.delta concatenated equals the streamed text_delta fragments, in order", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const deltas = events.filter((e) => e.type === "text.delta") as Array<{ type: "text.delta"; text: string }>;
    expect(deltas.map((d) => d.text)).toEqual(["Look", "ing"]);
  });

  it("thinking.delta carries the thinking_delta text", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const thinking = events.find((e) => e.type === "thinking.delta") as { type: "thinking.delta"; text: string };
    expect(thinking.text).toBe("considering the file");
  });

  it("tool.started maps name/input/toolUseId and subagent=false for a top-level tool_use", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "toolu_top_001",
      subagentToolUseId: "toolu_parent_777",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const started = events.filter((e) => e.type === "tool.started") as Array<{
      type: "tool.started";
      toolUseId: string;
      name: string;
      input: unknown;
      subagent: boolean;
    }>;
    expect(started[0]).toEqual({
      type: "tool.started",
      toolUseId: "toolu_top_001",
      name: "Read",
      input: { file_path: "leemo.config.json" },
      subagent: false,
    });
  });

  it("tool.started for the parent_tool_use_id-tagged assistant message has subagent=true and name 'Agent'", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "toolu_top_001",
      subagentToolUseId: "toolu_parent_777",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const started = events.filter((e) => e.type === "tool.started") as Array<{
      type: "tool.started";
      toolUseId: string;
      name: string;
      subagent: boolean;
    }>;
    expect(started[1]).toEqual({
      type: "tool.started",
      toolUseId: "toolu_sub_inner_001",
      name: "Agent",
      subagent: true,
      input: { description: "sub-task" },
      parentToolUseId: "toolu_parent_777",
    });
  });

  it("tool.finished maps isError and toolUseId for both top-level and subagent tool_results", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "toolu_top_001",
      subagentToolUseId: "toolu_parent_777",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const finished = events.filter((e) => e.type === "tool.finished") as Array<{
      type: "tool.finished";
      toolUseId: string;
      isError: boolean;
    }>;
    expect(finished[0].toolUseId).toBe("toolu_top_001");
    expect(finished[0].isError).toBe(false);
    expect(finished[1].toolUseId).toBe("toolu_sub_inner_001");
    expect(finished[1].isError).toBe(true);
  });

  it("keeps binary image payloads and oversized tool output out of persisted summaries", async () => {
    const base64 = "A".repeat(120_000);
    const messages = [{
      type: "user",
      session_id: "s-binary",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "screenshot-1",
          content: [
            { type: "text", text: `saved ${"x".repeat(20_000)}` },
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
          ],
        }],
      },
    }] as TestMsgB2[];

    const events = await drain(
      normalizeSdkStream(fakeStream(messages), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD }),
    );
    const finished = events.find((event) => event.type === "tool.finished");

    expect(finished).toMatchObject({ type: "tool.finished", toolUseId: "screenshot-1", isError: false });
    if (!finished || finished.type !== "tool.finished") throw new Error("missing tool.finished");
    expect(finished.contentSummary).toContain("[120000 base64 characters omitted]");
    expect(finished.contentSummary).not.toContain(base64.slice(0, 2_000));
    expect(finished.contentSummary.length).toBeLessThanOrEqual(12_020);
    expect(finished.contentSummary).toMatch(/output truncated/);
  });

  it("projects a browser screenshot as a bounded capture id without persisting image bytes", async () => {
    const browserOutputDir = path.join(CWD, ".leemo-browser-output");
    const capturePath = path.join(browserOutputDir, "page-2026-08-03T01-56-47-363Z.png");
    const base64 = "A".repeat(20_000);
    const messages = [{
      type: "user",
      session_id: "s-browser-capture",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "screenshot-visible",
          content: [
            { type: "text", text: `### Result\n- [Screenshot of viewport](${capturePath})` },
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
          ],
        }],
      },
    }] as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      cwd: CWD,
      browserOutputDir,
    }));
    const finished = events.find((event) => event.type === "tool.finished");

    expect(finished).toMatchObject({
      type: "tool.finished",
      browserCapture: { id: "page-2026-08-03T01-56-47-363Z.png", mimeType: "image/png" },
    });
    expect(JSON.stringify(finished)).not.toContain(base64.slice(0, 2_000));
    expect(JSON.stringify(finished)).not.toContain(browserOutputDir);
  });

  it("projects Playwright's link-only screenshot result without requiring an inline image block", async () => {
    const browserOutputDir = path.join(CWD, ".leemo-browser-output");
    const capturePath = path.join(browserOutputDir, "page-link-only.jpeg");
    const messages = [{
      type: "user",
      session_id: "s-browser-link-only",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "screenshot-link-only",
          content: [
            { type: "text", text: `[Screenshot of viewport](${capturePath})` },
          ],
        }],
      },
    }] as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      cwd: CWD,
      browserOutputDir,
    }));

    expect(events.find((event) => event.type === "tool.finished")).toMatchObject({
      type: "tool.finished",
      browserCapture: { id: "page-link-only.jpeg", mimeType: "image/jpeg" },
    });
  });

  it("does not expose a named workspace screenshot through the private capture channel", async () => {
    const browserOutputDir = path.join(CWD, ".leemo-browser-output");
    const messages = [{
      type: "user",
      session_id: "s-browser-workspace-shot",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "workspace-screenshot",
          content: [
            { type: "text", text: "[Screenshot of viewport](./named-proof.png)" },
          ],
        }],
      },
    }] as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      cwd: CWD,
      browserOutputDir,
    }));
    const finished = events.find((event) => event.type === "tool.finished");

    expect(finished).toMatchObject({ type: "tool.finished", toolUseId: "workspace-screenshot" });
    expect(finished).not.toHaveProperty("browserCapture");
  });

  it("subagent.activity carries the parentToolUseId", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "toolu_parent_777",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const activity = events.filter((e) => e.type === "subagent.activity") as Array<{
      type: "subagent.activity";
      parentToolUseId: string;
    }>;
    expect(activity).toHaveLength(2);
    expect(activity[0].parentToolUseId).toBe("toolu_parent_777");
    expect(activity[1].parentToolUseId).toBe("toolu_parent_777");
  });

  it("forwards subagent text and thinking under the exact parent tool", async () => {
    const msgs = [{
      type: "assistant",
      session_id: "s1",
      parent_tool_use_id: "agent-parent-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先定位失败测试" },
          { type: "text", text: "发现是路径断言写错了。" },
        ],
      },
    }] as TestMsgB2[];

    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD }),
    );

    expect(events).toEqual([
      { type: "subagent.activity", parentToolUseId: "agent-parent-1" },
      { type: "subagent.output", parentToolUseId: "agent-parent-1", kind: "thinking", text: "先定位失败测试" },
      { type: "subagent.output", parentToolUseId: "agent-parent-1", kind: "text", text: "发现是路径断言写错了。" },
    ]);
  });

  it("keeps the parent id on subagent tool start and finish events", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "top",
      subagentToolUseId: "agent-parent-2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD }),
    );
    const childStart = events.find((event) => event.type === "tool.started" && event.subagent);
    const childFinish = events.find((event) => event.type === "tool.finished" && event.parentToolUseId);

    expect(childStart).toMatchObject({ parentToolUseId: "agent-parent-2" });
    expect(childFinish).toMatchObject({ parentToolUseId: "agent-parent-2" });
  });

  it("compact.boundary passes pre_tokens/post_tokens/trigger through as numbers, unmodified", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const boundary = events.find((e) => e.type === "compact.boundary") as {
      type: "compact.boundary";
      trigger: string;
      preTokens: number;
      postTokens: number;
    };
    expect(boundary).toEqual({
      type: "compact.boundary",
      trigger: "auto",
      preTokens: 154000,
      postTokens: 12000,
    });
  });

  it("text.final takes result.result verbatim (the authoritative final text, not the streamed deltas)", async () => {
    const finalText = "The authoritative final answer, not 'Looking'.";
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText,
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      finalText: string;
    };
    expect(runFinished.finalText).toBe(finalText);
  });

  it("run.finished carries subtype and isError from the result message", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      subtype: string;
      isError: boolean;
    };
    expect(runFinished.subtype).toBe("success");
    expect(runFinished.isError).toBe(false);
  });

  // 轮 2 卡 C — the renderer needs the session id to persist it, and the only
  // channel that already crosses per round is run.finished. Adding an optional
  // field there beats opening a new event/channel.
  it("run.finished carries the round's sessionId so the renderer can persist it", async () => {
    const msgs = fullTurnStream({
      sessionId: "sess-persist-me",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      sessionId?: string;
    };
    expect(runFinished.sessionId).toBe("sess-persist-me");
  });

  it("falls back to the session id seen earlier in the stream when the result message omits it", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "sess-from-init" },
      { type: "result", subtype: "success", result: "done", is_error: false },
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      sessionId?: string;
    };
    expect(runFinished.sessionId).toBe("sess-from-init");
  });

  it("omits sessionId entirely when no message in the stream carried one", async () => {
    const msgs: TestMsgB2[] = [
      { type: "result", subtype: "success", result: "done", is_error: false },
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      sessionId?: string;
    };
    expect(runFinished.sessionId).toBeUndefined();
  });

  it("usage.final wraps a UsageRecord built from result.usage", async () => {
    const msgs = fullTurnStream({
      sessionId: "s1",
      toolUseId: "t1",
      subagentToolUseId: "t2",
      finalText: "ok",
    });
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      type: "usage.final";
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
    };
    expect(usageFinal.usage.inputTokens).toBe(1000);
    expect(usageFinal.usage.outputTokens).toBe(200);
    expect(usageFinal.usage.cacheCreationTokens).toBe(50);
    expect(usageFinal.usage.cacheReadTokens).toBe(10);
  });

  it("result:error stream still yields run.finished(isError=true) and an error event carrying the message", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s-err", model: "x" },
      resultError("s-err", "execution failed: boom"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      isError: boolean;
      subtype: string;
    };
    expect(runFinished.isError).toBe(true);
    expect(runFinished.subtype).toBe("error_during_execution");

    const errorEvent = events.find((e) => e.type === "error") as { type: "error"; message: string };
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toBe("execution failed: boom");
  });

  it("turns an SDK-branded provider failure into one Leemo-facing error", async () => {
    async function* failedProviderStream(): AsyncIterable<TestMsgB2> {
      yield resultError("s-provider-error", "API Error: 400 upstream provider error (400)");
      throw new Error(
        "Claude Code returned an error result: API Error: 400 upstream provider error (400)",
      );
    }

    const events = await drain(
      normalizeSdkStream(failedProviderStream(), {
        providerId: "custom-provider",
        modelId: "mock-beta",
        cwd: CWD,
      }),
    );

    const visibleContent = events.filter((event) => event.type === "error" || event.type === "text.final");
    expect(visibleContent).toEqual([{
      type: "error",
      message: "服务商返回错误（400）。请检查模型配置、接口地址或额度后重试。",
    }]);
    expect(JSON.stringify(events)).not.toMatch(/Claude Code|API Error/i);
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      subtype: "error",
      isError: true,
      finalText: "",
    });
  });

  it("does not finish at an intermediate result while a background subagent stream is still open", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    async function* backgroundAgentStream(): AsyncIterable<TestMsgB2> {
      yield { type: "result", subtype: "success", result: "子 agent 已派出，等它完成", is_error: false };
      await gate;
      yield { type: "result", subtype: "success", result: "子 agent 最终结论", is_error: false };
    }

    const iterator = normalizeSdkStream(backgroundAgentStream(), {
      providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD,
    })[Symbol.asyncIterator]();
    let settled = false;
    const first = iterator.next().then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    const events: LeemoEvent[] = [];
    const firstValue = await first;
    if (!firstValue.done) events.push(firstValue.value);
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(events.filter((event) => event.type === "run.finished")).toEqual([
      expect.objectContaining({ type: "run.finished", finalText: "子 agent 最终结论" }),
    ]);
    expect(events.filter((event) => event.type === "text.final")).toEqual([
      { type: "text.final", text: "子 agent 最终结论" },
    ]);
  });

  it("an exception thrown BY the underlying iterable surfaces as error + terminal event, not a stuck run", async () => {
    const boom = new Error("upstream socket reset");
    async function* throwingStream(): AsyncIterable<TestMsgB2> {
      yield { type: "system", subtype: "init", session_id: "s-throw", model: "x" };
      throw boom;
    }
    const events = await drain(
      normalizeSdkStream(throwingStream(), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    expect(events[0]).toEqual({ type: "conversation.started", sessionId: "s-throw" });
    expect(events.at(-2)).toEqual({ type: "error", message: "upstream socket reset" });
    expect(events.at(-1)).toMatchObject({ type: "run.finished", isError: true, subtype: "error" });
  });

  it("an exception of a non-Error shape (e.g. a thrown string) still yields a string message via String(e), never throws", async () => {
    async function* throwingStream(): AsyncIterable<TestMsgB2> {
      // eslint-disable-next-line no-throw-literal
      throw "raw string rejection";
    }
    const events = await drain(
      normalizeSdkStream(throwingStream(), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    expect(events).toEqual([
      { type: "error", message: "raw string rejection" },
      expect.objectContaining({ type: "run.finished", isError: true, subtype: "error" }),
    ]);
  });

  it("malformed stream_event (unexpected delta shape) is skipped defensively, not thrown", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s-def", model: "x" },
      { type: "stream_event", session_id: "s-def", event: { type: "content_block_delta", delta: { type: "unknown_delta_kind" } } },
      { type: "stream_event", session_id: "s-def", event: {} },
      { type: "stream_event", session_id: "s-def", event: undefined },
      resultUnpriced("s-def", "done"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    // no throw, and no text.delta/thinking.delta were fabricated from garbage
    expect(events.some((e) => e.type === "text.delta" || e.type === "thinking.delta")).toBe(false);
    expect(events.some((e) => e.type === "run.finished")).toBe(true);
  });

  it("pathAudit on run.finished flags an existing in-cwd path, a missing in-cwd path, and an out-of-cwd path", async () => {
    const existing = path.join(CWD, "sdk-messages.ts"); // real file in fixtures/
    const missing = path.join(CWD, "does-not-exist-xyz.ts");
    const outside = process.platform === "win32" ? "E:\\Users\\ghost\\made-up-dir" : "/root/made-up-dir";
    // Keep an explicit write claim next to every path. Worktree roots can be
    // long enough that one verb at the start falls outside the auditor's
    // deliberately bounded context window for the final path.
    const finalText = `已写入 \`${existing}\`。已写入 \`${missing}\`。已写入 \`${outside}\`。`;
    const msgs = fullTurnStream({ sessionId: "s1", toolUseId: "t1", subagentToolUseId: "t2", finalText });

    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const runFinished = events.find((e) => e.type === "run.finished") as {
      type: "run.finished";
      pathAudit: { claimed: Array<{ path: string; exists: boolean; withinCwd: boolean }> };
    };
    const claims = runFinished.pathAudit.claimed;
    const existingClaim = claims.find((c) => c.path === existing);
    const missingClaim = claims.find((c) => c.path === missing);
    const outsideClaim = claims.find((c) => c.path === outside);

    expect(existingClaim).toEqual({ path: existing, exists: true, withinCwd: true, writeClaim: true });
    expect(missingClaim).toEqual({ path: missing, exists: false, withinCwd: true, writeClaim: true });
    expect(outsideClaim?.exists).toBe(false);
    expect(outsideClaim?.withinCwd).toBe(false);
  });
});

describe("normalizeSdkStream — Claude Agent SDK 0.3.227 structured status", () => {
  const resultUsage = {
    input_tokens: 80,
    output_tokens: 12,
    cache_read_input_tokens: 20,
    cache_creation_input_tokens: 5,
  };

  it("classifies an exhausted 529 as retryable overload without exposing SDK wording", async () => {
    const messages = [{
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      api_error_status: 529,
      errors: ["API Error: 529 overloaded_error"],
      result: "",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [],
      session_id: "status-529",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events).toContainEqual({
      type: "error",
      message: "服务商当前过载（529）。自动重试仍未恢复，请稍后重试或换一个模型。",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      outcome: "overloaded",
      retryable: true,
      statusCode: 529,
      isError: true,
    });
    expect(JSON.stringify(events)).not.toMatch(/Claude Code|overloaded_error|API Error/i);
  });

  it("does not turn a recovered api_error_status on a success result into a failed run", async () => {
    const messages = [{
      type: "result",
      subtype: "success",
      is_error: false,
      api_error_status: 429,
      result: "已经恢复并完成。",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [],
      session_id: "recovered-429",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events).toContainEqual({ type: "text.final", text: "已经恢复并完成。" });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      outcome: "completed",
      retryable: false,
      statusCode: 429,
      isError: false,
    });
  });

  it("treats an aborted assistant frame as cancellation and never publishes truncated text as final", async () => {
    const messages = [
      {
        type: "assistant",
        aborted: true,
        message: { role: "assistant", content: [{ type: "text", text: "截断到一半" }] },
        session_id: "aborted-frame",
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "截断到一半",
        usage: resultUsage,
        modelUsage: {},
        permission_denials: [],
        session_id: "aborted-frame",
      },
    ] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events.some((event) => event.type === "text.final")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      subtype: "interrupted",
      outcome: "cancelled",
      isError: false,
      finalText: "",
    });
  });

  it("projects permission denials once while allowing an otherwise successful run to stay successful", async () => {
    const denial = { tool_name: "Bash", tool_use_id: "tool-denied", tool_input: { command: "rm file" } };
    const messages = [
      {
        type: "system",
        subtype: "permission_denied",
        tool_name: denial.tool_name,
        tool_use_id: denial.tool_use_id,
        message: "用户未允许这项操作。",
        decision_reason_type: "mode",
        session_id: "permission-denied",
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "我没有执行被拒绝的操作，其余检查已完成。",
        usage: resultUsage,
        modelUsage: {},
        permission_denials: [denial],
        session_id: "permission-denied",
      },
    ] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events.filter((event) => event.type === "tool.finished" && event.toolUseId === "tool-denied")).toEqual([{
      type: "tool.finished",
      toolUseId: "tool-denied",
      isError: true,
      outcome: "denied",
      contentSummary: "用户未允许这项操作。",
    }]);
    expect(events.at(-1)).toMatchObject({ type: "run.finished", outcome: "completed", isError: false });
  });

  it("uses result.permission_denials as the authoritative fallback when no advisory event arrived", async () => {
    const messages = [{
      type: "result",
      subtype: "success",
      is_error: false,
      result: "其余操作已完成。",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [{ tool_name: "Write", tool_use_id: "result-denied", tool_input: { file_path: "a.md" } }],
      session_id: "result-denial",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events).toContainEqual({
      type: "tool.finished",
      toolUseId: "result-denied",
      isError: true,
      outcome: "denied",
      contentSummary: "未获允许：Write",
    });
    expect(events.at(-1)).toMatchObject({ outcome: "completed", isError: false });
  });

  it("uses a defensive tool_result_meta sidecar to distinguish non-execution from an ordinary tool error", async () => {
    const messages = [{
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "保留的用户说明" },
          { type: "tool_result", tool_use_id: "tool-cancelled", content: "未执行", is_error: true },
        ],
      },
      tool_result_meta: [{
        id: "tool-cancelled",
        non_execution_kind: "cancelled",
        user_feedback: "用户取消了这项操作。",
      }],
      session_id: "tool-meta",
    }, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "已跳过取消的操作。",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [],
      session_id: "tool-meta",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events).toContainEqual({
      type: "tool.finished",
      toolUseId: "tool-cancelled",
      isError: true,
      outcome: "cancelled",
      contentSummary: "未执行",
      userFeedback: "用户取消了这项操作。",
    });
  });

  it("maps a user-rejected tool result to denied instead of a tool failure", async () => {
    const messages = [{
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-rejected", content: "操作未执行", is_error: true }],
      },
      tool_result_meta: [{ id: "tool-rejected", non_execution_kind: "user-rejected" }],
      session_id: "tool-rejected-session",
    }, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "已保留现有内容。",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [],
      session_id: "tool-rejected-session",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.finished",
      toolUseId: "tool-rejected",
      outcome: "denied",
    }));
  });

  it("keeps subagent retry status separate from the main connection retry", async () => {
    const messages = [{
      type: "tool_progress",
      tool_use_id: "agent-tool",
      tool_name: "Agent",
      subagent_retry: {
        agent_id: "agent-a",
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 500,
        error_status: 529,
        error_category: "overloaded",
      },
      session_id: "agent-retry",
    }, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "子任务恢复后完成。",
      usage: resultUsage,
      modelUsage: {},
      permission_denials: [],
      session_id: "agent-retry",
    }] as unknown as TestMsgB2[];

    const events = await drain(normalizeSdkStream(fakeStream(messages), {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      cwd: CWD,
    }));

    expect(events[0]).toEqual({
      type: "stream.retry",
      scope: "subagent",
      retryId: "agent-a",
      attempt: 2,
      maxAttempts: 5,
      summary: "子任务正在重试 2/5",
      detail: "HTTP 529 · overloaded · 500ms 后重试",
    });
  });

  it("treats modelUsage as this query lifecycle's full accounting instead of diffing across resumed rounds", async () => {
    const result = (mainInput: number, mainOutput: number, mainCost: number) => ({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "完成",
      usage: resultUsage,
      modelUsage: {
        "claude-alias": {
          inputTokens: mainInput,
          outputTokens: mainOutput,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 5,
          webSearchRequests: 0,
          costUSD: mainCost,
          contextWindow: 200_000,
          maxOutputTokens: 16_000,
          canonicalModel: "claude-sonnet-4-6",
          provider: "firstParty",
        },
        "claude-haiku-helper": {
          inputTokens: 50,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.02,
          contextWindow: 200_000,
          maxOutputTokens: 8_000,
          provider: "firstParty",
        },
      },
      permission_denials: [],
      session_id: "usage-cumulative",
    });
    const ctx = { providerId: "anthropic", modelId: "claude-alias", cwd: CWD };

    const first = await drain(normalizeSdkStream(fakeStream([result(100, 20, 0.10)] as unknown as TestMsgB2[]), ctx));
    const second = await drain(normalizeSdkStream(fakeStream([result(150, 30, 0.15)] as unknown as TestMsgB2[]), ctx));
    const usageOf = (events: LeemoEvent[]) => events.find((event) => event.type === "usage.final") as Extract<LeemoEvent, { type: "usage.final" }>;

    expect(usageOf(first).usage).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      costUsd: "0.120000",
      contextInputTokens: 80,
      modelBreakdown: [
        expect.objectContaining({ modelId: "claude-sonnet-4-6", inputTokens: 100, costUsd: "0.100000" }),
        expect.objectContaining({ modelId: "claude-haiku-helper", inputTokens: 50, costUsd: "0.020000" }),
      ],
    });
    expect(usageOf(second).usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 40,
      costUsd: "0.170000",
      modelBreakdown: [
        expect.objectContaining({ modelId: "claude-sonnet-4-6", inputTokens: 150 }),
        expect.objectContaining({ modelId: "claude-haiku-helper", inputTokens: 50 }),
      ],
    });
    expect(usageOf(second).usage.modelBreakdown).toHaveLength(2);
  });

  it("normalizes an exact SDK context snapshot independently from billing usage", async () => {
    const events = await drain(normalizeSdkStream(fakeStream([{
      type: "leemo_context_snapshot",
      session_id: "context-1",
      contextUsage: {
        totalTokens: 87_450,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 43.725,
        model: "kimi-k3",
        isAutoCompactEnabled: true,
        autoCompactThreshold: 180_000,
      },
    }] as unknown as TestMsgB2[]), {
      providerId: "kimi",
      modelId: "kimi-k3",
      cwd: CWD,
    }));

    expect(events).toEqual([{
      type: "context.snapshot",
      currentTokens: 87_450,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 180_000,
      isAutoCompactEnabled: true,
      model: "kimi-k3",
    }]);
  });
});

describe("normalizeSdkStream — cost / estimated branches via ctx.pricing", () => {
  const pricing = { inputPerMTok: 0.14, outputPerMTok: 0.28, cacheReadPerMTok: 0.0028 };

  it("costSource='sdk' when result.total_cost_usd > 0, formatted to 6 decimals", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s1", model: "x" },
      resultWithSdkCost("s1", "ok"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD, pricing })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      usage: { costUsd?: string; costSource: string; tokensEstimated: boolean };
    };
    expect(usageFinal.usage.costSource).toBe("sdk");
    expect(usageFinal.usage.costUsd).toBe("0.123456");
    expect(usageFinal.usage.tokensEstimated).toBe(false);
  });

  it("costSource='local-pricing' when no sdk cost but a pricing-table hit, using the NewMax formula", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s1", model: "x" },
      resultUnpriced("s1", "ok"), // input=10, output=5, cache=0, total_cost_usd=0
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD, pricing })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      usage: { costUsd?: string; costSource: string };
    };
    // (10*0.14 + 5*0.28 + 0*0.0028) / 1_000_000 = (1.4 + 1.4) / 1e6 = 0.0000028
    expect(usageFinal.usage.costSource).toBe("local-pricing");
    expect(usageFinal.usage.costUsd).toBe((2.8 / 1_000_000).toFixed(6));
  });

  it("costSource='unpriced' when no sdk cost and no pricing-table entry (ctx.pricing omitted)", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s1", model: "x" },
      resultUnpriced("s1", "ok"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      usage: { costUsd?: string; costSource: string };
    };
    expect(usageFinal.usage.costSource).toBe("unpriced");
    expect(usageFinal.usage.costUsd).toBeUndefined();
  });

  it("tokensEstimated=true when usage.leemo_estimated===true", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s1", model: "x" },
      resultWithEstimatedUsage("s1", "ok"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD, pricing })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      usage: { tokensEstimated: boolean };
    };
    expect(usageFinal.usage.tokensEstimated).toBe(true);
  });

  it("tokensEstimated=false when usage.leemo_estimated is absent", async () => {
    const msgs: TestMsgB2[] = [
      { type: "system", subtype: "init", session_id: "s1", model: "x" },
      resultUnpriced("s1", "ok"),
    ];
    const events = await drain(
      normalizeSdkStream(fakeStream(msgs), { providerId: "deepseek", modelId: "deepseek-chat", cwd: CWD, pricing })
    );
    const usageFinal = events.find((e) => e.type === "usage.final") as {
      usage: { tokensEstimated: boolean };
    };
    expect(usageFinal.usage.tokensEstimated).toBe(false);
  });
});

describe("buildUsageRecord — direct unit tests (no stream)", () => {
  const ctx = { providerId: "deepseek", modelId: "deepseek-chat" };

  it("fills every UsageRecord field from a raw usage object plus result metadata", () => {
    const rec = buildUsageRecord(
      {
        input_tokens: 7,
        output_tokens: 3,
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: 2,
      },
      { ...ctx, totalCostUsd: 0, durationMs: 42 }
    );
    expect(rec.providerId).toBe("deepseek");
    expect(rec.modelId).toBe("deepseek-chat");
    expect(rec.inputTokens).toBe(7);
    expect(rec.outputTokens).toBe(3);
    expect(rec.cacheCreationTokens).toBe(1);
    expect(rec.cacheReadTokens).toBe(2);
    expect(rec.durationMs).toBe(42);
    expect(rec.costSource).toBe("unpriced");
  });

  it("missing numeric usage fields default to 0, not NaN/undefined", () => {
    const rec = buildUsageRecord({}, ctx);
    expect(rec.inputTokens).toBe(0);
    expect(rec.outputTokens).toBe(0);
    expect(rec.cacheReadTokens).toBe(0);
    expect(rec.cacheCreationTokens).toBe(0);
  });
});

describe("auditClaimedPaths — unit tests with injected existsSyncFn", () => {
  it("flags an existing path within cwd as exists:true, withinCwd:true", () => {
    const audit = auditClaimedPaths("已写入 `/work/proj/readme.md`", "/work/proj", (p) => p === "/work/proj/readme.md");
    expect(audit.claimed).toEqual([{ path: "/work/proj/readme.md", exists: true, withinCwd: true, writeClaim: true }]);
  });

  it("flags a non-existent path within cwd as exists:false, withinCwd:true", () => {
    const audit = auditClaimedPaths("已写入 `/work/proj/ghost.md`", "/work/proj", () => false);
    expect(audit.claimed).toEqual([{ path: "/work/proj/ghost.md", exists: false, withinCwd: true, writeClaim: true }]);
  });

  it("flags a path outside cwd as withinCwd:false (Phase 0 escape signal), regardless of existsSyncFn", () => {
    const audit = auditClaimedPaths("已写入 `/etc/passwd`", "/work/proj", () => true);
    expect(audit.claimed).toEqual([{ path: "/etc/passwd", exists: true, withinCwd: false, writeClaim: true }]);
  });

  it("extracts Windows-style absolute paths too", () => {
    const audit = auditClaimedPaths("wrote to `E:\\Leemo\\out.txt`", "E:\\Leemo", (p) => p === "E:\\Leemo\\out.txt");
    expect(audit.claimed.some((c) => c.path === "E:\\Leemo\\out.txt" && c.withinCwd === true)).toBe(true);
  });

  // ── 轮 7 C6: two false positives observed on the real product ─────────────
  //
  // Both made a SUCCESSFUL turn display an alarming amber warning, which is
  // worse than no warning at all: it trains the user to ignore the one signal
  // that is supposed to mean "momo wrote somewhere it shouldn't".
  it("does NOT treat cited URLs as claimed paths (轮 7 C6)", () => {
    // Verbatim shape from the live run: momo answers with two source links and
    // the user saw `⚠ 声称写到工作区外：s://www.nobelprize.org/…`, because
    // `[A-Za-z]:` matched the `s:` of `https:`.
    const text =
      "来源：\n- https://www.nobelprize.org/prizes/about/prize-announcement-dates/\n- http://nerdsip.com/events/nobel-prize/";
    const audit = auditClaimedPaths(text, "C:\\Users\\R\\Leemo", () => false);
    expect(audit.claimed).toEqual([]);
  });

  it("does NOT flag the tail of a plain relative path as an escape (轮 7 C6)", () => {
    // Live shape: momo correctly wrote `诊断/写文件测试-X.md` inside cwd, but the
    // bare-slash branch captured the fragment `/写文件测试-X.md`, which resolves
    // against the filesystem ROOT ⇒ reported as outside the workspace.
    const audit = auditClaimedPaths(
      "写完啦 ✅ 文件在 诊断/写文件测试-WT1.md，内容就是那一行。",
      "C:\\Users\\R\\Leemo",
      () => true,
    );
    expect(audit.claimed).toEqual([]);
  });

  it("does NOT interpret a display ellipsis as ../ traversal", () => {
    // Packaged r9b live shape: momo shortened a real in-workspace path with
    // `...\\home\\Leemo\\...`; the relative-path branch started at the last
    // two dots and turned that harmless display abbreviation into `..\\home`.
    const audit = auditClaimedPaths(
      "文件已创建，当前目录为 ...\\home\\Leemo\\r9-continuity-s6jjyjo。",
      "C:\\Users\\R\\AppData\\Local\\Temp\\leemo-e2e\\home\\Leemo\\r9-continuity-s6jjyjo",
      () => true,
    );
    expect(audit.claimed).toEqual([]);
  });

  it("does NOT audit an absolute path shortened with a display ellipsis", () => {
    const audit = auditClaimedPaths(
      "文件已创建：E:\\Temp\\...\\r9-continuity-sm4c62e",
      "E:\\Temp\\leemo-e2e\\home\\Leemo\\r9-continuity-sm4c62e",
      () => false,
    );
    expect(audit.claimed).toEqual([]);
  });

  it("does NOT turn a plan-mode restriction or denied write into a write claim", () => {
    const text =
      "当前处于 plan mode，只能编辑计划文件 `E:\\Leemo\\.leemo-workspace\\data\\providers\\deepseek\\plans\\draft.md`，不能创建其他文件。我没有创建目标文件。";
    const audit = auditClaimedPaths(text, "C:\\Users\\R\\Leemo\\诊断", () => false);
    expect(audit.claimed).toEqual([]);
  });

  it("still catches a real escape stated as an absolute path", () => {
    // The guarantee must survive the two fixes above — this is the Phase 0
    // failure mode (model invents an absolute path outside cwd) and it is the
    // entire reason the auditor exists.
    const audit = auditClaimedPaths(
      "已写入 /Users/AZ/advent.2024/probe.txt",
      "C:\\Users\\R\\Leemo",
      () => true,
    );
    expect(audit.claimed).toEqual([
      { path: "/Users/AZ/advent.2024/probe.txt", exists: true, withinCwd: false, writeClaim: true },
    ]);
  });

  it("still catches an escape stated with ../", () => {
    const audit = auditClaimedPaths("写到 ../secret.txt 了", "C:\\Users\\R\\Leemo", () => true);
    expect(audit.claimed.some((c) => c.path === "../secret.txt" && c.withinCwd === false)).toBe(true);
  });

  it("text with no path-like tokens yields an empty claimed list", () => {
    const audit = auditClaimedPaths("All done, nothing to report.", "/work/proj", () => true);
    expect(audit.claimed).toEqual([]);
  });
});
