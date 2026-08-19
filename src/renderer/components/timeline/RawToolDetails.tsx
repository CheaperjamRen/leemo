import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { TimelineItem } from "../../stores/message-model";
import { toolActionLabel, toolOutcomeLabel } from "../tool-labels";

const STATUS_LABEL = { running: "进行中", ok: "完成", error: "失败" } as const;

function serializeInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    return String(input);
  }
}

function inputRecord(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function isShellTool(name: string): boolean {
  return /^(?:bash|shell|powershell|command)$/i.test(name);
}

function RawCopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      aria-label={copied ? `已复制${label}` : `复制${label}`}
      title={copied ? "已复制" : `复制${label}`}
      onClick={() => void copy()}
      className="inline-grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );
}

export default function RawToolDetails({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const input = inputRecord(item.input);
  const shell = isShellTool(item.name) && typeof input?.command === "string";
  const result = item.summary?.trim() || (item.status === "running" ? "等待返回结果" : "没有返回内容");
  const serializedInput = serializeInput(item.input);
  const statusLabel = toolOutcomeLabel(item.outcome, STATUS_LABEL[item.status]);
  const actionLabel = shell ? "执行命令" : toolActionLabel(item.name);

  return (
    <div
      data-testid="raw-tool-details"
      className="leemo-raw-tool-details max-h-44 select-text overflow-auto border-t border-[var(--leemo-line-soft)] bg-[var(--leemo-card)]/72 px-3 py-2 text-[11.5px] text-[var(--leemo-ink-2)]"
    >
      <header className="mb-2 flex items-center gap-1.5">
        <span className="text-[12px] font-medium text-[var(--leemo-ink)]" title={item.name}>{actionLabel}</span>
        <span className="text-[10.5px] text-[var(--leemo-ink-3)]">· {statusLabel}</span>
      </header>
      {item.userFeedback?.trim() ? (
        <section className="mb-2 rounded-[6px] border border-[var(--leemo-line-soft)] bg-[var(--leemo-panel)] px-2.5 py-2">
          <h5 className="mb-1 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">用户说明</h5>
          <p className="whitespace-pre-wrap break-words leading-5 text-[var(--leemo-ink-2)]">{item.userFeedback.trim()}</p>
        </section>
      ) : null}
      {shell ? (
        <div className="space-y-2">
          <pre
            data-testid="raw-tool-command"
            className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 font-mono leading-5 text-[var(--leemo-ink)]"
          ><span className="select-none text-[var(--leemo-ink-3)]">$ </span>{String(input?.command)}</pre>
          {typeof input?.cwd === "string" && input.cwd ? (
            <p className="flex min-w-0 gap-2 text-[10.5px] text-[var(--leemo-ink-3)]">
              <span className="shrink-0">工作目录</span>
              <span className="min-w-0 break-all font-mono text-[var(--leemo-ink-2)]">{input.cwd}</span>
            </p>
          ) : null}
          <section>
            <div className="mb-1 flex items-center justify-between gap-2"><h5 className="text-[10.5px] font-medium text-[var(--leemo-ink-3)]">{item.status === "error" ? "错误" : "输出"}</h5><RawCopyButton value={result} label={item.status === "error" ? "错误" : "输出"} /></div>
            <pre data-testid="raw-tool-output" className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 font-mono leading-5 text-[var(--leemo-ink-2)]">{result}</pre>
          </section>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2 lg:items-start">
          <section className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2"><h5 className="text-[10.5px] font-medium text-[var(--leemo-ink-3)]">参数</h5><RawCopyButton value={serializedInput} label="参数" /></div>
            <pre className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 font-mono leading-5 text-[var(--leemo-ink)]">{serializedInput}</pre>
          </section>
          <section className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2"><h5 className="text-[10.5px] font-medium text-[var(--leemo-ink-3)]">返回结果</h5><RawCopyButton value={result} label="返回结果" /></div>
            <pre data-testid="raw-tool-output" className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 font-mono leading-5 text-[var(--leemo-ink-2)]">{result}</pre>
          </section>
        </div>
      )}
      <footer className="mt-2 border-t border-[var(--leemo-line-soft)] pt-2 text-[10.5px] text-[var(--leemo-ink-3)]">{statusLabel} · 原始记录</footer>
    </div>
  );
}
