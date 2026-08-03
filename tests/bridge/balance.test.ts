import { describe, it, expect } from "vitest";
import { fetchBalance } from "../../src/bridge/balance";

// B2 Step 3 — instant balance fetch (today's/7-day usage summaries are OUT
// OF SCOPE for this card — that needs SQLite, Phase 1; contract types are
// reserved in B3).
//
// DeepSeek's response shape below is the REAL shape confirmed against the
// official docs (https://api-docs.deepseek.com/api/get-user-balance/,
// fetched 2026-07-21): {is_available, balance_infos:[{currency,
// total_balance, granted_balance, topped_up_balance}]} — all balance
// amounts are STRINGS in the real API, not numbers.
//
// fetchFn is fully injected (deps.fetchFn) — zero live network calls.

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function fakeFetchReturning(body: unknown, opts?: { ok?: boolean; status?: number }): typeof fetch {
  const resp: FakeResponse = {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    json: async () => body,
  };
  return (async () => resp as unknown as Response) as unknown as typeof fetch;
}

function fakeFetchThrowing(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

const deepseekProvider = {
  id: "deepseek",
  apiFormat: "anthropic" as const,
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "sk-test-deepseek-DIRECTKEY-000000000000",
};

describe("fetchBalance — DeepSeek", () => {
  it("parses the real DeepSeek balance_infos response shape into BalanceInfo", async () => {
    const fetchFn = fakeFetchReturning({
      is_available: true,
      balance_infos: [
        { currency: "USD", total_balance: "12.345678", granted_balance: "10.000000", topped_up_balance: "2.345678" },
      ],
    });

    const info = await fetchBalance(deepseekProvider, { fetchFn });
    expect(info.supported).toBe(true);
    expect(info.totalUsd).toBeCloseTo(12.345678, 6);
    expect(info.granted).toBeCloseTo(10.0, 6);
    expect(info.toppedUp).toBeCloseTo(2.345678, 6);
  });

  it("parses a CNY-currency balance_infos entry into totalCny, leaving totalUsd unset", async () => {
    const fetchFn = fakeFetchReturning({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "88.000000", granted_balance: "80.000000", topped_up_balance: "8.000000" },
      ],
    });

    const info = await fetchBalance(deepseekProvider, { fetchFn });
    expect(info.supported).toBe(true);
    expect(info.totalCny).toBeCloseTo(88.0, 6);
    expect(info.totalUsd).toBeUndefined();
  });

  it("calls the DeepSeek balance endpoint with a Bearer-auth header carrying the provider's key", async () => {
    let capturedUrl: unknown;
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ is_available: true, balance_infos: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await fetchBalance(deepseekProvider, { fetchFn });

    expect(String(capturedUrl)).toBe("https://api.deepseek.com/user/balance");
    expect(capturedHeaders?.Authorization).toBe(`Bearer ${deepseekProvider.apiKey}`);
  });

  it("non-2xx response yields supported:false without throwing, and raw carries no key", async () => {
    const fetchFn = fakeFetchReturning({ error: "unauthorized" }, { ok: false, status: 401 });
    const info = await fetchBalance(deepseekProvider, { fetchFn });
    expect(info.supported).toBe(false);
    expect(JSON.stringify(info.raw ?? "")).not.toContain(deepseekProvider.apiKey);
  });
});

describe("fetchBalance — unsupported providers", () => {
  it("GLM has no documented public balance endpoint → supported:false", async () => {
    const glmProvider = {
      id: "glm",
      apiFormat: "anthropic" as const,
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKey: "sk-test-glm-DIRECTKEY-222222222222",
    };
    const fetchFn = fakeFetchReturning({});
    const info = await fetchBalance(glmProvider, { fetchFn });
    expect(info.supported).toBe(false);
  });

  it("an entirely unknown providerId → supported:false, does not call fetchFn", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    const info = await fetchBalance(
      { id: "not-a-real-provider", apiFormat: "openai", baseUrl: "https://example.com", apiKey: "sk-test-x" },
      { fetchFn }
    );
    expect(info.supported).toBe(false);
    expect(called).toBe(false);
  });

  it("通义/百炼 has no public balance API → supported:false, no call", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const info = await fetchBalance(
      { id: "qwen", kind: "qwen", apiFormat: "anthropic", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", apiKey: "sk-test-qwen" },
      { fetchFn }
    );
    expect(info.supported).toBe(false);
    expect(called).toBe(false);
  });
});

describe("fetchBalance — dispatch is per FAMILY, not per instance (轮 3 卡 F)", () => {
  it("a SECOND deepseek instance still reaches the deepseek fetcher", async () => {
    // Regression guard: before 卡 F this dispatched on `id`, so a user's second
    // account (`deepseek-work`) silently lost balance support.
    const fetchFn = fakeFetchReturning({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" },
      ],
    });
    const info = await fetchBalance(
      {
        id: "deepseek-work",
        kind: "deepseek",
        apiFormat: "anthropic",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-test-deepseek-second-account",
      },
      { fetchFn }
    );
    expect(info.supported).toBe(true);
    expect(info.totalCny).toBe(12.34);
  });

  it("an unsupported family is unsupported for EVERY instance of it", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const info = await fetchBalance(
      { id: "glm-personal", kind: "glm", apiFormat: "anthropic", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "sk-test-glm-2" },
      { fetchFn }
    );
    expect(info.supported).toBe(false);
    expect(called).toBe(false);
  });

  it("falls back to id when kind is absent (pre-卡F callers keep working)", async () => {
    const fetchFn = fakeFetchReturning({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "5.00", granted_balance: "0.00", topped_up_balance: "5.00" },
      ],
    });
    const info = await fetchBalance(
      { id: "deepseek", apiFormat: "anthropic", baseUrl: "https://api.deepseek.com", apiKey: "sk-test-legacy" },
      { fetchFn }
    );
    expect(info.supported).toBe(true);
  });
});

describe("fetchBalance — Kimi", () => {
  it("parses the official Moonshot balance response shape (code/data/scode/status)", async () => {
    const kimiProvider = {
      id: "kimi",
      apiFormat: "anthropic" as const,
      baseUrl: "https://api.moonshot.cn/anthropic",
      apiKey: "sk-test-kimi-DIRECTKEY-333333333333",
    };
    const fetchFn = fakeFetchReturning({
      code: 0,
      data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
      scode: "0x0",
      status: true,
    });

    const info = await fetchBalance(kimiProvider, { fetchFn });
    expect(info.supported).toBe(true);
    // Moonshot bills in CNY (platform.moonshot.cn) — available_balance is a
    // yuan amount, not USD. Must land in totalCny, and totalUsd must stay
    // unset (a prior bug mislabeled this as totalUsd, inflating the
    // displayed balance ~6.8x).
    expect(info.totalCny).toBeCloseTo(49.58894, 5);
    expect(info.totalUsd).toBeUndefined();
  });
});

describe("fetchBalance — network errors", () => {
  it("a thrown network error yields supported:false, no throw escapes, and no key leaks into raw", async () => {
    const fetchFn = fakeFetchThrowing(new Error(`connect failed for key ${deepseekProvider.apiKey}`));
    const info = await fetchBalance(deepseekProvider, { fetchFn });
    expect(info.supported).toBe(false);
    expect(JSON.stringify(info.raw ?? "")).not.toContain(deepseekProvider.apiKey);
  });
});
