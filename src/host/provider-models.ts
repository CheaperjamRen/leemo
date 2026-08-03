// Leemo Host — remote model discovery (轮 3 卡 F2).
//
// Pulls a provider's model list from its discovery endpoint and normalizes
// it: filters non-chat models (qwen's discovery endpoint mixes in
// embedding/audio/image/etc — 231 entries observed, most unusable for chat),
// folds dated snapshots onto their base id, dedupes, and sorts. Never
// throws: parse/network/4xx failures resolve through classifyProviderError
// to `{models:[], error}` (mirrors src/bridge/balance.ts's discipline).

import type { ListRemoteModelsResult, ProviderAuthMode, RemoteModel } from "../bridge/contract";
import { classifyProviderError } from "./provider-errors";

export interface ProviderModelsTarget {
  modelsUrl: string;
  apiKey: string;
  authMode?: ProviderAuthMode;
  apiKeyHeader?: "authorization" | "x-api-key";
  headers?: Record<string, string>;
}

export interface ProviderModelsDeps {
  fetchFn: typeof fetch;
}

// ---------------------------------------------------------------------------
// normalizeModelList
// ---------------------------------------------------------------------------

// Keyword-based EXCLUSION list for non-chat models (卡 F: qwen's /v1/models
// mixes in 231 entries spanning embedding/audio/image/ocr/video/etc). This
// is DELIBERATELY conservative — every keyword here is something that, if
// present in a model id, makes it near-certain the model is not a
// chat-completions model. When in doubt, a model is KEPT (false negatives —
// a non-chat model slipping through — are the safe failure mode; false
// positives — a real chat model getting excluded — are not).
const EXCLUDE_KEYWORDS = [
  "embedding",
  "audio",
  "asr",
  "tts",
  "speech",
  "ocr",
  "image",
  "wan",
  "realtime",
  "livetranslate",
  "rerank",
  "video",
] as const;

function looksNonChat(id: string): boolean {
  const lower = id.toLowerCase();
  return EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));
}

// Matches a trailing dated snapshot suffix: `-YYYY-MM-DD` or `-YYYYMMDD`.
// Captures the base id (everything before the suffix) in group 1.
const SNAPSHOT_SUFFIX_RE = /^(.+)-(?:\d{4}-\d{2}-\d{2}|\d{8})$/;

interface RawModelEntry {
  id?: unknown;
  display_name?: unknown;
  displayName?: unknown;
}

function extractRawEntries(raw: unknown): RawModelEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((e): e is RawModelEntry => e !== null && typeof e === "object");
}

/**
 * Normalize a raw `/v1/models`-shaped discovery response (`{data:[{id,...}]}`
 * — the shape common to GLM's anthropic-base endpoint and kimi/deepseek/
 * qwen's openai-base endpoints) into the filtered, snapshot-annotated,
 * deduped, sorted `RemoteModel[]` the UI renders.
 *
 * Never throws: a non-object / missing-`data` input yields `[]`.
 */
export function normalizeModelList(raw: unknown): RemoteModel[] {
  const entries = extractRawEntries(raw);

  // First pass: dedupe by id, keep chat-looking ones, capture display name.
  const byId = new Map<string, RemoteModel>();
  for (const entry of entries) {
    if (typeof entry.id !== "string" || !entry.id) continue;
    if (looksNonChat(entry.id)) continue;
    if (byId.has(entry.id)) continue;

    const displayNameRaw = entry.display_name ?? entry.displayName;
    const model: RemoteModel = { id: entry.id };
    if (typeof displayNameRaw === "string" && displayNameRaw) {
      model.displayName = displayNameRaw;
    }
    byId.set(entry.id, model);
  }

  // Second pass: mark dated snapshots — ONLY when the undated base id is
  // ALSO present in the list (spec requirement: "前提是无日期的那个 id 也在
  // 列表里"). Snapshots are annotated, never dropped.
  for (const [id, model] of byId) {
    const match = id.match(SNAPSHOT_SUFFIX_RE);
    if (!match) continue;
    const baseId = match[1];
    if (baseId !== id && byId.has(baseId)) {
      model.snapshotOf = baseId;
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// listProviderModels — the fetch + parse + classify wrapper.
// ---------------------------------------------------------------------------

/**
 * Fetch and normalize a provider's model list. Never throws: network
 * errors, non-2xx responses, and non-JSON bodies all resolve through
 * classifyProviderError into `{models:[], error}`.
 */
export async function listProviderModels(
  target: ProviderModelsTarget,
  deps: ProviderModelsDeps
): Promise<ListRemoteModelsResult> {
  const headers: Record<string, string> = {
    ...(target.authMode === "none"
      ? {}
      : target.apiKeyHeader === "x-api-key"
        ? { "x-api-key": target.apiKey }
        : { authorization: `Bearer ${target.apiKey}` }),
    ...(target.headers ?? {}),
  };

  let status: number;
  let rawText: string | undefined;
  try {
    const res = await deps.fetchFn(target.modelsUrl, { method: "GET", headers } as RequestInit);
    status = res.status;
    try {
      rawText = await res.text();
    } catch {
      rawText = undefined;
    }

    if (status < 200 || status >= 300) {
      let body: unknown;
      if (rawText !== undefined) {
        try {
          body = JSON.parse(rawText);
        } catch {
          body = undefined;
        }
      }
      return {
        models: [],
        error: classifyProviderError({ httpStatus: status, body, rawText, apiKey: target.apiKey }),
      };
    }
  } catch (thrown) {
    return { models: [], error: classifyProviderError({ thrown, apiKey: target.apiKey }) };
  }

  let parsed: unknown;
  try {
    parsed = rawText !== undefined ? JSON.parse(rawText) : undefined;
  } catch {
    return {
      models: [],
      error: classifyProviderError({
        httpStatus: status,
        rawText,
        apiKey: target.apiKey,
      }),
    };
  }

  return { models: normalizeModelList(parsed) };
}
