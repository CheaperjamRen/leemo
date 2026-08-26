// Leemo gateway — provider registry + redacting logger (first-party).
//
// The registry is the ONLY place a real upstream key lives at runtime. The SDK
// child process is handed a placeholder token `leemo-gw:<providerId>`; the shell
// resolves that id here to the real {baseUrl, apiKey, model, opts}. Real keys
// never leave this process: they ride out only in the upstream Authorization
// header the server builds, and the redacting logger scrubs any key-shaped
// substring before a line reaches a sink.

import type { ProviderOpts } from "./core/provider-opts";

/** One upstream provider. `apiKey` is the REAL secret — memory-only. */
export interface ProviderRecord {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Every configured model. `model` remains the default/fallback. */
  models?: string[];
  apiFormat: "openai" | "openai-responses";
  /** Extra upstream headers. Authorization is always replaced by apiKey. */
  headers?: Record<string, string>;
  /** Per-provider translation switches (see core/provider-opts). */
  opts?: Partial<ProviderOpts>;
}

/** A resolved provider ready for a call: never logged whole (carries the key). */
export interface ResolvedProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  apiFormat: "openai" | "openai-responses";
  headers?: Record<string, string>;
  opts: Partial<ProviderOpts>;
}

export type LogSink = (line: string) => void;

/** Redacting logger: scrubs key-shaped substrings from every line before it
 *  reaches the sink. Belt-and-suspenders — the shell already avoids logging
 *  keys, but any accidental interpolation is neutralised here. */
export interface RedactingLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Patterns for secret material we refuse to emit. Extended with the concrete
 *  registered keys so even short/odd-shaped keys are caught verbatim. */
function buildRedactor(secrets: string[]): (line: string) => string {
  // longest-first so a key that is a prefix of another is fully masked
  const literals = [...new Set(secrets.filter((s) => s.length >= 4))].sort(
    (a, b) => b.length - a.length
  );
  return (line: string): string => {
    let out = line;
    for (const s of literals) {
      if (out.includes(s)) out = out.split(s).join("[REDACTED]");
    }
    // generic bearer/sk- shapes as a backstop for keys we weren't told about
    out = out.replace(/\b(sk|xai|gsk|glm|Bearer)[-_ ][A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
    return out;
  };
}

export interface RegistryInit {
  /** A getter keeps the long-lived desktop gateway in sync after settings save. */
  records: ProviderRecord[] | (() => ProviderRecord[]);
  /** where redacted log lines go; defaults to console.error. */
  logSink?: LogSink;
}

export class ProviderRegistry {
  private readonly records: () => ProviderRecord[];
  private readonly sink: LogSink;
  readonly logger: RedactingLogger;

  constructor(init: RegistryInit) {
    const records = init.records;
    this.records = typeof records === "function"
      ? records
      : () => records;
    this.sink = init.logSink ?? ((line) => console.error(line));
    const emit = (level: string, msg: string) => {
      const secrets = this.records().flatMap((record) => [
        record.apiKey,
        ...Object.values(record.headers ?? {}),
      ]);
      this.sink(`[${level}] ${buildRedactor(secrets)(msg)}`);
    };
    this.logger = {
      info: (m) => emit("info", m),
      warn: (m) => emit("warn", m),
      error: (m) => emit("error", m),
      debug: (m) => emit("debug", m),
    };
  }

  /** Resolve a placeholder-token provider id to its real record, or undefined
   *  if unknown (→ 401 at the shell). */
  resolve(id: string): ResolvedProvider | undefined {
    const rec = this.records().find((candidate) => candidate.id === id);
    if (!rec) return undefined;
    return {
      id: rec.id,
      baseUrl: rec.baseUrl,
      apiKey: rec.apiKey,
      model: rec.model,
      ...(rec.models ? { models: [...rec.models] } : {}),
      apiFormat: rec.apiFormat,
      ...(rec.headers ? { headers: { ...rec.headers } } : {}),
      opts: rec.opts ?? {},
    };
  }

  /** Ids of all registered providers (used by /v1/models). */
  ids(): string[] {
    return this.records().map((record) => record.id);
  }

  /** Models exposed to gateway-model-discovery, each disguised behind a
   *  `claude-` prefix so the SDK surfaces it (id needs claude/anthropic
   *  prefix). Returns {id (disguised), providerId, model (real)}. */
  models(): Array<{ id: string; providerId: string; model: string }> {
    return this.records().flatMap((record) =>
      [...new Set([record.model, ...(record.models ?? [])])]
        .filter((model) => model.trim().length > 0)
        .map((model) => ({
          id: `claude-${model}`,
          providerId: record.id,
          model,
        })),
    );
  }
}

/** Build a registry from RELAY2_* env vars for `gateway:dev`. Returns an empty
 *  registry (no records) when unset — dev.ts reports that readably rather than
 *  throwing. Never called from tests (tests construct instances directly). */
export function fromEnv(env: NodeJS.ProcessEnv = process.env): {
  registry: ProviderRegistry;
  configured: boolean;
  missing: string[];
} {
  const baseUrl = env.RELAY2_BASE_URL?.trim();
  const apiKey = env.RELAY2_API_KEY?.trim();
  const model = env.RELAY2_MODEL?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push("RELAY2_BASE_URL");
  if (!apiKey) missing.push("RELAY2_API_KEY");
  if (!model) missing.push("RELAY2_MODEL");

  // Optional per-provider ProviderOpts channel (B0). Absent/blank → empty opts.
  // Malformed JSON is a config error surfaced via `missing` (dev.ts reports it),
  // NEVER silently dropped — booting with ignored opts would hide real misconfig.
  let opts: Partial<ProviderOpts> = {};
  const rawOpts = env.RELAY2_OPTS?.trim();
  if (rawOpts) {
    try {
      const parsed = JSON.parse(rawOpts);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("RELAY2_OPTS must be a JSON object");
      }
      opts = parsed as Partial<ProviderOpts>;
    } catch {
      missing.push("RELAY2_OPTS");
    }
  }

  if (missing.length) {
    return { registry: new ProviderRegistry({ records: [] }), configured: false, missing };
  }
  const registry = new ProviderRegistry({
    records: [
      { id: "relay2", baseUrl: baseUrl!, apiKey: apiKey!, model: model!, apiFormat: "openai", opts },
    ],
  });
  return { registry, configured: true, missing: [] };
}
