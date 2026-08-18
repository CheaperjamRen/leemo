import fs from "node:fs";
import path from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { buildUsageRecord, normalizeSdkStream, type LeemoEvent, type UsageRecord } from "../bridge/events";
import { createBridge } from "../bridge/pool";
import type { Provider } from "../bridge/providers";
import type { ModelPricing } from "../bridge/pricing";
import type { CodexExecutionRuntime } from "./codex-conversation";
import { requestProviderText, type ProviderTestTarget } from "./provider-test";
import { buildQueryFn } from "./sdk-adapter";

export interface OneShotUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: string;
  costSource: "sdk" | "local-pricing" | "unpriced";
  tokensEstimated: boolean;
  durationMs: number;
}

export type OneShotInferenceTarget =
  | { kind: "direct"; providerId: string; modelId: string; target: ProviderTestTarget }
  | { kind: "claude-subscription"; provider: Provider; modelId: string }
  | { kind: "codex-subscription"; providerId: string; modelId: string }
  | { kind: "gemini-subscription"; providerId: string; modelId: string };

export type OneShotInferenceResult =
  | { ok: true; text: string; usage: OneShotUsage }
  | { ok: false; message: string; detail?: string; retryable: boolean; usage?: OneShotUsage };

export interface OneShotInferenceDeps {
  fetchFn: typeof fetch;
  dataDir: string;
  now?: () => number;
  queryImpl?: typeof sdkQuery;
  codexRuntime?: CodexExecutionRuntime;
  geminiRuntime?: CodexExecutionRuntime;
  resolvePricing(providerId: string, modelId: string): ModelPricing | undefined;
}

const TOOL_ATTEMPT_MESSAGE = "梳理过程尝试了不需要的工具，本次结果已丢弃。";

function usageFromRecord(record: UsageRecord, fallbackDurationMs: number): OneShotUsage {
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
    ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
    costSource: record.costSource,
    tokensEstimated: record.tokensEstimated,
    durationMs: record.durationMs ?? fallbackDurationMs,
  };
}

function retryableProviderKind(kind: string): boolean {
  return ["rate_limit", "overloaded", "network", "timeout", "server", "unknown"].includes(kind);
}

function createIsolatedDirectory(dataDir: string): string {
  const parent = path.join(dataDir, "one-shot");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "run-"));
}

function safeDetail(error: unknown, isolatedDirectory?: string): string | undefined {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!raw) return undefined;
  const normalized = isolatedDirectory ? raw.split(isolatedDirectory).join("<isolated>") : raw;
  return normalized.replace(/\s+/g, " ").trim().slice(0, 480) || undefined;
}

interface ConsumedEvents {
  text: string;
  usage?: OneShotUsage;
  toolAttempted: boolean;
  failure?: { message: string; detail?: string; retryable: boolean };
}

async function consumeEvents(
  events: AsyncIterable<LeemoEvent>,
  fallbackDurationMs: () => number,
  onToolAttempt: () => Promise<void>,
): Promise<ConsumedEvents> {
  let text = "";
  let usage: OneShotUsage | undefined;
  let failure: ConsumedEvents["failure"];
  for await (const event of events) {
    if (event.type === "tool.started") {
      await onToolAttempt();
      return { text: "", toolAttempted: true };
    }
    if (event.type === "text.final" && event.text.trim()) text = event.text.trim();
    if (event.type === "usage.final") usage = usageFromRecord(event.usage, fallbackDurationMs());
    if (event.type === "error") {
      failure = { message: "梳理没有完成，请稍后重试。", detail: event.message, retryable: true };
    }
    if (event.type === "run.finished") {
      if (!text && event.finalText.trim()) text = event.finalText.trim();
      if (event.isError) {
        failure = {
          message: "梳理没有完成，请稍后重试。",
          ...(event.finalText.trim() ? { detail: event.finalText.trim().slice(0, 480) } : {}),
          retryable: event.retryable !== false,
        };
      }
    }
  }
  return { text, ...(usage ? { usage } : {}), toolAttempted: false, ...(failure ? { failure } : {}) };
}

function noUsage(durationMs: number): OneShotUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costSource: "unpriced",
    tokensEstimated: true,
    durationMs,
  };
}

async function runDirect(
  target: Extract<OneShotInferenceTarget, { kind: "direct" }>,
  prompt: string,
  deps: OneShotInferenceDeps,
): Promise<OneShotInferenceResult> {
  const result = await requestProviderText(target.target, prompt, {
    fetchFn: deps.fetchFn,
    maxTokens: 1_024,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!result.ok) {
    return {
      ok: false,
      message: result.error.message,
      ...(result.error.detail ? { detail: result.error.detail } : {}),
      retryable: retryableProviderKind(result.error.kind),
    };
  }
  const record = buildUsageRecord({
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cache_read_input_tokens: result.usage.cacheReadTokens,
    cache_creation_input_tokens: result.usage.cacheCreationTokens,
  }, {
    providerId: target.providerId,
    modelId: target.modelId,
    durationMs: result.usage.durationMs,
    pricing: deps.resolvePricing(target.providerId, target.modelId),
  });
  return { ok: true, text: result.text, usage: usageFromRecord(record, result.usage.durationMs) };
}

async function runClaudeSubscription(
  target: Extract<OneShotInferenceTarget, { kind: "claude-subscription" }>,
  prompt: string,
  deps: OneShotInferenceDeps,
): Promise<OneShotInferenceResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const isolatedDirectory = createIsolatedDirectory(deps.dataDir);
  const queryFn = buildQueryFn({
    cwd: isolatedDirectory,
    canUseTool: async () => ({ behavior: "deny", message: "这次梳理不需要调用工具。" }),
    mcpServers: {},
    maxTurns: 1,
    permissionMode: "plan",
    pluginPaths: [],
    enabledSkills: [],
    autoMemoryEnabled: false,
    autoDreamEnabled: false,
  }, deps.queryImpl ?? sdkQuery);
  const bridge = createBridge({ queryFn, dataDir: path.join(isolatedDirectory, "state") });
  const handle = bridge.createConversation({ provider: target.provider, modelId: target.modelId });
  try {
    const raw = handle.send(prompt, { tools: [] });
    const consumed = await consumeEvents(normalizeSdkStream(raw, {
      providerId: target.provider.id,
      modelId: target.modelId,
      cwd: isolatedDirectory,
      pricing: deps.resolvePricing(target.provider.id, target.modelId),
    }), () => Math.max(0, now() - startedAt), async () => { handle.interrupt(); });
    if (consumed.toolAttempted) return { ok: false, message: TOOL_ATTEMPT_MESSAGE, retryable: false };
    if (consumed.failure) return { ok: false, ...consumed.failure, ...(consumed.usage ? { usage: consumed.usage } : {}) };
    if (!consumed.text) return { ok: false, message: "模型没有返回可用的梳理结果。", retryable: true, ...(consumed.usage ? { usage: consumed.usage } : {}) };
    return {
      ok: true,
      text: consumed.text,
      usage: consumed.usage ?? noUsage(Math.max(0, now() - startedAt)),
    };
  } catch (error) {
    return {
      ok: false,
      message: "梳理没有完成，请稍后重试。",
      ...(safeDetail(error, isolatedDirectory) ? { detail: safeDetail(error, isolatedDirectory) } : {}),
      retryable: true,
    };
  } finally {
    handle.dispose();
    bridge.dispose();
    fs.rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

async function runExternalSubscription(
  target: Extract<OneShotInferenceTarget, { kind: "codex-subscription" | "gemini-subscription" }>,
  prompt: string,
  deps: OneShotInferenceDeps,
): Promise<OneShotInferenceResult> {
  const runtime = target.kind === "codex-subscription" ? deps.codexRuntime : deps.geminiRuntime;
  if (!runtime) return { ok: false, message: "当前订阅运行时还没有准备好。", retryable: false };
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const isolatedDirectory = createIsolatedDirectory(deps.dataDir);
  const handle = runtime.createConversation({
    cwd: isolatedDirectory,
    workspaceRoot: isolatedDirectory,
    providerId: target.providerId,
    modelId: target.modelId,
    developerInstructions: "Return only the requested structured result. Do not use tools or access files.",
    permissionMode: "plan",
    webSearchEnabled: false,
    webFetchEnabled: false,
    approve: async () => "decline",
  });
  try {
    const consumed = await consumeEvents(handle.send(prompt), () => Math.max(0, now() - startedAt), async () => {
      await handle.interrupt();
    });
    if (consumed.toolAttempted) return { ok: false, message: TOOL_ATTEMPT_MESSAGE, retryable: false };
    if (consumed.failure) return { ok: false, ...consumed.failure, ...(consumed.usage ? { usage: consumed.usage } : {}) };
    if (!consumed.text) return { ok: false, message: "模型没有返回可用的梳理结果。", retryable: true, ...(consumed.usage ? { usage: consumed.usage } : {}) };
    return {
      ok: true,
      text: consumed.text,
      usage: consumed.usage ?? noUsage(Math.max(0, now() - startedAt)),
    };
  } catch (error) {
    return {
      ok: false,
      message: "梳理没有完成，请稍后重试。",
      ...(safeDetail(error, isolatedDirectory) ? { detail: safeDetail(error, isolatedDirectory) } : {}),
      retryable: true,
    };
  } finally {
    handle.dispose();
    fs.rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

export function runOneShotInference(
  target: OneShotInferenceTarget,
  prompt: string,
  deps: OneShotInferenceDeps,
): Promise<OneShotInferenceResult> {
  if (target.kind === "direct") return runDirect(target, prompt, deps);
  if (target.kind === "claude-subscription") return runClaudeSubscription(target, prompt, deps);
  return runExternalSubscription(target, prompt, deps);
}
