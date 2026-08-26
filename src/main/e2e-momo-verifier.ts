import {
  normalizeSdkStream,
  type LeemoEvent,
  type NormalizeCtx,
} from "../bridge/events";

export type MomoE2ESdkScenario = "estimated" | "exact" | "compact-iterations";

function scenarioMessages(scenario: MomoE2ESdkScenario): unknown[] {
  if (scenario === "estimated") {
    return [
      {
        type: "assistant", parent_tool_use_id: null,
        message: {
          role: "assistant", content: [],
          usage: {
            input_tokens: 1_000,
            cache_read_input_tokens: 42_000,
            cache_creation_input_tokens: 0,
            output_tokens: 212,
          },
        },
      },
      {
        type: "result", subtype: "success", is_error: false, result: "",
        usage: {
          input_tokens: 1_000,
          cache_read_input_tokens: 42_000,
          cache_creation_input_tokens: 0,
          output_tokens: 212,
        },
      },
    ];
  }
  if (scenario === "exact") {
    return [{
      type: "leemo_context_snapshot",
      contextUsage: {
        totalTokens: 81_000,
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        autoCompactThreshold: 950_000,
        isAutoCompactEnabled: true,
      },
    }];
  }
  const aggregateUsage = {
    input_tokens: 20_000,
    cache_read_input_tokens: 200_000,
    cache_creation_input_tokens: 0,
    output_tokens: 100,
    iterations: [
      { input_tokens: 10_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, output_tokens: 20 },
      { input_tokens: 19_500, cache_read_input_tokens: 99_900, cache_creation_input_tokens: 0, output_tokens: 120 },
    ],
  };
  return [
    {
      type: "assistant", parent_tool_use_id: null,
      message: { role: "assistant", content: [], usage: aggregateUsage },
    },
    {
      type: "system", subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 119_520, post_tokens: 30_000 },
    },
    { type: "result", subtype: "success", is_error: false, result: "", usage: aggregateUsage },
  ];
}

/** 只由经过系统临时目录校验的 E2E 进程调用；场景是代码内固定字面量，renderer
 * 不能注入任意 SDK frame。返回值仍由正式 normalizeSdkStream 生成。 */
export async function normalizeMomoE2EScenario(
  scenario: MomoE2ESdkScenario,
  context: NormalizeCtx,
): Promise<LeemoEvent[]> {
  const messages = scenarioMessages(scenario);
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
  };
  const events: LeemoEvent[] = [];
  for await (const event of normalizeSdkStream(stream as never, context)) events.push(event);
  return events;
}
