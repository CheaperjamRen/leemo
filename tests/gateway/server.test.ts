// G3 — gateway shell full-chain tests. NO real upstream is contacted: an
// in-process mock OpenAI server (http.createServer) stands in for the relay.
//
// What each test asserts is documented inline. The load-bearing invariants:
//   - key isolation: the REAL provider key appears ONLY in the Authorization
//     header the mock upstream received — never in gateway logs or the client
//     response.
//   - SSE passthrough is UNBUFFERED: the client observes the first Anthropic
//     event BEFORE the mock upstream has finished emitting (timestamp compare,
//     not a sleep).
//   - client abort truly cancels the upstream request (the mock observes its
//     connection close while it is still holding the stream open).

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { startGateway, waitForDrain } from "@gateway/server";
import { ProviderRegistry } from "@gateway/registry";

// A fake but well-shaped provider key. NEVER a real-looking secret (key discipline).
const REAL_KEY = "test-key-0000000000000000000000000000";

// ---- in-process mock OpenAI upstream ---------------------------------------

interface Captured {
  path: string;
  method: string;
  authorization: string | undefined;
  body: any;
}

interface MockHandle {
  url: string;
  captured: Captured[];
  /** set true if a request connection closed before the handler finished. */
  closedEarly: boolean;
  close: () => Promise<void>;
}

type MockHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: any,
  mock: MockHandle
) => void | Promise<void>;

async function startMock(handler: MockHandler): Promise<MockHandle> {
  const mock: MockHandle = {
    url: "",
    captured: [],
    closedEarly: false,
    close: async () => {},
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let finished = false;
    req.on("close", () => {
      if (!finished) mock.closedEarly = true;
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: any = undefined;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      mock.captured.push({
        path: req.url ?? "",
        method: req.method ?? "",
        authorization: req.headers["authorization"] as string | undefined,
        body,
      });
      const done = res.end.bind(res);
      // wrap end() so we can flip `finished` for the closedEarly heuristic
      (res as any).end = (...args: any[]) => {
        finished = true;
        return done(...args);
      };
      Promise.resolve(handler(req, res, body, mock)).catch(() => {
        try {
          res.statusCode = 500;
          res.end("mock handler error");
        } catch {
          /* ignore */
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  mock.url = `http://127.0.0.1:${port}`;
  mock.close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return mock;
}

// ---- helpers ---------------------------------------------------------------

const NON_STREAM_OK = {
  id: "chatcmpl-mock",
  model: "gpt-x",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hello from momo" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const s = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(s);
}

// track resources for cleanup
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) {
    const c = cleanups.pop()!;
    try {
      await c();
    } catch {
      /* ignore */
    }
  }
});

async function makeRegistryAndGateway(
  mockUrl: string,
  logs: string[],
  model = "deepseek-chat",
  apiFormat: "openai" | "openai-responses" = "openai",
) {
  const registry = new ProviderRegistry({
    records: [
      {
        id: "p1",
        baseUrl: mockUrl,
        apiKey: REAL_KEY,
        model,
        apiFormat,
        opts: {},
      },
    ],
    logSink: (line) => logs.push(line),
  });
  const gw = await startGateway(registry);
  cleanups.push(() => gw.close());
  return { registry, gw, url: `http://127.0.0.1:${gw.port}` };
}

// ---- tests -----------------------------------------------------------------

describe("gateway shell (G3)", () => {
  it("serves a process-owned local hook on its exact path without provider auth", async () => {
    const inputs: unknown[] = [];
    const registry = new ProviderRegistry({ records: [] });
    const hookPath = "/__leemo/hooks/tool-governance-test";
    const hookOutput = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { file_path: "默认工作区/报告.md", content: "body" },
      },
    };
    const gw = await startGateway(registry, {
      hook: {
        path: hookPath,
        handle: (input) => {
          inputs.push(input);
          return hookOutput;
        },
      },
    });
    cleanups.push(() => gw.close());
    const url = `http://127.0.0.1:${gw.port}`;
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "报告.md", content: "body" },
      cwd: "/tmp/workspace",
    };

    const response = await fetch(`${url}${hookPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(hookOutput);
    expect(inputs).toEqual([input]);

    const wrongPath = await fetch(`${url}${hookPath}-other`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(wrongPath.status).toBe(404);
    expect(inputs).toHaveLength(1);
  });

  it("routes a placeholder token to the provider and returns an Anthropic message; real key ONLY in the upstream header (both header forms)", async () => {
    for (const headerForm of ["authorization", "x-api-key"] as const) {
      const logs: string[] = [];
      const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
      cleanups.push(mock.close);
      const { url } = await makeRegistryAndGateway(mock.url, logs);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (headerForm === "authorization") headers["Authorization"] = "Bearer leemo-gw:p1";
      else headers["x-api-key"] = "leemo-gw:p1";

      const resp = await fetch(`${url}/v1/messages?beta=true`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi momo" }],
        }),
      });
      const text = await resp.text();

      expect(resp.status).toBe(200);
      // upstream got the REAL key in its Authorization header
      expect(mock.captured).toHaveLength(1);
      expect(mock.captured[0].authorization).toBe(`Bearer ${REAL_KEY}`);
      // upstream got the exact task/conversation model with one disguise prefix removed
      expect(mock.captured[0].body.model).toBe("sonnet-4-20250514");
      // response is a real Anthropic message, and carries NO real key
      const msg = JSON.parse(text);
      expect(msg.type).toBe("message");
      expect(text).not.toContain(REAL_KEY);
      // gateway logs (if any) carry NO real key
      expect(logs.join("\n")).not.toContain(REAL_KEY);
    }
  });

  it("routes a raw third-party model id exactly so context-window env remains effective", async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, []);

    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(resp.status).toBe(200);
    expect(mock.captured[0].body.model).toBe("deepseek-v4-flash");
  });

  it("preserves a configured real model id that itself begins with claude-", async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, [], "claude-real-upstream-model");

    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "claude-real-upstream-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(resp.status).toBe(200);
    expect(mock.captured[0].body.model).toBe("claude-real-upstream-model");
  });

  it("routes Responses-native providers through /responses and translates the result", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, {
      id: "resp_mock",
      model: "gpt-5.6-sol",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "hello from Responses" }] }],
      usage: { input_tokens: 7, output_tokens: 3 },
    }));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs, "gpt-5.6-sol", "openai-responses");

    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "claude-gpt-5.6-sol",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const body = await resp.json() as any;

    expect(resp.status).toBe(200);
    expect(mock.captured[0].path).toBe("/responses");
    expect(mock.captured[0].body).toMatchObject({ model: "gpt-5.6-sol", max_output_tokens: 64, store: false });
    expect(body.content).toEqual([{ type: "text", text: "hello from Responses" }]);
    expect(body.usage).toMatchObject({ input_tokens: 7, output_tokens: 3 });
  });

  it("beta=true query does not break routing (still classified as messages)", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 50,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(resp.status).toBe(200);
    expect(mock.captured).toHaveLength(1);
    expect(mock.captured[0].path).toContain("/chat/completions");
  });

  it("redacting logger scrubs the real key even when asked to log it verbatim", async () => {
    const logs: string[] = [];
    const registry = new ProviderRegistry({
      records: [{ id: "p1", baseUrl: "http://unused", apiKey: REAL_KEY, model: "m", apiFormat: "openai" }],
      logSink: (line) => logs.push(line),
    });
    registry.logger.info(`about to call upstream with Bearer ${REAL_KEY}`);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(REAL_KEY);
    expect(logs[0]).toContain("about to call upstream");
  });

  it("count_tokens returns a sane positive integer", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages/count_tokens?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "count these tokens please, momo" }],
      }),
    });
    expect(resp.status).toBe(200);
    const j = (await resp.json()) as any;
    expect(typeof j.input_tokens).toBe("number");
    expect(j.input_tokens).toBeGreaterThan(0);
    // count_tokens is local — never touches the upstream
    expect(mock.captured).toHaveLength(0);
  });

  it("/v1/models serves the registry in Anthropic list format with claude- prefixed ids", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/models`);
    expect(resp.status).toBe(200);
    const j = (await resp.json()) as any;
    expect(Array.isArray(j.data)).toBe(true);
    expect(j.data.length).toBe(1);
    expect(j.data[0].type).toBe("model");
    expect(j.data[0].id.startsWith("claude-")).toBe(true);
    expect(j.data[0].id).toBe("claude-deepseek-chat");
  });

  it("/health returns ok", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);
    const resp = await fetch(`${url}/health`);
    expect(resp.status).toBe(200);
    const j = (await resp.json()) as any;
    expect(j.status).toBe("ok");
  });

  it("unknown route → 404 Anthropic error shape", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);
    const resp = await fetch(`${url}/nope/nope`);
    expect(resp.status).toBe(404);
    const j = (await resp.json()) as any;
    expect(j.type).toBe("error");
    expect(j.error.type).toBeTruthy();
  });

  it("bad/unknown placeholder token → 401 Anthropic error shape", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);
    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:does-not-exist" },
      body: JSON.stringify({ model: "x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(resp.status).toBe(401);
    const j = (await resp.json()) as any;
    expect(j.type).toBe("error");
    expect(j.error.type).toBe("authentication_error");
    // upstream never contacted
    expect(mock.captured).toHaveLength(0);
  });

  it("upstream 5xx is mapped to an Anthropic error, with the real key redacted from the message", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => {
      // upstream error body deliberately echoes something key-ish to prove redaction
      sendJson(res, 500, { error: { message: `upstream boom for Bearer ${REAL_KEY}` } });
    });
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(resp.status).toBe(500);
    const text = await resp.text();
    const j = JSON.parse(text);
    expect(j.type).toBe("error");
    expect(j.error.type).toBeTruthy();
    // even though the upstream body embedded the key, the client sees no key
    expect(text).not.toContain(REAL_KEY);
    expect(logs.join("\n")).not.toContain(REAL_KEY);
  });

  it("client abort cancels the upstream request (mock observes its connection close)", async () => {
    const logs: string[] = [];
    // hang mock: send headers + one SSE frame, then hold the connection open.
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "x" } }] })}\n\n`);
      // never end — wait for the client abort to tear the socket down.
    });
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const ac = new AbortController();
    const respP = fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] }),
    });

    const resp = await respP;
    // read the first chunk so we know the stream is flowing, then abort.
    const reader = resp.body!.getReader();
    await reader.read();
    ac.abort();
    try {
      await reader.cancel();
    } catch {
      /* aborted */
    }

    // poll until the mock observes its upstream connection close (gateway aborted it)
    const deadline = Date.now() + 3000;
    while (!mock.closedEarly && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(mock.closedEarly).toBe(true);
  });

  it("SSE passthrough is unbuffered: client sees the first event before the upstream finishes (100-chunk stress)", async () => {
    const logs: string[] = [];
    let upstreamLastSentAt = 0;
    const mock = await startMock(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const write = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      write({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] });
      for (let i = 0; i < 100; i++) {
        write({ choices: [{ index: 0, delta: { content: "x" } }] });
        await new Promise((r) => setTimeout(r, 4)); // ~400ms total emission
      }
      write({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      write({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 100 } });
      res.write("data: [DONE]\n\n");
      upstreamLastSentAt = Date.now();
      res.end();
    });
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 500, stream: true, messages: [{ role: "user", content: "stream" }] }),
    });
    expect(resp.headers.get("content-type")).toContain("text/event-stream");

    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let firstRecvAt = 0;
    let lastRecvAt = 0;
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstRecvAt) firstRecvAt = Date.now();
      lastRecvAt = Date.now();
      body += dec.decode(value, { stream: true });
    }

    // 1) the client received its FIRST byte before the upstream sent its LAST —
    //    impossible if the gateway buffered the whole body.
    expect(firstRecvAt).toBeLessThan(upstreamLastSentAt);
    // 2) the receive window spans a meaningful fraction of the emission window
    //    (not all-at-once). Streaming ⇒ this gap ≈ emission time.
    expect(lastRecvAt - firstRecvAt).toBeGreaterThan(100);
    // 3) it is a well-formed Anthropic stream terminating in message_stop
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
    expect(body).not.toContain(REAL_KEY);
  });

  // ---- B0 additions -------------------------------------------------------

  it("B0-凑手②: stripped server tools produce a log line naming them (observable)", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 200, NON_STREAM_OK));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [{ role: "user", content: "search" }],
        tools: [
          { name: "Read", description: "d", input_schema: { type: "object", properties: {} } },
          { type: "web_search_20250305", name: "web_search" },
          { type: "computer_20250124", name: "computer" },
        ],
      }),
    });
    expect(resp.status).toBe(200);
    // upstream received ONLY the client tool
    const wireTools = (mock.captured[0].body.tools ?? []).map((t: any) => t.function?.name);
    expect(wireTools).toEqual(["Read"]);
    // and the gateway logged the strip, naming both server tools
    const logLine = logs.find((l) => l.includes("stripped") && l.includes("server tool"));
    expect(logLine).toBeDefined();
    expect(logLine).toContain("web_search");
    expect(logLine).toContain("computer");
  });

  it("B0-低优: upstream 401 maps to a 502 api_error (upstream auth failed), NOT a client 401", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => {
      sendJson(res, 401, { error: { message: `invalid upstream key Bearer ${REAL_KEY}` } });
    });
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    // client sees 502 — the gateway token WAS valid; the failure is upstream-side.
    expect(resp.status).toBe(502);
    const text = await resp.text();
    const j = JSON.parse(text);
    expect(j.type).toBe("error");
    expect(j.error.type).toBe("api_error");
    expect(j.error.message.toLowerCase()).toContain("upstream");
    // no key leak in body or logs
    expect(text).not.toContain(REAL_KEY);
    expect(logs.join("\n")).not.toContain(REAL_KEY);
  });

  it("B0-低优: upstream 403 also maps to 502 api_error", async () => {
    const logs: string[] = [];
    const mock = await startMock((_req, res) => sendJson(res, 403, { error: { message: "forbidden" } }));
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(resp.status).toBe(502);
    const j = (await resp.json()) as any;
    expect(j.error.type).toBe("api_error");
  });

  it("B0-凑手①: waitForDrain resolves on close even when drain never fires (no hang)", async () => {
    // A fake writable whose 'drain' NEVER fires — only 'close' does. The old
    // `res.once("drain", resolve)` would hang here forever; waitForDrain must
    // resolve on 'close' and detach every listener (no leak).
    const handlers = new Map<string, Array<() => void>>();
    let attached = 0;
    let detached = 0;
    const fake = {
      once(event: string, cb: () => void) {
        attached++;
        const arr = handlers.get(event) ?? [];
        arr.push(cb);
        handlers.set(event, arr);
        return this;
      },
      off(event: string, cb: () => void) {
        detached++;
        const arr = (handlers.get(event) ?? []).filter((h) => h !== cb);
        handlers.set(event, arr);
        return this;
      },
    };
    const p = waitForDrain(fake);
    // fire ONLY close — drain never comes
    for (const cb of handlers.get("close") ?? []) cb();
    await expect(p).resolves.toBeUndefined();
    // all three listeners registered, and all detached (no leak)
    expect(attached).toBe(3);
    expect(detached).toBe(3);
  });

  it("B0-凑手①: backpressure + client disconnect does not hang the pump (drain race)", async () => {
    const logs: string[] = [];
    // Emit a large burst then hold the connection open. The gateway's res.write
    // returns false under backpressure; if the client disconnects while the pump
    // is awaiting 'drain', a drain-only wait would hang forever. The fix resolves
    // that wait on close/error too — so the pump tears down promptly.
    const mock = await startMock(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] })}\n\n`);
      // a big content delta to force backpressure on the downstream socket
      const big = "y".repeat(2_000_000);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: big } }] })}\n\n`);
      // never end — wait for the client abort.
    });
    cleanups.push(mock.close);
    const { url } = await makeRegistryAndGateway(mock.url, logs);

    const ac = new AbortController();
    const resp = await fetch(`${url}/v1/messages?beta=true`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer leemo-gw:p1" },
      body: JSON.stringify({ model: "x", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    const reader = resp.body!.getReader();
    await reader.read(); // pull the first event so the pump is mid-flight
    ac.abort();
    try { await reader.cancel(); } catch { /* aborted */ }

    // The gateway must observe its upstream connection close (proving the pump
    // did NOT hang on a never-firing drain). Poll with a hard deadline.
    const deadline = Date.now() + 3000;
    while (!mock.closedEarly && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(mock.closedEarly).toBe(true);
  });
});
