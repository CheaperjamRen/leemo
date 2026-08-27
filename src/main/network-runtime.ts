import {
  buildNetworkProxyEnv,
  electronProxyConfig,
  type NetworkRuntimeConfig,
} from "../host/network-runtime";

export interface ElectronNetworkSession {
  setProxy(config: ReturnType<typeof electronProxyConfig>): Promise<void>;
  resolveProxy(url: string): Promise<string>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface ElectronNetworkRuntime {
  apply(config: NetworkRuntimeConfig): Promise<void>;
  config(): NetworkRuntimeConfig;
  env(): Record<string, string>;
  fetch: typeof fetch;
}

export function createElectronNetworkRuntime(runtimeSession: ElectronNetworkSession): ElectronNetworkRuntime {
  let current: NetworkRuntimeConfig = { mode: "auto" };
  let proxyEnv = buildNetworkProxyEnv(current);

  const apply = async (config: NetworkRuntimeConfig): Promise<void> => {
    await runtimeSession.setProxy(electronProxyConfig(config));
    const resolved = config.mode === "auto"
      ? await runtimeSession.resolveProxy("https://api.anthropic.com/")
      : undefined;
    current = config;
    proxyEnv = buildNetworkProxyEnv(config, resolved);
  };

  const fetchWithRuntime = ((input: string | URL | Request, init?: RequestInit) => (
    runtimeSession.fetch(input, init)
  )) as typeof fetch;

  return {
    apply,
    config: () => ({ ...current }),
    env: () => ({ ...proxyEnv }),
    fetch: fetchWithRuntime,
  };
}
