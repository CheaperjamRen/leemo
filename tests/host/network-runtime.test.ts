import { describe, expect, it } from "vitest";
import {
  buildNetworkProxyEnv,
  normalizeNetworkConfig,
  parseResolvedProxy,
} from "../../src/host/network-runtime";

describe("network runtime configuration", () => {
  it("defaults to the system proxy and extracts the first usable proxy route", () => {
    expect(normalizeNetworkConfig({})).toEqual({ mode: "auto" });
    expect(parseResolvedProxy("PROXY 127.0.0.1:10801; DIRECT")).toBe("http://127.0.0.1:10801");
    expect(buildNetworkProxyEnv({ mode: "auto" }, "PROXY 127.0.0.1:10801; DIRECT")).toMatchObject({
      HTTP_PROXY: "http://127.0.0.1:10801",
      HTTPS_PROXY: "http://127.0.0.1:10801",
      NO_PROXY: "127.0.0.1,localhost,::1",
    });
  });

  it("makes direct mode explicit so an inherited shell proxy cannot leak in", () => {
    expect(buildNetworkProxyEnv({ mode: "direct" })).toEqual({
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost,::1",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      no_proxy: "127.0.0.1,localhost,::1",
    });
  });

  it("accepts a credential-free manual HTTP proxy and rejects unsafe URLs", () => {
    expect(normalizeNetworkConfig({ mode: "manual", manualProxyUrl: "http://127.0.0.1:10801" })).toEqual({
      mode: "manual",
      manualProxyUrl: "http://127.0.0.1:10801",
    });
    expect(() => normalizeNetworkConfig({ mode: "manual", manualProxyUrl: "http://name:secret@proxy.test:8080" }))
      .toThrow("代理地址不能包含账号或密码");
    expect(() => normalizeNetworkConfig({ mode: "manual", manualProxyUrl: "file:///C:/proxy" }))
      .toThrow("仅支持 HTTP、HTTPS 或 SOCKS 代理");
  });
});
