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
    expect(info.totalUsd).toBeCloseTo(49.58894, 5);
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
