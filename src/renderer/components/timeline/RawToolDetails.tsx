import type { TimelineItem } from "../../stores/message-model";
import { toolOutcomeLabel } from "../tool-labels";

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

export default function RawToolDetails({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const input = inputRecord(item.input);
  const shell = isShellTool(item.name) && typeof input?.command === "string";
  const result = item.summary?.trim() || (item.status === "running" ? "等待返回结果" : "没有返回内容");
  const statusLabel = toolOutcomeLabel(item.outcome, STATUS_LABEL[item.status]);

  return (
    <div
      data-testid="raw-tool-details"
      className="max-h-72 select-text overflow-auto border-t border-[var(--leemo-line-soft)] bg-[var(--leemo-card)] px-3 py-2.5 text-[11.5px] text-[var(--leemo-ink-2)]"
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[12px] font-medium text-[var(--leemo-ink)]">{shell ? "Shell" : item.name}</span>
        <span className="text-[10.5px] text-[var(--leemo-ink-3)]">{statusLabel}</span>
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
            <h5 className="mb-1 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">{item.status === "error" ? "错误" : "输出"}</h5>
            <pre data-testid="raw-tool-output" className="whitespace-pre-wrap break-words font-mono leading-5 text-[var(--leemo-ink-2)]">{result}</pre>
          </section>
        </div>
      ) : (
        <div className="space-y-2.5">
          <section>
            <h5 className="mb-1 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">参数</h5>
            <pre className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 font-mono leading-5 text-[var(--leemo-ink)]">{serializeInput(item.input)}</pre>
          </section>
          <section>
            <h5 className="mb-1 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">返回结果</h5>
            <pre data-testid="raw-tool-output" className="whitespace-pre-wrap break-words font-mono leading-5 text-[var(--leemo-ink-2)]">{result}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
