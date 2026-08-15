import { describe, it, expect } from "vitest";
import { classifyProviderError } from "../../src/host/provider-errors";

// 轮 3 卡 F2 — provider-errors.ts. Fixtures below use the ACTUAL response
// shapes/text 卡 F captured probing deepseek/kimi/glm/dashscope directly
// (not vendor docs). Where the spec quoted an exact literal string, the
// fixture uses that literal string verbatim (GLM's bracketed business
// codes, dashscope's InvalidParameter/InvalidApiKey bodies, kimi's
// resource_not_found_error text, deepseek's model-name-mismatch text). Where
// only the body SHAPE + `type` value was given (deepseek/kimi auth 401 —
// exact message text wasn't quoted in the spec), a representative message
// is used; classification never depends on that message text for those two
// cases, only on `type`.

const FAKE_KEY = "test-key-SECRET-abc123XYZ";

describe("classifyProviderError — auth (401, three body shapes)", () => {
  it("deepseek: {error:{type:'authentication_error',message}} -> auth", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: {
        error: {
          type: "authentication_error",
          message: `Authentication Fails, your api key: ${FAKE_KEY} is invalid`,
        },
      },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("auth");
    expect(result.httpStatus).toBe(401);
  });

  it("kimi: {error:{type:'invalid_authentication_error',message}} -> auth", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: {
        error: {
          type: "invalid_authentication_error",
          message: `invalid api key ${FAKE_KEY}`,
        },
      },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("auth");
  });

  it("glm: {error:{message:'令牌已过期或验证不正确',type:'401'}} (non-standard string type) -> auth", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: { error: { message: "令牌已过期或验证不正确", type: "401" } },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("auth");
  });

  it("dashscope: {request_id,code:'InvalidApiKey',message} (NO error wrapper) -> auth", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: {
        request_id: "req-abc-123",
        code: "InvalidApiKey",
        message: "Invalid API-key provided.",
      },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("auth");
  });
});

describe("classifyProviderError — 403 is ambiguous across vendors, body decides", () => {
  it("dashscope 403 {message:'invalid api-key',type:'authentication_error'} -> auth (NOT permission)", () => {
    const result = classifyProviderError({
      httpStatus: 403,
      body: { message: "invalid api-key", type: "authentication_error" },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("auth");
  });

  it("glm 403 with bracketed [1220] no-permission message -> permission (NOT auth)", () => {
    const result = classifyProviderError({
      httpStatus: 403,
      body: { error: { message: "[1220]您无权访问glm-4.6-air", type: "1220" } },
      apiKey: FAKE_KEY,
    });
    expect(result.kind).toBe("permission");
  });

  it("a 403 with no disambiguating body falls back to permission by status", () => {
    const result = classifyProviderError({ httpStatus: 403, body: {} });
    expect(result.kind).toBe("permission");
  });
});

describe("classifyProviderError — GLM bracketed business codes (message is the real signal)", () => {
  it("[1211] 模型不存在 -> model_missing, even though HTTP is 400", () => {
    const result = classifyProviderError({
      httpStatus: 400,
      body: { error: { message: "[1211]模型不存在，请检查模型代码。", type: "1211" } },
    });
    expect(result.kind).toBe("model_missing");
  });

  it("[1305] 该模型当前访问量过大 -> overloaded, even on HTTP 529", () => {
    const result = classifyProviderError({
      httpStatus: 529,
      body: { error: { message: "[1305]该模型当前访问量过大，请稍后再试。", type: "1305" } },
    });
    expect(result.kind).toBe("overloaded");
  });
});

describe("classifyProviderError — model_missing, three different statuses per vendor", () => {
  it("kimi 404: resource_not_found_error", () => {
    const result = classifyProviderError({
      httpStatus: 404,
      body: {
        error: {
          type: "resource_not_found_error",
          message: "Not found the model deepseek-v4-flash or Permission denied",
        },
      },
    });
    expect(result.kind).toBe("model_missing");
    expect(result.httpStatus).toBe(404);
  });

  it("glm 400: [1211] bracketed code", () => {
    const result = classifyProviderError({
      httpStatus: 400,
      body: { error: { message: "[1211]模型不存在，请检查模型代码。", type: "1211" } },
    });
    expect(result.kind).toBe("model_missing");
  });

  it("deepseek 400: message-wording heuristic (no distinct `type` for this case)", () => {
    const result = classifyProviderError({
      httpStatus: 400,
      body: {
        error: {
          type: "invalid_request_error",
          message:
            "The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-typo",
        },
      },
    });
    expect(result.kind).toBe("model_missing");
  });
});

describe("classifyProviderError — bad_request (dashscope param errors, our bug not the user's)", () => {
  it("dashscope InvalidParameter -> bad_request", () => {
    const result = classifyProviderError({
      httpStatus: 400,
      body: {
        code: "InvalidParameter",
        message:
          "<400> InternalError.Algo.InvalidParameter: The provided messages input is invalid.",
      },
    });
    expect(result.kind).toBe("bad_request");
  });

  it("dashscope models-discovery 404 body {code:'InvalidParameter',message:'Not support'} -> bad_request", () => {
    const result = classifyProviderError({
      httpStatus: 404,
      body: { code: "InvalidParameter", message: "Not support" },
    });
    expect(result.kind).toBe("bad_request");
  });

  it("an unrecognized 400 body with no signal falls back to bad_request by status", () => {
    const result = classifyProviderError({ httpStatus: 400, body: { whatever: true } });
    expect(result.kind).toBe("bad_request");
  });
});

describe("classifyProviderError — rate_limit / overloaded / server (status-driven)", () => {
  it("429 -> rate_limit", () => {
    const result = classifyProviderError({ httpStatus: 429, body: { error: "too many requests" } });
    expect(result.kind).toBe("rate_limit");
  });

  it("529 with no bracket signal -> overloaded", () => {
    const result = classifyProviderError({ httpStatus: 529, body: { error: "capacity" } });
    expect(result.kind).toBe("overloaded");
  });

  it("500 -> server", () => {
    const result = classifyProviderError({ httpStatus: 500, body: { error: "internal error" } });
    expect(result.kind).toBe("server");
  });

  it("503 -> server", () => {
    const result = classifyProviderError({ httpStatus: 503 });
    expect(result.kind).toBe("server");
  });
});

describe("classifyProviderError — network / timeout (thrown, no HTTP response)", () => {
  it("a generic thrown Error (DNS/TCP/TLS failure) -> network", () => {
    const result = classifyProviderError({ thrown: new Error("getaddrinfo ENOTFOUND api.example.com") });
    expect(result.kind).toBe("network");
  });

  it("AbortError -> timeout", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    const result = classifyProviderError({ thrown: err });
    expect(result.kind).toBe("timeout");
  });

  it("TimeoutError -> timeout", () => {
    const err = new Error("signal timed out");
    err.name = "TimeoutError";
    const result = classifyProviderError({ thrown: err });
    expect(result.kind).toBe("timeout");
  });

  it("a thrown non-Error value still classifies without throwing", () => {
    const result = classifyProviderError({ thrown: "connection reset" });
    expect(result.kind).toBe("network");
  });
});

describe("classifyProviderError — balance / region heuristics (NO real fixture from the four vendors probed; keyword-based placeholders)", () => {
  it("a body mentioning insufficient balance -> balance", () => {
    const result = classifyProviderError({
      httpStatus: 402,
      body: { error: { message: "Insufficient balance, please top up your account." } },
    });
    expect(result.kind).toBe("balance");
  });

  it("a body mentioning 余额不足 -> balance", () => {
    const result = classifyProviderError({
      httpStatus: 402,
      body: { error: { message: "账户余额不足，请先充值。" } },
    });
    expect(result.kind).toBe("balance");
  });

  it("402 with no recognizable body still falls back to balance by status", () => {
    const result = classifyProviderError({ httpStatus: 402, body: {} });
    expect(result.kind).toBe("balance");
  });

  it("a body mentioning region/geo blocking -> region", () => {
    const result = classifyProviderError({
      httpStatus: 403,
      body: { error: { message: "This service is not available in your region." } },
    });
    expect(result.kind).toBe("region");
  });
});

describe("classifyProviderError — unknown fallback", () => {
  it("no httpStatus, no thrown, unrecognizable body -> unknown", () => {
    const result = classifyProviderError({ body: { totally: "unrecognized shape" } });
    expect(result.kind).toBe("unknown");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("carries detail (redacted) for an unknown case so nothing is lost", () => {
    const result = classifyProviderError({ body: { weird: "shape", note: "some upstream detail" } });
    expect(result.detail).toBeDefined();
    expect(result.detail).toContain("some upstream detail");
  });
});

describe("classifyProviderError — apiKey NEVER leaks into message or detail", () => {
  it("redacts the key out of a body message that echoes it back", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: { error: { type: "authentication_error", message: `bad key: ${FAKE_KEY}` } },
      apiKey: FAKE_KEY,
    });
    expect(result.message).not.toContain(FAKE_KEY);
    expect(result.detail).not.toContain(FAKE_KEY);
  });

  it("redacts the key out of rawText", () => {
    const result = classifyProviderError({
      httpStatus: 500,
      rawText: `upstream 500, request had Authorization: Bearer ${FAKE_KEY}`,
      apiKey: FAKE_KEY,
    });
    expect(result.message).not.toContain(FAKE_KEY);
    expect(result.detail).not.toContain(FAKE_KEY);
  });

  it("redacts the key out of a thrown error's message", () => {
    const result = classifyProviderError({
      thrown: new Error(`connect failed while sending key ${FAKE_KEY}`),
      apiKey: FAKE_KEY,
    });
    expect(result.message).not.toContain(FAKE_KEY);
    expect(result.detail).not.toContain(FAKE_KEY);
  });

  it("never leaks the key even without an apiKey passed in (nothing to redact, but message stays static)", () => {
    const result = classifyProviderError({
      httpStatus: 401,
      body: { error: { type: "authentication_error", message: "bad key" } },
    });
    expect(result.message).not.toContain(FAKE_KEY);
  });

  it("message field is always static Chinese text, independent of any upstream content", () => {
    // Regression guard for the "never interpolate upstream text into message"
    // discipline: a body carrying an obviously secret-shaped string must not
    // show up in `message` under ANY kind.
    const bodies: unknown[] = [
      { error: { type: "authentication_error", message: `k=${FAKE_KEY}` } },
      { error: { message: `[1305]${FAKE_KEY} overloaded`, type: "1305" } },
      { code: "InvalidParameter", message: `bad param ${FAKE_KEY}` },
    ];
    for (const body of bodies) {
      const result = classifyProviderError({ httpStatus: 400, body, apiKey: FAKE_KEY });
      expect(result.message).not.toContain(FAKE_KEY);
    }
  });
});

describe("classifyProviderError — ProviderErrorKind exhaustive coverage sanity check", () => {
  it("every ProviderErrorKind has a non-empty static message mapped", () => {
    const kinds = [
      "auth",
      "permission",
      "model_missing",
      "balance",
      "rate_limit",
      "overloaded",
      "network",
      "timeout",
      "region",
      "bad_request",
      "server",
      "unknown",
    ] as const;
    // Drive each kind through a plausible input and confirm message is set.
    const probes: Array<{ input: Parameters<typeof classifyProviderError>[0]; expectKind: string }> = [
      { input: { httpStatus: 401, body: {} }, expectKind: "auth" },
      { input: { httpStatus: 403, body: {} }, expectKind: "permission" },
      { input: { httpStatus: 404, body: {} }, expectKind: "model_missing" },
      { input: { httpStatus: 402, body: {} }, expectKind: "balance" },
      { input: { httpStatus: 429, body: {} }, expectKind: "rate_limit" },
      { input: { httpStatus: 529, body: {} }, expectKind: "overloaded" },
      { input: { thrown: new Error("boom") }, expectKind: "network" },
      { input: { thrown: (() => { const e = new Error("t"); e.name = "AbortError"; return e; })() }, expectKind: "timeout" },
      {
        input: { httpStatus: 403, body: { error: { message: "not available in your region" } } },
        expectKind: "region",
      },
      { input: { httpStatus: 400, body: {} }, expectKind: "bad_request" },
      { input: { httpStatus: 500, body: {} }, expectKind: "server" },
      { input: {} , expectKind: "unknown" },
    ];
    for (const { input, expectKind } of probes) {
      const result = classifyProviderError(input);
      expect(result.kind).toBe(expectKind);
      expect(kinds).toContain(result.kind);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
