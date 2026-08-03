import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Globe2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useStore } from "zustand";
import type { BrowserConnectionMode } from "../../bridge/contract";
import type { McpServersState } from "../stores/mcp-servers";
import type { StoreApi } from "zustand/vanilla";

const EXTENSION_URL = "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";

export function BrowserAutomationSection({ store }: { store: StoreApi<McpServersState> }): React.JSX.Element {
  const { list, status, saving, tests } = useStore(store);
  const browser = list.find((server) => server.builtin === "playwright");
  const busy = browser ? saving[browser.id] === true : false;
  const savedMode = browser?.browserMode ?? "managed";
  const [draftMode, setDraftMode] = useState<BrowserConnectionMode>();
  const mode = draftMode ?? savedMode;
  const test = browser && mode === savedMode ? tests[browser.id] : undefined;
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (status === "idle") void store.getState().refresh();
  }, [status, store]);

  useEffect(() => {
    setDraftMode(undefined);
  }, [browser?.id, savedMode]);

  const saveBrowser = async (
    browserMode: BrowserConnectionMode,
    extra?: { env?: Record<string, string> },
  ): Promise<boolean> => {
    if (!browser) return false;
    setError(undefined);
    const result = await store.getState().save({
      id: browser.id,
      name: browser.name,
      description: browser.description,
      transport: browser.transport,
      enabled: browser.enabled,
      browserMode,
      timeoutMs: browser.timeoutMs,
      alwaysLoad: browser.alwaysLoad,
      ...extra,
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  };

  const changeMode = async (nextMode: BrowserConnectionMode): Promise<void> => {
    if (nextMode === mode || busy) return;
    setError(undefined);
    if (nextMode === "extension") {
      setDraftMode("extension");
      return;
    }
    if (savedMode === "managed") {
      setDraftMode(undefined);
      return;
    }
    setDraftMode("managed");
    const ok = await saveBrowser("managed");
    if (!ok) setDraftMode(savedMode);
  };

  const saveExtension = async (): Promise<void> => {
    if (!browser) return;
    const cleanToken = token.trim();
    const ok = await saveBrowser("extension", cleanToken
      ? { env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: cleanToken } }
      : undefined);
    if (!ok) return;
    setToken("");
    setDraftMode(undefined);
    await store.getState().test(browser.id);
  };

  if (status === "loading" && !browser) {
    return <section className="mb-9" aria-label="浏览器自动化"><p className="text-sm text-[var(--leemo-ink-2)]">正在检查浏览器…</p></section>;
  }

  if (!browser) {
    return (
      <section className="mb-9" aria-label="浏览器自动化">
        <h2 className="text-xl font-medium text-[var(--leemo-ink)]">浏览器自动化</h2>
        <p role="alert" className="mt-2 text-sm text-[var(--leemo-danger)]">浏览器组件没有加载，请重启 Leemo 后再试。</p>
      </section>
    );
  }

  const testPending = test !== undefined && "pending" in test;
  const readyText = test && !("pending" in test) && test.ok
    ? `浏览器已就绪 · ${test.tools.length} 项能力${test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ""}`
    : undefined;
  const waitingForBrowser = test && !("pending" in test) && !test.ok && test.state === "waiting-for-browser";

  return (
    <section className="mb-9" id="settings-browser">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--leemo-line)] pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-[var(--leemo-amber)]" aria-hidden />
            <h2 className="text-xl font-medium text-[var(--leemo-ink)]">浏览器自动化</h2>
          </div>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--leemo-ink-2)]">
            momo 可以浏览网页、填写表单和完成重复操作。遇到登录或验证码时，会停在当前页面让你接管，完成后继续。
          </p>
        </div>
        <label className={`flex shrink-0 items-center gap-2 text-xs ${browser.available ? "cursor-pointer text-[var(--leemo-ink-2)]" : "cursor-not-allowed text-[var(--leemo-ink-3)]"}`}>
          <input
            aria-label="浏览器自动化 启用"
            type="checkbox"
            checked={browser.enabled}
            disabled={!browser.available || busy}
            onChange={(event) => void store.getState().setEnabled(browser, event.target.checked)}
          />
          {browser.enabled ? "已启用" : "未启用"}
        </label>
      </div>

      <div className="py-4">
        <p className="mb-2 text-xs font-medium text-[var(--leemo-ink-2)]">使用哪个浏览器身份</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="浏览器连接方式">
          <button
            type="button"
            aria-label="Leemo 浏览器"
            aria-pressed={mode === "managed"}
            disabled={busy || !browser.available}
            onClick={() => void changeMode("managed")}
            className="min-h-[78px] rounded-[8px] border px-3.5 py-3 text-left transition-colors disabled:opacity-50"
            style={{
              borderColor: mode === "managed" ? "var(--leemo-amber)" : "var(--leemo-line)",
              background: mode === "managed" ? "var(--leemo-amber-bg)" : "var(--leemo-card)",
            }}
          >
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-[var(--leemo-ink)]">
              Leemo 浏览器
              {mode === "managed" ? <CheckCircle2 className="h-4 w-4 text-[var(--leemo-amber)]" aria-hidden /> : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--leemo-ink-2)]">独立身份，登录状态只保存在本机，不影响日常 Chrome。</span>
          </button>
          <button
            type="button"
            aria-label="当前 Chrome"
            aria-pressed={mode === "extension"}
            disabled={busy || !browser.available}
            onClick={() => void changeMode("extension")}
            className="min-h-[78px] rounded-[8px] border px-3.5 py-3 text-left transition-colors disabled:opacity-50"
            style={{
              borderColor: mode === "extension" ? "var(--leemo-amber)" : "var(--leemo-line)",
              background: mode === "extension" ? "var(--leemo-amber-bg)" : "var(--leemo-card)",
            }}
          >
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-[var(--leemo-ink)]">
              当前 Chrome
              {mode === "extension" ? <CheckCircle2 className="h-4 w-4 text-[var(--leemo-amber)]" aria-hidden /> : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--leemo-ink-2)]">复用已经打开的标签页和登录状态，需要安装浏览器连接扩展。</span>
          </button>
        </div>
      </div>

      {mode === "extension" ? (
        <div className="border-y border-[var(--leemo-line-soft)] py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--leemo-ink)]">连接当前 Chrome</p>
              <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-2)]">不填令牌也能使用，但浏览器会在每次连接时请你确认。</p>
            </div>
            <a href={EXTENSION_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--leemo-amber-strong)] hover:underline">
              安装浏览器连接扩展 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="浏览器连接令牌"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={browser.envKeys.includes("PLAYWRIGHT_MCP_EXTENSION_TOKEN") ? "已安全保存；留空保持不变" : "可选：粘贴扩展中显示的连接令牌"}
              className="min-w-0 flex-1 rounded-[6px] border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
            />
            <button type="button" onClick={() => void saveExtension()} disabled={busy || testPending} className="rounded-[6px] bg-[var(--leemo-ink)] px-4 py-2 text-xs font-medium text-white disabled:opacity-50">
              保存并检查连接
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-11 flex-wrap items-center gap-3 pt-3">
        {mode === savedMode ? (
          <button
            type="button"
            onClick={() => void store.getState().test(browser.id)}
            disabled={!browser.available || testPending}
            className="inline-flex min-w-[110px] items-center justify-center gap-2 rounded-[6px] border border-[var(--leemo-line)] px-3 py-2 text-xs font-medium text-[var(--leemo-ink)] hover:bg-[var(--leemo-work-hover)] disabled:opacity-50"
          >
            {testPending ? <LoaderCircle className="h-3.5 w-3.5 leemo-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            {testPending ? "检查中…" : "检查浏览器"}
          </button>
        ) : (
          <span className="text-xs text-[var(--leemo-ink-3)]">保存后会自动检查连接</span>
        )}
        {readyText ? <span className="text-xs text-[var(--leemo-ok)]">{readyText}</span> : null}
        {waitingForBrowser ? <span role="status" className="text-xs text-[var(--leemo-amber-strong)]">{test.error}</span> : null}
        {test && !("pending" in test) && !test.ok && !waitingForBrowser ? <span role="alert" className="text-xs text-[var(--leemo-danger)]">{test.error ?? "浏览器连接失败，请检查连接方式。"}</span> : null}
        {!browser.available ? <span role="status" className="text-xs text-[var(--leemo-danger)]">没有找到可用的 Chrome 或 Edge</span> : null}
        {error ? <span role="alert" className="text-xs text-[var(--leemo-danger)]">{error}</span> : null}
      </div>
      <p className="text-[11px] leading-5 text-[var(--leemo-ink-3)]">浏览、点击和输入不会逐步打断；上传文件、执行网页脚本和最终提交等敏感动作仍会确认。</p>
    </section>
  );
}
