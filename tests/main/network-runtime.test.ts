import { describe, expect, it, vi } from "vitest";
import { createElectronNetworkRuntime } from "../../src/main/network-runtime";

describe("electron network runtime", () => {
  it("applies system, direct and manual modes to one reusable session", async () => {
    const runtimeSession = {
      setProxy: vi.fn(async () => undefined),
      resolveProxy: vi.fn(async () => "PROXY 127.0.0.1:10801; DIRECT"),
      fetch: vi.fn(async () => new Response("ok")),
    };
    const runtime = createElectronNetworkRuntime(runtimeSession);

    await runtime.apply({ mode: "auto" });
    expect(runtimeSession.setProxy).toHaveBeenLastCalledWith({ mode: "system" });
    expect(runtime.env()).toMatchObject({ HTTPS_PROXY: "http://127.0.0.1:10801" });

    await runtime.apply({ mode: "direct" });
    expect(runtimeSession.setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
    expect(runtime.env().HTTPS_PROXY).toBe("");

    await runtime.apply({ mode: "manual", manualProxyUrl: "http://proxy.test:8080" });
    expect(runtimeSession.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "fixed_servers",
      proxyRules: "http://proxy.test:8080",
    }));
    expect(runtime.env().HTTPS_PROXY).toBe("http://proxy.test:8080");
  });
});
