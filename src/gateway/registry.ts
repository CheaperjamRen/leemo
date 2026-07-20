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
  apiFormat: "openai";
  /** Per-provider translation switches (see core/provider-opts). */
  opts?: Partial<ProviderOpts>;
}

/** A resolved provider ready for a call: never logged whole (carries the key). */
export interface ResolvedProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
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
  records: ProviderRecord[];
  /** where redacted log lines go; defaults to console.error. */
  logSink?: LogSink;
}

export class ProviderRegistry {
  private readonly map = new Map<string, ProviderRecord>();
  private readonly redact: (line: string) => string;
  private readonly sink: LogSink;
  readonly logger: RedactingLogger;

  constructor(init: RegistryInit) {
    for (const r of init.records) this.map.set(r.id, r);
    this.sink = init.logSink ?? ((line) => console.error(line));
    this.redact = buildRedactor(init.records.map((r) => r.apiKey));
    const emit = (level: string, msg: string) =>
      this.sink(`[${level}] ${this.redact(msg)}`);
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
    const rec = this.map.get(id);
    if (!rec) return undefined;
    return {
      id: rec.id,
      baseUrl: rec.baseUrl,
      apiKey: rec.apiKey,
      model: rec.model,
      opts: rec.opts ?? {},
    };
  }

  /** Ids of all registered providers (used by /v1/models). */
  ids(): string[] {
    return [...this.map.keys()];
  }

  /** Models exposed to gateway-model-discovery, each disguised behind a
   *  `claude-` prefix so the SDK surfaces it (id needs claude/anthropic
   *  prefix). Returns {id (disguised), providerId, model (real)}. */
  models(): Array<{ id: string; providerId: string; model: string }> {
    return [...this.map.values()].map((r) => ({
      id: `claude-${r.model}`,
      providerId: r.id,
      model: r.model,
    }));
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

  if (missing.length) {
    return { registry: new ProviderRegistry({ records: [] }), configured: false, missing };
  }
  const registry = new ProviderRegistry({
    records: [
      { id: "relay2", baseUrl: baseUrl!, apiKey: apiKey!, model: model!, apiFormat: "openai", opts: {} },
    ],
  });
  return { registry, configured: true, missing: [] };
}
