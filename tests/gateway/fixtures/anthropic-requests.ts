// Realistic Anthropic /v1/messages request fixtures, reshaped from Phase 0
// real request forms (Claude Code SDK). No API keys, no secrets.
//
// These mirror the shapes the claude-agent-sdk emits: string OR block-array
// system, tool_use / tool_result round-trips, cache_control markers, thinking,
// and image blocks nested in tool_result content.

import type { AnthropicChatRequest } from "@gateway/core/normalize";

/** Minimal text turn. */
export const simpleTextRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Say hello to momo." }],
};

/** System as a string. */
export const stringSystemRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 512,
  system: "You are momo, a helpful desk companion.",
  messages: [{ role: "user", content: "hi" }],
};

/** System as a block array with cache_control (pitfall ⑤/⑦). */
export const blockSystemRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 512,
  system: [
    { type: "text", text: "You are momo." },
    {
      type: "text",
      text: "Follow the workspace rules.",
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "read the file",
          cache_control: { type: "ephemeral" },
        },
      ],
    },
  ],
};

/** A full tool round-trip: assistant tool_use, then user tool_result.
 *  Ids must survive intact (pitfall ④). */
export const toolRoundTripRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 2048,
  tools: [
    {
      name: "Read",
      description: "Read a file",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ],
  messages: [
    { role: "user", content: "read config.json" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll read it." },
        {
          type: "tool_use",
          id: "toolu_abc123",
          name: "Read",
          input: { path: "config.json" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: "{ \"port\": 8080 }",
        },
      ],
    },
  ],
};

/** tool_result whose content nests an image block (pitfall ⑧). */
export const toolResultWithImageRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 2048,
  tools: [
    {
      name: "Screenshot",
      description: "Take a screenshot",
      input_schema: { type: "object", properties: {} },
    },
  ],
  messages: [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_img1",
          name: "Screenshot",
          input: {},
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_img1",
          content: [
            { type: "text", text: "Here is the screen:" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
    },
  ],
};

/** Request asking for thinking (pitfall ⑨). */
export const thinkingRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 8192,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [{ role: "user", content: "Plan the refactor." }],
};

/** Request mixing a client custom tool with server/builtin tools that must be
 *  stripped (pitfall ②). Server tools carry a versioned `type` and no
 *  input_schema. */
export const serverToolsRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  tools: [
    {
      name: "Read",
      description: "Read a file",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
    { type: "web_search_20250305", name: "web_search" },
    { type: "computer_20250124", name: "computer", display_width_px: 1024 },
  ],
  messages: [{ role: "user", content: "search the web" }],
};

/** Tool whose schema uses anyOf/oneOf/$ref/$defs (pitfall ⑪ — GLM rejects). */
export const anyOfSchemaTool = {
  name: "Configure",
  description: "Set a config value",
  input_schema: {
    type: "object",
    properties: {
      value: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      mode: {
        oneOf: [{ type: "string", enum: ["fast"] }, { type: "null" }],
      },
      ref: { $ref: "#/$defs/Named" },
    },
    $defs: {
      Named: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    required: ["value"],
  },
};

/** No max_tokens set (pitfall ⑥ — must be filled). */
export const noMaxTokensRequest: AnthropicChatRequest = {
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "hello" }],
};
