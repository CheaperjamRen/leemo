// Leemo gateway — HTTP shell (first-party). 127.0.0.1 only.
//
// Endpoint face the claude-agent-sdk hits (Anthropic wire):
//   POST /v1/messages(?beta=true)          → translate → upstream OpenAI → back
//   POST /v1/messages/count_tokens         → local o200k_base estimate
//   GET  /v1/models                        → registry, claude- disguised ids
//   GET  /health                           → { status: "ok" }
//
// Key isolation: the SDK sends a placeholder `leemo-gw:<providerId>` (via
// Authorization: Bearer … OR x-api-key: …). The shell resolves it in the
// registry to the REAL {baseUrl, apiKey, model, opts}; the real key rides out
// ONLY in the upstream Authorization header this file builds. It is never put in
// a client response or an un-redacted log line.
//
// Consumes ONLY the G2 core facade (translate / tokens) + the registry — never
// the vendor transformer or its types (type-firewall).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { anthropicToOpenAI, openaiToAnthropicResponse, openaiToAnthropicStream } from "./core/translate";
import { anthropicToResponses, responsesToAnthropicResponse, responsesToAnthropicStream } from "./core/responses";
import { countTokens, classifyEndpoint } from "./core/tokens";
import type { AnthropicChatRequest } from "./core/normalize";
import { ProviderRegistry, type ResolvedProvider } from "./registry";

export interface GatewayHandle {
  port: number;
  close: () => Promise<void>;
}

export interface GatewayHookRoute {
  /** Exact, process-owned route. Callers should include an unguessable token. */
  path: string;
  handle: (input: unknown) => unknown | Promise<unknown>;
}

export interface GatewayOptions {
  hook?: GatewayHookRoute;
  fetchFn?: typeof fetch;
}

const PLACEHOLDER_PREFIX = "leemo-gw:";

type GatewayFailureKind = "network" | "auth" | "permission" | "model_missing" | "quota" | "rate_limit" | "server";

interface GatewayFailureMetadata {
  source: "upstream";
  status: number;
  kind: GatewayFailureKind;
}

/** Anthropic error envelope with a small sanitized Leemo extension. */
function anthropicError(
  type: string,
  message: string,
  failure?: GatewayFailureMetadata,
): { type: "error"; error: { type: string; message: string; leemo_failure?: GatewayFailureMetadata } } {
  return { type: "error", error: { type, message, ...(failure ? { leemo_failure: failure } : {}) } };
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendError(
  res: ServerResponse,
  status: number,
  type: string,
  message: string,
  failure?: GatewayFailureMetadata,
): void {
  sendJson(res, status, anthropicError(type, message, failure));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Extract `<providerId>` from Authorization: Bearer leemo-gw:<id> OR
 *  x-api-key: leemo-gw:<id>. The SDK may use either header. */
function parseProviderId(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  const xkey = req.headers["x-api-key"];
  const candidates: string[] = [];
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    candidates.push(m ? m[1].trim() : auth.trim());
  }
  if (typeof xkey === "string") candidates.push(xkey.trim());
  for (const c of candidates) {
    if (c.startsWith(PLACEHOLDER_PREFIX)) {
      const id = c.slice(PLACEHOLDER_PREFIX.length).trim();
      if (id) return id;
    }
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Await socket backpressure relief WITHOUT the classic hang (B0 凑手①).
 *  `res.write` returning false means we must wait for 'drain' before writing
 *  more — but if the client disconnects mid-wait, 'drain' NEVER fires and a
 *  bare `res.once("drain", resolve)` promise leaks forever. Resolve on 'close'
 *  and 'error' too, and always detach the listeners so nothing lingers. Accepts
 *  the minimal structural surface so it can be unit-tested with a fake emitter. */
export function waitForDrain(res: {
  once: (event: string, cb: () => void) => unknown;
  off?: (event: string, cb: () => void) => unknown;
  removeListener?: (event: string, cb: () => void) => unknown;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    const detach = (res.off ?? res.removeListener)?.bind(res);
    const done = () => {
      if (detach) {
        detach("drain", onDrain);
        detach("close", onEnd);
        detach("error", onEnd);
      }
      resolve();
    };
    const onDrain = () => done();
    const onEnd = () => done();
    res.once("drain", onDrain);
    res.once("close", onEnd);
    res.once("error", onEnd);
  });
}

/** Map an upstream HTTP status to an Anthropic error type. Message is generic —
 *  we NEVER echo the upstream body (it may embed the key).
 *
 *  NOTE (B0 低优): upstream 401/403 are handled specially in handleMessages —
 *  they map to a 502 api_error ("upstream auth failed"), NOT a client 401. A
 *  client 401 is reserved for an invalid gateway placeholder token; if the
 *  gateway token was valid but the REAL upstream key was rejected, that is an
 *  upstream/config failure the client cannot fix by re-authenticating. */
function upstreamErrorType(status: number): string {
  if (status === 404) return "not_found_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

function upstreamFailure(status: number, rawBody: string): { kind: GatewayFailureKind; type: string; marker: string } {
  let bodyType = "";
  let bodyCode = "";
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const nested = parsed.error && typeof parsed.error === "object"
      ? parsed.error as Record<string, unknown>
      : undefined;
    bodyType = String(nested?.type ?? parsed.type ?? "").toLowerCase();
    bodyCode = String(parsed.code ?? nested?.code ?? "").toLowerCase();
  } catch {
    // Upstream bodies are diagnostic input only. Invalid JSON falls back to status.
  }
  if (status === 401 || bodyType.includes("authentication") || bodyCode === "invalidapikey") {
    return { kind: "auth", type: "authentication_error", marker: "LEEMO_UPSTREAM_AUTH" };
  }
  if (status === 403) {
    return { kind: "permission", type: "permission_error", marker: "LEEMO_UPSTREAM_PERMISSION" };
  }
  if (status === 402) return { kind: "quota", type: "permission_error", marker: "LEEMO_UPSTREAM_QUOTA" };
  if (status === 404) return { kind: "model_missing", type: "not_found_error", marker: "LEEMO_UPSTREAM_MODEL_MISSING" };
  if (status === 429) return { kind: "rate_limit", type: "rate_limit_error", marker: "LEEMO_UPSTREAM_RATE_LIMIT" };
  return { kind: "server", type: upstreamErrorType(status), marker: "LEEMO_UPSTREAM_SERVER" };
}

/** POST /v1/messages(?beta=true): translate → upstream → back (stream or not). */
async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  registry: ProviderRegistry,
  fetchFn: typeof fetch,
): Promise<void> {
  const providerId = parseProviderId(req);
  if (!providerId) {
    sendError(res, 401, "authentication_error", "missing or malformed gateway token");
    return;
  }
  const provider: ResolvedProvider | undefined = registry.resolve(providerId);
  if (!provider) {
    sendError(res, 401, "authentication_error", "unknown gateway provider token");
    return;
  }

  let anthropicReq: AnthropicChatRequest;
  try {
    anthropicReq = JSON.parse(await readBody(req)) as AnthropicChatRequest;
  } catch (e) {
    sendError(res, 400, "invalid_request_error", `invalid JSON body: ${errMessage(e)}`);
    return;
  }

  const wantStream = anthropicReq.stream === true;
  const useResponses = provider.apiFormat === "openai-responses";

  // ---- translate anthropic → openai (G2 core) ----
  let openaiBody;
  let stripped;
  try {
    const out = useResponses
      ? anthropicToResponses(anthropicReq, provider.opts)
      : await anthropicToOpenAI(anthropicReq, provider.opts);
    openaiBody = out.result;
    stripped = out.stripped;
  } catch (e) {
    sendError(res, 400, "invalid_request_error", `request translation failed: ${errMessage(e)}`);
    return;
  }
  // New runtimes accept a raw third-party id and then honor its configured
  // context-window env. Older sessions may still resume with the historical
  // `claude-` disguise, so accept both spellings at this boundary.
  const requestedModel = anthropicReq.model?.trim();
  const exactConfiguredModel = requestedModel !== undefined
    && new Set([provider.model, ...(provider.models ?? [])]).has(requestedModel);
  openaiBody.model = !exactConfiguredModel
    && requestedModel?.startsWith("claude-")
    && requestedModel.length > "claude-".length
    ? requestedModel.slice("claude-".length)
    : requestedModel || provider.model;
  if (stripped.length) {
    registry.logger.info(`stripped ${stripped.length} server tool(s): ${stripped.map((t) => t.name ?? t.type ?? "?").join(", ")}`);
  }

  // ---- upstream call: real key ONLY here ----
  const ac = new AbortController();
  // client disconnect → abort upstream (and stop pumping).
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      ac.abort();
    }
  });

  const upstreamUrl = `${provider.baseUrl.replace(/\/+$/, "")}/${useResponses ? "responses" : "chat/completions"}`;
  let upstream: Response;
  try {
    const upstreamHeaders = new Headers(provider.headers);
    upstreamHeaders.set("Content-Type", "application/json");
    upstreamHeaders.set("Authorization", `Bearer ${provider.apiKey}`);
    upstream = await fetchFn(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(openaiBody),
      signal: ac.signal,
    });
  } catch (e) {
    if (clientGone || ac.signal.aborted) return; // client bailed; nothing to send
    registry.logger.error(`upstream fetch failed: ${errMessage(e)}`);
    if (!res.headersSent) sendError(res, 502, "api_error", "upstream request failed");
    return;
  }

  if (!upstream.ok) {
    // Read for local classification, then discard. Never echo or log this body:
    // several providers include credential fragments in their error text.
    let upstreamBody = "";
    try {
      upstreamBody = await upstream.text();
    } catch {
      /* ignore */
    }
    registry.logger.warn(`upstream returned ${upstream.status}`);
    const failure = upstreamFailure(upstream.status, upstreamBody);
    if (!res.headersSent) sendError(
      res,
      upstream.status,
      failure.type,
      `${failure.marker} upstream provider rejected the request`,
      { source: "upstream", status: upstream.status, kind: failure.kind },
    );
    return;
  }

  if (!wantStream) {
    // ---- non-stream: one OpenAI ChatCompletion → one Anthropic Message ----
    let openaiJson: unknown;
    try {
      openaiJson = await upstream.json();
    } catch (e) {
      if (!res.headersSent) sendError(res, 502, "api_error", `invalid upstream JSON: ${errMessage(e)}`);
      return;
    }
    try {
      const anthropicMsg = useResponses
        ? responsesToAnthropicResponse(openaiJson)
        : await openaiToAnthropicResponse(openaiJson);
      if (!res.headersSent) sendJson(res, 200, anthropicMsg);
    } catch (e) {
      if (!res.headersSent) sendError(res, 502, "api_error", `response translation failed: ${errMessage(e)}`);
    }
    return;
  }

  // ---- streaming: OpenAI SSE → Anthropic SSE, piped UNBUFFERED ----
  if (!upstream.body) {
    if (!res.headersSent) sendError(res, 502, "api_error", "upstream returned no stream body");
    return;
  }
  let converted: ReadableStream<Uint8Array>;
  try {
    converted = useResponses
      ? responsesToAnthropicStream(upstream.body as unknown as ReadableStream<Uint8Array>, { signal: ac.signal })
      : await openaiToAnthropicStream(upstream.body as unknown as ReadableStream<Uint8Array>, {
          request: anthropicReq,
          opts: provider.opts,
        });
  } catch (e) {
    if (!res.headersSent) sendError(res, 502, "api_error", `stream translation failed: ${errMessage(e)}`);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const reader = converted.getReader();
  res.on("close", () => {
    // stop reading upstream the moment the client is gone.
    if (!res.writableEnded) reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed || clientGone) break;
      const ok = res.write(Buffer.from(value));
      if (!ok) await waitForDrain(res);
    }
    if (!res.writableEnded) res.end();
  } catch (e) {
    // upstream aborted (client gone) or stream error — tear down cleanly.
    if (!clientGone) registry.logger.error(`stream pump error: ${errMessage(e)}`);
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}

/** POST /v1/messages/count_tokens: local estimate, no upstream. */
async function handleCountTokens(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: AnthropicChatRequest;
  try {
    body = JSON.parse(await readBody(req)) as AnthropicChatRequest;
  } catch (e) {
    sendError(res, 400, "invalid_request_error", `invalid JSON body: ${errMessage(e)}`);
    return;
  }
  sendJson(res, 200, { input_tokens: countTokens(body) });
}

/** GET /v1/models: Anthropic list format, claude- disguised ids. */
function handleModels(res: ServerResponse, registry: ProviderRegistry): void {
  const now = Math.floor(Date.now() / 1000);
  const data = registry.models().map((m) => ({
    type: "model",
    id: m.id,
    display_name: m.id,
    created_at: new Date(now * 1000).toISOString(),
  }));
  sendJson(res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
}

export async function startGateway(
  registry: ProviderRegistry,
  options: GatewayOptions = {},
): Promise<GatewayHandle> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const method = (req.method ?? "GET").toUpperCase();
    const face = classifyEndpoint(url);

    const run = async (): Promise<void> => {
      try {
        if (options.hook !== undefined && method === "POST" && url === options.hook.path) {
          let input: unknown;
          try {
            input = JSON.parse(await readBody(req)) as unknown;
          } catch {
            sendError(res, 400, "invalid_request_error", "invalid JSON body");
            return;
          }
          sendJson(res, 200, (await options.hook.handle(input)) ?? {});
          return;
        }
        if (face.kind === "health" && method === "GET") {
          sendJson(res, 200, { status: "ok" });
          return;
        }
        if (face.kind === "models" && method === "GET") {
          handleModels(res, registry);
          return;
        }
        if (face.kind === "count_tokens" && method === "POST") {
          await handleCountTokens(req, res);
          return;
        }
        if (face.kind === "messages" && method === "POST") {
          await handleMessages(req, res, registry, options.fetchFn ?? fetch);
          return;
        }
        sendError(res, 404, "not_found_error", `no route for ${method} ${url}`);
      } catch (e) {
        registry.logger.error(`unhandled request error: ${errMessage(e)}`);
        if (!res.headersSent) sendError(res, 500, "api_error", "internal gateway error");
        else if (!res.writableEnded) res.end();
      }
    };
    void run();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
