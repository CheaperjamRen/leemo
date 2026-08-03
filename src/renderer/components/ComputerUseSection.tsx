import { useEffect } from "react";
import { LoaderCircle, MonitorUp, ShieldCheck } from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { McpServersState } from "../stores/mcp-servers";

export function ComputerUseSection({ store }: { store: StoreApi<McpServersState> }): React.JSX.Element {
  const { list, status, saving, tests } = useStore(store);
  const computer = list.find((server) => server.builtin === "computer");
  const busy = computer ? saving[computer.id] === true : false;
  const test = computer ? tests[computer.id] : undefined;
  const testPending = test !== undefined && "pending" in test;

  useEffect(() => {
    if (status === "idle") void store.getState().refresh();
  }, [status, store]);

  if (status === "loading" && !computer) {
    return <section className="mb-9" aria-label="操作电脑"><p className="text-sm text-[var(--leemo-ink-2)]">正在检查电脑操作组件…</p></section>;
  }
  if (!computer) {
    return (
      <section className="mb-9" aria-label="操作电脑">
        <h2 className="text-xl font-medium text-[var(--leemo-ink)]">操作电脑</h2>
        <p role="alert" className="mt-2 text-sm text-[var(--leemo-danger)]">电脑操作组件没有加载，请重启 Leemo 后再试。</p>
      </section>
    );
  }

  const readyText = test && !("pending" in test) && test.ok
    ? `电脑操作已就绪 · ${test.tools.length} 项能力${test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ""}`
    : undefined;

  return (
    <section className="mb-9" id="settings-computer">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--leemo-line)] pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorUp className="h-5 w-5 text-[var(--leemo-amber)]" aria-hidden />
            <h2 className="text-xl font-medium text-[var(--leemo-ink)]">操作电脑</h2>
          </div>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--leemo-ink-2)]">
            momo 可以查看桌面，并在 Windows 应用里点击、滚动和输入。屏幕内容会发送给当前模型；密码、验证码和登录由你接管。
          </p>
        </div>
        <label className={`flex shrink-0 items-center gap-2 text-xs ${computer.available ? "cursor-pointer text-[var(--leemo-ink-2)]" : "cursor-not-allowed text-[var(--leemo-ink-3)]"}`}>
          <input
            aria-label="操作电脑 启用"
            type="checkbox"
            checked={computer.enabled}
            disabled={!computer.available || busy}
            onChange={(event) => void store.getState().setEnabled(computer, event.target.checked)}
          />
          {computer.enabled ? "已启用" : "未启用"}
        </label>
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-3 pt-3">
        <button
          type="button"
          onClick={() => void store.getState().test(computer.id)}
          disabled={!computer.available || testPending}
          className="inline-flex min-w-[124px] items-center justify-center gap-2 rounded-[6px] border border-[var(--leemo-line)] px-3 py-2 text-xs font-medium text-[var(--leemo-ink)] hover:bg-[var(--leemo-work-hover)] disabled:opacity-50"
        >
          {testPending ? <LoaderCircle className="h-3.5 w-3.5 leemo-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          {testPending ? "检查中…" : "检查电脑操作"}
        </button>
        {readyText ? <span className="text-xs text-[var(--leemo-ok)]">{readyText}</span> : null}
        {test && !("pending" in test) && !test.ok ? <span role="alert" className="text-xs text-[var(--leemo-danger)]">{test.error ?? "电脑操作检查失败，请重试。"}</span> : null}
        {!computer.available ? <span role="status" className="text-xs text-[var(--leemo-danger)]">当前系统没有可用的电脑操作组件</span> : null}
      </div>
      <p className="text-[11px] leading-5 text-[var(--leemo-ink-3)]">开启后，每项新任务首次操作时确认一次；发送、发布、付款、删除和覆盖等最终动作仍会单独确认。完全访问模式不会重复询问。</p>
    </section>
  );
}
