// Leemo Bridge — instant balance fetch (Task B2, 用户 7/21 拍板).
//
// Scope: ONE-SHOT balance lookup per provider, right now, on demand. Today's/
// 7-day usage summaries are OUT OF SCOPE here — that needs SQLite (Phase 1);
// its IPC contract types are reserved in B3's contract.ts, not built here.
//
// Per-provider support matrix, verified against each vendor's official docs:
//   - deepseek: MANDATORY, real endpoint, implemented below.
//   - kimi:     documented official endpoint, implemented below.
//   - glm:      NO documented public balance API (only an unofficial,
//               cookie-auth, no-API-key reverse-engineered endpoint the
//               vendor could pull at any time) → supported:false, by design.
//   - anything else: unknown provider → supported:false, fetchFn never called.
//
// fetchFn is injected (deps.fetchFn) so this module makes zero live calls in
// tests. Errors (network throw, non-2xx) are caught and turned into
// {supported:false, raw:<redacted summary>} — never a thrown exception, and
// never a raw string containing the caller's apiKey (mirrors B1's
// sanitizeHostEnv discipline: secrets must not leak into logs/UI via `raw`).

/** What callers pass in: the minimal provider shape balance.ts needs. Kept
 *  structural (not importing B1's `Provider` type) so this module only
 *  requires the fields it actually reads — no coupling to providers.ts's
 *  full shape (models/modelCapabilities/envTemplate etc. are irrelevant here). */
export interface BalanceProviderLike {
  id: string;
  apiFormat: "anthropic" | "openai" | "openai-responses";
  baseUrl: string;
  apiKey: string;
  /** Provider FAMILY (轮 3 卡 F). Dispatch keys off this, falling back to `id`.
   *
   *  Since 卡 F, `id` is an INSTANCE id: a user's second DeepSeek account is
   *  `deepseek-work`, which matches no fetcher — so dispatching on `id` alone
   *  would silently drop balance support for every non-canonical instance.
   *  Optional so existing callers (where id === kind) keep working unchanged. */
  kind?: string;
}

export interface BalanceDeps {
  fetchFn: typeof fetch;
}

export interface BalanceInfo {
  supported: boolean;
  totalUsd?: number;
  totalCny?: number;
  granted?: number;
  toppedUp?: number;
  raw?: unknown;
}

/** Redact a caller's apiKey out of an error/response summary before it is
 *  allowed into BalanceInfo.raw. Belt-and-suspenders: callers should never
 *  echo the key into an error message in the first place, but this is the
 *  last line of defense before `raw` reaches a log or UI surface. */
function redact(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>");
}

function summarizeError(err: unknown, apiKey: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redact(msg, apiKey);
}

// ---------------------------------------------------------------------------
// DeepSeek — GET https://api.deepseek.com/user/balance
// Official docs: https://api-docs.deepseek.com/api/get-user-balance/
// (fetched 2026-07-21). Response shape:
//   { is_available: boolean,
//     balance_infos: [{ currency: 'CNY'|'USD', total_balance: string,
//                        granted_balance: string, topped_up_balance: string }] }
// All balance amounts are STRINGS in the real API (confirmed against the
// official page directly — a GitHub OpenAPI mirror we cross-checked disagreed
// with this schema and was NOT used).
// ---------------------------------------------------------------------------

interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}
interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: DeepSeekBalanceInfo[];
}

async function fetchDeepSeekBalance(
  provider: BalanceProviderLike,
  fetchFn: typeof fetch
): Promise<BalanceInfo> {
  try {
    const res = await fetchFn("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    } as RequestInit);

    if (!res.ok) {
      return { supported: false, raw: `deepseek balance HTTP ${res.status}` };
    }

    const body = (await res.json()) as DeepSeekBalanceResponse;
    const infos = body.balance_infos ?? [];
    const usd = infos.find((b) => b.currency === "USD");
    const cny = infos.find((b) => b.currency === "CNY");
    const primary = usd ?? cny ?? infos[0];

    if (!primary) {
      return { supported: true, raw: body };
    }

    const info: BalanceInfo = { supported: true };
    if (usd) info.totalUsd = Number(usd.total_balance);
    if (cny) info.totalCny = Number(cny.total_balance);
    info.granted = Number(primary.granted_balance);
    info.toppedUp = Number(primary.topped_up_balance);
    return info;
  } catch (e) {
    return { supported: false, raw: summarizeError(e, provider.apiKey) };
  }
}

// ---------------------------------------------------------------------------
// Kimi (Moonshot) — GET https://api.moonshot.cn/v1/users/me/balance
// Official docs: https://platform.moonshot.cn/docs/api/balance
// (fetched 2026-07-21). Response shape:
//   { code: number, data: { available_balance: number, voucher_balance:
//     number, cash_balance: number }, scode: string, status: boolean }
// Unlike DeepSeek, amounts here are NUMBERS, not strings (per the official
// example response) — parsed as-is, no Number() coercion needed.
// Moonshot bills in CNY (platform.moonshot.cn is the CN-billed platform) —
// available_balance is a yuan amount, NOT USD. Must map to totalCny, never
// totalUsd (an earlier draft mislabeled this, inflating the displayed balance).
// ---------------------------------------------------------------------------

interface KimiBalanceResponse {
  code?: number;
  data?: { available_balance?: number; voucher_balance?: number; cash_balance?: number };
  status?: boolean;
}

async function fetchKimiBalance(
  provider: BalanceProviderLike,
  fetchFn: typeof fetch
): Promise<BalanceInfo> {
  try {
    const res = await fetchFn("https://api.moonshot.cn/v1/users/me/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    } as RequestInit);

    if (!res.ok) {
      return { supported: false, raw: `kimi balance HTTP ${res.status}` };
    }

    const body = (await res.json()) as KimiBalanceResponse;
    if (!body.data) {
      return { supported: true, raw: body };
    }

    return {
      supported: true,
      totalCny: body.data.available_balance,
    };
  } catch (e) {
    return { supported: false, raw: summarizeError(e, provider.apiKey) };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Providers with NO documented public balance API. Explicit allow-listing
 *  (rather than "default to supported") means adding a new provider id never
 *  silently gains balance support — someone has to research it first. */
const UNSUPPORTED: ReadonlySet<string> = new Set([
  "glm",
  // 通义/百炼 (轮 3 卡 F): no documented public balance endpoint — the console
  // shows credit, the API does not expose it. Listed explicitly so a future
  // reader sees this was researched, not overlooked.
  "qwen",
]);

const FETCHERS: Record<string, (p: BalanceProviderLike, f: typeof fetch) => Promise<BalanceInfo>> = {
  deepseek: fetchDeepSeekBalance,
  kimi: fetchKimiBalance,
};

/**
 * Fetch a provider's current balance via its official API, if one is known.
 * Zero live calls in tests: `deps.fetchFn` is injected. Never throws — every
 * failure path (unknown provider, network error, non-2xx, unexpected body)
 * resolves to `{supported:false, ...}`, and `raw` is redacted of the caller's
 * apiKey before being returned.
 */
export async function fetchBalance(
  provider: BalanceProviderLike,
  deps: BalanceDeps
): Promise<BalanceInfo> {
  // Family, not instance: `deepseek-work` must reach the deepseek fetcher.
  const family = provider.kind ?? provider.id;
  if (UNSUPPORTED.has(family)) {
    return { supported: false };
  }
  const fetcher = FETCHERS[family];
  if (!fetcher) {
    return { supported: false };
  }
  return fetcher(provider, deps.fetchFn);
}
