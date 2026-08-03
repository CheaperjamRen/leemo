import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { McpServerDraft, McpServerView, McpTransport } from "../../bridge/contract";
import type { McpServersState } from "../stores/mcp-servers";

function parsePairs(text: string, separator: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(separator);
    if (at <= 0) throw new Error(`“${line}”缺少 ${separator}`);
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!key || !value) throw new Error(`“${line}”缺少名称或值`);
    out[key] = value;
  }
  return out;
}

function ServerForm({
  store,
  initial,
  onDone,
}: {
  store: StoreApi<McpServersState>;
  initial?: McpServerView;
  onDone: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? "stdio");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [argsText, setArgsText] = useState((initial?.args ?? []).join("\n"));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [clearEnv, setClearEnv] = useState(false);
  const [clearHeaders, setClearHeaders] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    initial?.timeoutMs !== undefined ? String(Math.round(initial.timeoutMs / 1_000)) : "10",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const saving = useStore(store, (state) => state.saving[initial?.id ?? "__new__"] === true);

  const submit = async (): Promise<void> => {
    try {
      const env = envText.trim() ? parsePairs(envText, "=") : clearEnv ? {} : undefined;
      const headers = headersText.trim() ? parsePairs(headersText, ":") : clearHeaders ? {} : undefined;
      const seconds = Number(timeoutSeconds);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) {
        throw new Error("连接超时需在 1 到 300 秒之间");
      }
      const draft: McpServerDraft = {
        id: initial?.id,
        name,
        description,
        transport,
        enabled,
        timeoutMs: Math.round(seconds * 1_000),
        ...(transport === "stdio"
          ? { command, args: argsText.split(/\r?\n/).filter((arg) => arg.length > 0) }
          : { url }),
        ...(env !== undefined ? { env } : {}),
        ...(headers !== undefined ? { headers } : {}),
      };
      const result = await store.getState().save(draft);
      if (!result.ok) throw new Error(result.error);
      onDone();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "配置不完整");
    }
  };

  return (
    <div data-testid="mcp-server-form" className="border-y border-[var(--leemo-line)] py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-[var(--leemo-ink-2)]">
          名称
          <input
            aria-label="MCP 名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 text-sm text-[var(--leemo-ink)]"
          />
        </label>
        <label className="col-span-2 text-xs text-[var(--leemo-ink-2)]">
          说明
          <input
            aria-label="MCP 说明"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 text-sm text-[var(--leemo-ink)]"
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-xs text-[var(--leemo-ink-2)]">连接方式</legend>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--leemo-line)]">
          {(["stdio", "http", "sse"] as const).map((value) => (
            <label key={value} className={`cursor-pointer px-3 py-1.5 text-xs ${transport === value ? "bg-[var(--leemo-accent-soft)] text-[var(--leemo-ink)]" : "text-[var(--leemo-ink-2)]"}`}>
              <input
                type="radio"
                name={`mcp-transport-${initial?.id ?? "new"}`}
                value={value}
                checked={transport === value}
                onChange={() => setTransport(value)}
                className="sr-only"
              />
              {value === "stdio" ? "本地命令" : value === "http" ? "HTTP" : "SSE"}
            </label>
          ))}
        </div>
      </fieldset>

      {transport === "stdio" ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-[var(--leemo-ink-2)]">
            启动命令
            <input aria-label="MCP 启动命令" value={command} onChange={(event) => setCommand(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 text-sm text-[var(--leemo-ink)]" />
          </label>
          <label className="text-xs text-[var(--leemo-ink-2)]">
            参数（每行一个）
            <textarea aria-label="MCP 参数" value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 font-mono text-xs text-[var(--leemo-ink)]" />
          </label>
        </div>
      ) : (
        <label className="mt-3 block text-xs text-[var(--leemo-ink-2)]">
          MCP 地址
          <input aria-label="MCP 地址" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 text-sm text-[var(--leemo-ink)]" />
        </label>
      )}

      <details className="mt-3 border-t border-[var(--leemo-line-soft)] pt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--leemo-ink-2)]">凭据与高级选项</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-[var(--leemo-ink-2)]">
            环境变量（KEY=VALUE）
            <textarea aria-label="MCP 环境变量" value={envText} onChange={(event) => setEnvText(event.target.value)} rows={4} placeholder={initial?.envKeys.length ? `已保存：${initial.envKeys.join("、")}；留空不改` : "每行一个"} className="mt-1 w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 font-mono text-xs text-[var(--leemo-ink)]" />
          </label>
          <label className="text-xs text-[var(--leemo-ink-2)]">
            请求头（Header: value）
            <textarea aria-label="MCP 请求头" value={headersText} onChange={(event) => setHeadersText(event.target.value)} rows={4} placeholder={initial?.headerKeys.length ? `已保存：${initial.headerKeys.join("、")}；留空不改` : "每行一个"} className="mt-1 w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 font-mono text-xs text-[var(--leemo-ink)]" />
          </label>
          {initial?.envKeys.length ? (
            <label className="flex items-center gap-2 text-xs text-[var(--leemo-ink-2)]"><input type="checkbox" checked={clearEnv} onChange={(event) => setClearEnv(event.target.checked)} />清除已存环境变量</label>
          ) : null}
          {initial?.headerKeys.length ? (
            <label className="flex items-center gap-2 text-xs text-[var(--leemo-ink-2)]"><input type="checkbox" checked={clearHeaders} onChange={(event) => setClearHeaders(event.target.checked)} />清除已存请求头</label>
          ) : null}
          <label className="text-xs text-[var(--leemo-ink-2)]">连接超时（秒）<input aria-label="MCP 连接超时" type="number" min="1" max="300" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-2 text-sm text-[var(--leemo-ink)]" /></label>
          <label className="flex items-center gap-2 self-end py-2 text-xs text-[var(--leemo-ink-2)]"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />保存后启用</label>
        </div>
      </details>

      {error ? <p role="alert" className="mt-3 text-xs text-[var(--leemo-danger)]">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs text-[var(--leemo-ink-2)]">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving} className="rounded-md bg-[var(--leemo-ink)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{saving ? "保存中…" : "保存 MCP"}</button>
      </div>
    </div>
  );
}

function ServerRow({
  server,
  store,
  onEdit,
}: {
  server: McpServerView;
  store: StoreApi<McpServersState>;
  onEdit: () => void;
}): React.JSX.Element {
  const test = useStore(store, (state) => state.tests[server.id]);
  const testPending = test !== undefined && "pending" in test;
  const saving = useStore(store, (state) => state.saving[server.id] === true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggleError, setToggleError] = useState(false);

  const toggle = async (enabled: boolean): Promise<void> => {
    setToggleError(false);
    if (!await store.getState().setEnabled(server, enabled)) setToggleError(true);
  };

  return (
    <div className="border-b border-[var(--leemo-line-soft)] py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--leemo-ink)]">{server.name}</span>
            {server.builtin ? <span className="rounded bg-[var(--leemo-line-soft)] px-1.5 py-0.5 text-[10px] text-[var(--leemo-ink-3)]">内置</span> : null}
            <span className="text-[10.5px] uppercase text-[var(--leemo-ink-3)]">{server.transport}</span>
          </div>
          {server.description ? <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-2)]">{server.description}</p> : null}
          {server.command ? <p className="mt-1 truncate font-mono text-[10.5px] text-[var(--leemo-ink-3)]">{server.command} {(server.args ?? []).join(" ")}</p> : null}
          {server.url ? <p className="mt-1 truncate font-mono text-[10.5px] text-[var(--leemo-ink-3)]">{server.url}</p> : null}
          {(server.envKeys.length > 0 || server.headerKeys.length > 0) ? (
            <p className="mt-1 text-[10.5px] text-[var(--leemo-ink-3)]">已加密保存：{[...server.envKeys, ...server.headerKeys].join("、")}</p>
          ) : null}
        </div>
        <label className={`flex shrink-0 items-center gap-2 text-xs ${server.available ? "cursor-pointer text-[var(--leemo-ink-2)]" : "cursor-not-allowed text-[var(--leemo-ink-3)]"}`}>
          <input aria-label={`${server.name} 启用`} type="checkbox" checked={server.enabled} disabled={!server.available || saving} onChange={(event) => void toggle(event.target.checked)} />
          {server.enabled ? "已启用" : "未启用"}
        </label>
      </div>

      <div className="mt-2.5 flex min-h-7 items-center gap-2">
        <button type="button" onClick={() => void store.getState().test(server.id)} disabled={!server.available || testPending} className="rounded-md border border-[var(--leemo-line)] px-2.5 py-1 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)] disabled:opacity-50">{testPending ? "测试中…" : "测试"}</button>
        {!server.builtin ? <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)]">编辑</button> : null}
        {!server.builtin && !confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-md px-2 py-1 text-xs text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)]">删除</button> : null}
        {confirmDelete ? (
          <><span className="text-xs text-[var(--leemo-danger)]">确认删除？</span><button type="button" onClick={() => void store.getState().remove(server.id)} className="rounded-md bg-[var(--leemo-danger)] px-2 py-1 text-xs text-white">确认</button><button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--leemo-ink-2)]">取消</button></>
        ) : null}
        {test && !("pending" in test) && test.ok ? <span className="text-xs text-[var(--leemo-ok-ink,#25734b)]">已连接 · {test.tools.length} 个工具{test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ""}</span> : null}
        {test && !("pending" in test) && !test.ok ? <span role="alert" className="text-xs text-[var(--leemo-danger)]">{test.error}</span> : null}
        {toggleError ? <span role="alert" className="text-xs text-[var(--leemo-danger)]">没有保存成功</span> : null}
        {!server.available ? <span role="status" className="text-xs text-[var(--leemo-danger)]">运行组件不可用</span> : null}
      </div>
      {test && !("pending" in test) && test.ok && test.tools.length > 0 ? (
        <p className="mt-1.5 truncate text-[10.5px] text-[var(--leemo-ink-3)]">{test.tools.slice(0, 8).map((tool) => tool.name).join(" · ")}</p>
      ) : null}
    </div>
  );
}

export function McpServersSection({ store }: { store: StoreApi<McpServersState> }): React.JSX.Element {
  const { list, status, error } = useStore(store);
  const customServers = list.filter((server) => !server.builtin);
  const [editing, setEditing] = useState<string | "__new__" | null>(null);

  useEffect(() => {
    if (status === "idle") void store.getState().refresh();
  }, [status, store]);

  return (
    <section className="mb-8" id="settings-mcp">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium text-[var(--leemo-ink)]">其他连接器（MCP）</h2>
          <p className="mt-1 text-xs text-[var(--leemo-ink-2)]">连接第三方工具和数据源；已启用的服务器会在当前对话下一轮接入。</p>
        </div>
        <button type="button" onClick={() => setEditing("__new__")} className="rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs font-medium text-[var(--leemo-ink)] hover:bg-[var(--leemo-work-hover)]">添加 MCP</button>
      </div>
      {status === "loading" ? <p className="py-3 text-xs text-[var(--leemo-ink-2)]">正在读取 MCP…</p> : null}
      {status === "error" ? <p role="alert" className="py-3 text-xs text-[var(--leemo-danger)]">{error}</p> : null}
      <div className="border-y border-[var(--leemo-line)]">
        {customServers.map((server) => (
          editing === server.id
            ? <ServerForm key={server.id} store={store} initial={server} onDone={() => setEditing(null)} />
            : <ServerRow key={server.id} server={server} store={store} onEdit={() => setEditing(server.id)} />
        ))}
        {status === "ready" && customServers.length === 0 && editing !== "__new__" ? (
          <p className="py-4 text-xs text-[var(--leemo-ink-3)]">还没有添加其他连接器。</p>
        ) : null}
      </div>
      {editing === "__new__" ? <ServerForm store={store} onDone={() => setEditing(null)} /> : null}
    </section>
  );
}
