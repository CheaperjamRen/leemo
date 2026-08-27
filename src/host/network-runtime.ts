export type NetworkMode = "auto" | "direct" | "manual";

export type NetworkRuntimeConfig =
  | { mode: "auto" }
  | { mode: "direct" }
  | { mode: "manual"; manualProxyUrl: string };

const LOCAL_BYPASS = "127.0.0.1,localhost,::1";

function normalizeManualProxyUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("请输入代理地址。");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("代理地址格式不正确。");
  }
  if (!new Set(["http:", "https:", "socks:", "socks5:"]).has(url.protocol)) {
    throw new Error("仅支持 HTTP、HTTPS 或 SOCKS 代理。");
  }
  if (url.username || url.password) throw new Error("代理地址不能包含账号或密码。");
  if (!url.hostname || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("代理地址只填写协议、主机和端口。");
  }
  return url.toString().replace(/\/$/u, "");
}

export function normalizeNetworkConfig(value: unknown): NetworkRuntimeConfig {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = record.mode === "direct" || record.mode === "manual" ? record.mode : "auto";
  if (mode === "manual") {
    return { mode, manualProxyUrl: normalizeManualProxyUrl(record.manualProxyUrl) };
  }
  return { mode };
}

export function parseResolvedProxy(value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const candidate of value.split(";")) {
    const [kindRaw, addressRaw] = candidate.trim().split(/\s+/, 2);
    const kind = kindRaw?.toUpperCase();
    const address = addressRaw?.trim();
    if (!address || kind === "DIRECT") continue;
    if (kind === "PROXY" || kind === "HTTPS") return `http://${address}`;
    if (kind === "SOCKS" || kind === "SOCKS5") return `socks5://${address}`;
  }
  return undefined;
}

export function buildNetworkProxyEnv(
  config: NetworkRuntimeConfig,
  resolvedProxy?: string,
): Record<string, string> {
  const proxy = config.mode === "manual"
    ? config.manualProxyUrl
    : config.mode === "auto"
      ? parseResolvedProxy(resolvedProxy)
      : undefined;
  const httpProxy = proxy?.startsWith("socks") ? "" : proxy ?? "";
  const allProxy = proxy?.startsWith("socks") ? proxy : "";
  return {
    HTTP_PROXY: httpProxy,
    HTTPS_PROXY: httpProxy,
    ALL_PROXY: allProxy,
    NO_PROXY: LOCAL_BYPASS,
    http_proxy: httpProxy,
    https_proxy: httpProxy,
    all_proxy: allProxy,
    no_proxy: LOCAL_BYPASS,
  };
}

export function electronProxyConfig(config: NetworkRuntimeConfig): {
  mode: "system" | "direct" | "fixed_servers";
  proxyRules?: string;
  proxyBypassRules?: string;
} {
  if (config.mode === "auto") return { mode: "system" };
  if (config.mode === "direct") return { mode: "direct" };
  return {
    mode: "fixed_servers",
    proxyRules: config.manualProxyUrl,
    proxyBypassRules: "127.0.0.1;localhost;[::1]",
  };
}
