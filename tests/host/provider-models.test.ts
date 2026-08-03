import { describe, it, expect } from "vitest";
import { listProviderModels, normalizeModelList } from "../../src/host/provider-models";

// 轮 3 卡 F2 — provider-models.ts. fetchFn is fully injected; zero live
// network calls.

function fakeResponse(status: number, text: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  } as unknown as Response;
}

function fakeFetchReturning(status: number, jsonOrText: unknown, opts?: { asText?: boolean }): typeof fetch {
  const text = opts?.asText ? String(jsonOrText) : JSON.stringify(jsonOrText);
  return (async () => fakeResponse(status, text)) as unknown as typeof fetch;
}

function fakeFetchThrowing(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

const target = { modelsUrl: "https://open.bigmodel.cn/api/anthropic/v1/models", apiKey: "sk-test-DIRECTKEY-999" };

// ---------------------------------------------------------------------------
// normalizeModelList — pure function tests
// ---------------------------------------------------------------------------

describe("normalizeModelList — GLM shape ({data:[{id,display_name,type,created_at}]})", () => {
  it("parses id + display_name", () => {
    const raw = {
      data: [{ id: "glm-4.6-air", display_name: "GLM-4.6 Air", type: "text", created_at: 1234 }],
    };
    const models = normalizeModelList(raw);
    expect(models).toEqual([{ id: "glm-4.6-air", displayName: "GLM-4.6 Air" }]);
  });
});

describe("normalizeModelList — openai shape ({data:[{id,...}]}), shared parser", () => {
  it("parses id-only entries (kimi/deepseek/qwen openai discovery)", () => {
    const raw = { data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] };
    const models = normalizeModelList(raw);
    expect(models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });
});

describe("normalizeModelList — filters non-chat models (qwen's 231-entry mix)", () => {
  const nonChatIds = [
    "text-embedding-v3",
    "paraformer-audio-asr",
    "cosyvoice-tts",
    "sambert-speech-v1",
    "qwen-ocr",
    "wanx-image-generation",
    "wan2.2-video",
    "qwen-omni-realtime",
    "livetranslate-flash",
    "gte-rerank-v2",
    "qwen-vl-video-understanding",
  ];

  it.each(nonChatIds)("excludes id containing a non-chat keyword: %s", (id) => {
    const models = normalizeModelList({ data: [{ id }] });
    expect(models).toEqual([]);
  });

  it("keeps a normal chat model alongside excluded ones", () => {
    const raw = {
      data: [{ id: "qwen3.7-flash" }, { id: "text-embedding-v3" }, { id: "paraformer-audio-asr" }],
    };
    const models = normalizeModelList(raw);
    expect(models.map((m) => m.id)).toEqual(["qwen3.7-flash"]);
  });

  it("is conservative: a model id that merely CONTAINS a substring but is a real chat model naming pattern is judged by keyword presence, not false-positived by accident (documents current behavior)", () => {
    // qwen-vl (vision-language chat model) does NOT contain any exclude
    // keyword and must survive.
    const models = normalizeModelList({ data: [{ id: "qwen-vl-plus" }] });
    expect(models.map((m) => m.id)).toEqual(["qwen-vl-plus"]);
  });
});

describe("normalizeModelList — dated-snapshot folding", () => {
  it("marks a -YYYY-MM-DD suffixed id as snapshotOf its base id, WHEN the base id is also present", () => {
    const raw = { data: [{ id: "qwen3.7-flash" }, { id: "qwen3.7-flash-2026-07-15" }] };
    const models = normalizeModelList(raw);
    const snapshot = models.find((m) => m.id === "qwen3.7-flash-2026-07-15");
    expect(snapshot?.snapshotOf).toBe("qwen3.7-flash");
    const base = models.find((m) => m.id === "qwen3.7-flash");
    expect(base?.snapshotOf).toBeUndefined();
  });

  it("marks a -YYYYMMDD (no dashes) suffixed id as a snapshot too", () => {
    const raw = { data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-flash-20260715" }] };
    const models = normalizeModelList(raw);
    const snapshot = models.find((m) => m.id === "deepseek-v4-flash-20260715");
    expect(snapshot?.snapshotOf).toBe("deepseek-v4-flash");
  });

  it("does NOT mark a dated-looking id as a snapshot when the base id is absent from the list", () => {
    const raw = { data: [{ id: "qwen3.7-flash-2026-07-15" }] };
    const models = normalizeModelList(raw);
    expect(models[0].snapshotOf).toBeUndefined();
  });

  it("never drops the snapshot entry — it stays in the list, only annotated", () => {
    const raw = { data: [{ id: "qwen3.7-flash" }, { id: "qwen3.7-flash-2026-07-15" }] };
    const models = normalizeModelList(raw);
    expect(models).toHaveLength(2);
  });

  it("does not treat an ordinary hyphenated model name as a false-positive snapshot (no digit-date suffix)", () => {
    const raw = { data: [{ id: "deepseek-v4-flash" }] };
    const models = normalizeModelList(raw);
    expect(models[0].snapshotOf).toBeUndefined();
  });
});

describe("normalizeModelList — dedupe + stable sort", () => {
  it("dedupes identical ids", () => {
    const raw = { data: [{ id: "a-model" }, { id: "a-model" }] };
    const models = normalizeModelList(raw);
    expect(models).toHaveLength(1);
  });

  it("sorts ids alphabetically regardless of input order", () => {
    const raw = { data: [{ id: "z-model" }, { id: "a-model" }, { id: "m-model" }] };
    const models = normalizeModelList(raw);
    expect(models.map((m) => m.id)).toEqual(["a-model", "m-model", "z-model"]);
  });
});

describe("normalizeModelList — malformed / empty input never throws", () => {
  it("empty data array -> []", () => {
    expect(normalizeModelList({ data: [] })).toEqual([]);
  });

  it("missing data field -> []", () => {
    expect(normalizeModelList({})).toEqual([]);
  });

  it("non-object input -> []", () => {
    expect(normalizeModelList(null)).toEqual([]);
    expect(normalizeModelList("not json")).toEqual([]);
    expect(normalizeModelList(42)).toEqual([]);
  });

  it("data entries missing an id are skipped, not crashing", () => {
    const raw = { data: [{ display_name: "no id here" }, { id: "valid-model" }] };
    expect(normalizeModelList(raw).map((m) => m.id)).toEqual(["valid-model"]);
  });
});

// ---------------------------------------------------------------------------
// listProviderModels — fetch + parse + classify wrapper
// ---------------------------------------------------------------------------

describe("listProviderModels — success path", () => {
  it("fetches, parses, and normalizes", async () => {
    const fetchFn = fakeFetchReturning(200, {
      data: [{ id: "glm-4.6-air", display_name: "GLM-4.6 Air" }],
    });
    const result = await listProviderModels(target, { fetchFn });
    expect(result.error).toBeUndefined();
    expect(result.models).toEqual([{ id: "glm-4.6-air", displayName: "GLM-4.6 Air" }]);
  });

  it("sends Authorization header with the key", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      capturedHeaders = init?.headers;
      return fakeResponse(200, JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;
    await listProviderModels(target, { fetchFn });
    expect(capturedHeaders?.authorization).toBe(`Bearer ${target.apiKey}`);
  });

  it("uses X-Api-Key for providers that declare that auth header", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      capturedHeaders = init?.headers;
      return fakeResponse(200, JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    await listProviderModels({ ...target, apiKeyHeader: "x-api-key" }, { fetchFn });

    expect(capturedHeaders?.["x-api-key"]).toBe(target.apiKey);
    expect(capturedHeaders?.authorization).toBeUndefined();
  });

  it("sends no auth header to a key-free local model service", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      capturedHeaders = init?.headers;
      return fakeResponse(200, JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    await listProviderModels({ ...target, apiKey: "", authMode: "none" }, { fetchFn });

    expect(capturedHeaders?.authorization).toBeUndefined();
    expect(capturedHeaders?.["x-api-key"]).toBeUndefined();
  });
});

describe("listProviderModels — failure paths never throw", () => {
  it("empty list on empty data -> {models:[]}, no error", async () => {
    const fetchFn = fakeFetchReturning(200, { data: [] });
    const result = await listProviderModels(target, { fetchFn });
    expect(result.models).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("non-JSON body -> {models:[], error} not a throw", async () => {
    const fetchFn = fakeFetchReturning(200, "<html>not json</html>", { asText: true });
    const result = await listProviderModels(target, { fetchFn });
    expect(result.models).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("qwen's anthropic-base /v1/models 404 {code:'InvalidParameter',message:'Not support'} -> {models:[], error}", async () => {
    const fetchFn = fakeFetchReturning(404, { code: "InvalidParameter", message: "Not support" });
    const result = await listProviderModels(target, { fetchFn });
    expect(result.models).toEqual([]);
    expect(result.error).toBeDefined();
    expect(result.error?.kind).toBe("bad_request");
  });

  it("401 -> {models:[], error.kind='auth'}", async () => {
    const fetchFn = fakeFetchReturning(401, {
      error: { type: "authentication_error", message: "bad key" },
    });
    const result = await listProviderModels(target, { fetchFn });
    expect(result.models).toEqual([]);
    expect(result.error?.kind).toBe("auth");
  });

  it("a thrown network error -> {models:[], error.kind='network'}, no throw escapes", async () => {
    const fetchFn = fakeFetchThrowing(new Error(`connect failed ${target.apiKey}`));
    const result = await listProviderModels(target, { fetchFn });
    expect(result.models).toEqual([]);
    expect(result.error?.kind).toBe("network");
  });

  it("apiKey never leaks into the result on any failure path", async () => {
    const fetchFn = fakeFetchReturning(401, {
      error: { type: "authentication_error", message: `bad key ${target.apiKey}` },
    });
    const result = await listProviderModels(target, { fetchFn });
    expect(JSON.stringify(result)).not.toContain(target.apiKey);
  });
});
