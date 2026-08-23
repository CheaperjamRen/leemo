import type { ApprovalTier, RiskLevel } from "../../bridge/contract";
import { Check, Shield } from "lucide-react";
import { useApprovals } from "../bridge/context";
import { useSettings } from "../bridge/context";
import { isMcpToolName, toolActionLabel } from "./tool-labels";

interface ApprovalBarProps {
  runId: string;
  density?: "default" | "buddy";
  /** Show only the approval(s) raised by this specific tool call. Set when the
   *  bar is rendered next to its tool inside the process fold. */
  toolUseId?: string;
  /** Show only approvals that could NOT be anchored to a tool in this turn
   *  (no toolUseId, or an unknown one). The turn-level fallback so a permission
   *  prompt is never invisible — an unseen prompt stalls the round. */
  unanchoredOnly?: boolean;
  /** Exact interaction ids to render. TurnBlock supplies this for fallback
   * approvals so even an older host's unknown toolUseId cannot be mistaken for
   * an anchored card and silently disappear. */
  interactionIds?: ReadonlySet<string>;
  state?: "all" | "pending" | "resolved";
}

function verbOf(toolName: string): string {
  return toolActionLabel(toolName);
}

function isShellToolName(toolName: string): boolean {
  return /^(?:bash|shell|powershell|command)$/i.test(toolName);
}

export default function ApprovalBar({
  runId,
  density = "default",
  toolUseId,
  unanchoredOnly,
  interactionIds,
  state = "all",
}: ApprovalBarProps) {
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const resolvedByRun = useApprovals((s) => s.resolvedByRun);
  const decide = useApprovals((s) => s.decide);
  const dangerousCommandCaching = useSettings((s) => s.dangerousCommandCaching);

  // The set of tool calls this turn already anchored. Only the fallback bar
  // needs it; anchored bars match their own id directly.
  const anchorable = new Set<string>();
  if (unanchoredOnly) {
    for (const r of resolvedByRun[runId] ?? []) {
      if (r.kind === "approval" && r.toolUseId) anchorable.add(r.toolUseId);
    }
  }

  // Which approvals belong to this instance of the bar. Anchored bars take the
  // ones matching their tool call; the turn-level fallback takes the leftovers.
  const claims = (candidateId: string, candidateToolUseId: string | undefined): boolean => {
    if (interactionIds) return interactionIds.has(candidateId);
    if (toolUseId !== undefined) return candidateToolUseId === toolUseId;
    if (unanchoredOnly) return candidateToolUseId === undefined || !anchorable.has(candidateToolUseId);
    return true;
  };

  // Find pending approval for this run
  const pending = state === "resolved" ? undefined : Object.values(pendingByConversation).find(
    (p) => p?.kind === "approval" && p.runId === runId && claims(p.id, p.toolUseId)
  );

  // Find resolved approvals for this run
  const resolved = state === "pending" ? [] : (resolvedByRun[runId] ?? []).filter(
    (r) => r.kind === "approval" && claims(r.id, r.toolUseId)
  );

  if (!pending && resolved.length === 0) return null;

  // Render resolved approvals (gray archived state)
  const resolvedCards = resolved.map((r) => {
    if (r.kind !== "approval") return null;
    const outcomeLabels: Record<typeof r.outcome, string> = {
      "allow-once": "已允许一次",
      "allow-conversation": r.taskScope === "computer-control"
        ? "本次任务已允许电脑操作"
        : isShellToolName(r.toolName)
        ? "本次任务已允许命令"
        : isMcpToolName(r.toolName)
          ? "本次任务已允许这项操作"
          : "本次任务已允许此类操作",
      "allow-permanent": "已始终允许此类操作",
      deny: "已拒绝",
      cancelled: "已取消",
      expired: "已超时拒绝",
    };
    if (density === "buddy") {
      return (
        <div
          key={r.id}
          className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-[11.5px] text-[var(--leemo-ink-3)]"
        >
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ok)]" aria-hidden />
          <span className="truncate">{verbOf(r.toolName)} · {outcomeLabels[r.outcome]}</span>
        </div>
      );
    }
    return (
      <div
        key={r.id}
        data-testid="resolved-approval-receipt"
        className="flex min-h-9 min-w-0 items-center gap-2 rounded-[8px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)] px-3 py-2 text-[12px]"
        title={r.inputSummary}
      >
        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ok)]" aria-hidden />
        <span className="shrink-0 text-[var(--leemo-ink-2)]">{verbOf(r.toolName)}</span>
        <span className="min-w-0 truncate text-[var(--leemo-ink-3)]">· {outcomeLabels[r.outcome]}</span>
      </div>
    );
  });

  // Render pending approval (interactive state)
  if (pending?.kind !== "approval") {
    return <>{resolvedCards}</>;
  }

  const dangerLocked = pending.risk === "dangerous" && !dangerousCommandCaching;
  const mcpScoped = isMcpToolName(pending.toolName);
  const taskScope = pending.taskScope
    ?? (isShellToolName(pending.toolName)
      ? "shell-command"
      : mcpScoped
        ? "exact-input"
        : "tool-class");
  const shellScoped = taskScope === "shell-command";
  const exactScoped = taskScope === "exact-input";
  const computerScoped = taskScope === "computer-control";
  const canRememberConversation = !dangerLocked;
  const canPersist = !dangerLocked && pending.risk !== "dangerous" && !shellScoped && !mcpScoped;

  const handleDecide = async (tier: ApprovalTier) => {
    try {
      await decide(pending.id, tier);
    } catch {
      // Error toast is already shown by the store via notifyError
    }
  };

  return (
    <>
      {resolvedCards}
      <div
        data-testid="approval-card-pending"
        data-component-role="approval"
        data-surface-level="raised"
        data-layout="compact"
        data-tone={dangerLocked ? "danger" : "neutral"}
        data-approval-id={pending.id}
        data-run-id={pending.runId}
        data-conversation-id={pending.conversationId}
        data-tool-name={pending.toolName}
        data-input-summary={pending.inputSummary}
        className="leemo-approval-card flex w-full flex-col rounded-[14px] border px-3.5 py-3"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            data-testid="approval-risk-marker"
            className="leemo-approval-card__icon mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border"
            style={{
              background: dangerLocked ? "var(--leemo-danger-soft)" : "var(--leemo-amber-bg)",
              borderColor: dangerLocked ? "var(--leemo-danger-line)" : "var(--leemo-amber-line)",
              color: dangerLocked ? "var(--leemo-danger)" : "var(--leemo-amber-ink)",
            }}
          >
            <Shield className="h-3 w-3" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate text-[13px] font-semibold" style={{ color: "var(--leemo-ink)" }}>
                momo 想{verbOf(pending.toolName)}
              </p>
              <span className="leemo-approval-card__eyebrow shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">需要确认</span>
            </div>
            <p
              data-testid="approval-input-summary"
              className="leemo-approval-card__summary mono mt-1.5 max-w-full truncate rounded-[8px] border px-2.5 py-1.5 text-[11.5px] text-[var(--leemo-ink-2)]"
            >
              {pending.inputSummary}
            </p>
            {dangerLocked && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-danger)" }}>
                危险操作，每次都会问你（可在设置→权限里调整）
              </p>
            )}
            {computerScoped ? (
              <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
                本次任务内，查看、切换、输入等普通电脑操作不再重复询问；启动程序和最终动作仍会单独确认
              </p>
            ) : shellScoped ? (
              <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
                授权范围：仅这条命令；不会跨对话永久放行
              </p>
            ) : exactScoped ? (
              <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
                授权范围：仅当前目标与参数；下个任务会重新确认
              </p>
            ) : !dangerLocked ? (
              <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
                “本次任务 / 始终允许”会覆盖同风险的全部{verbOf(pending.toolName)}操作
              </p>
            ) : null}
          </div>
        </div>
        <div
          data-testid="approval-actions"
          className="leemo-approval-card__actions mt-2 flex w-full flex-wrap items-center justify-end gap-1.5 border-t pt-2 max-[760px]:grid max-[760px]:grid-cols-2"
        >
            <button
              onClick={() => void handleDecide("deny")}
              className="leemo-approval-card__button h-8 rounded-full border px-3.5 text-[12px] font-medium transition-all max-[760px]:w-full"
            >
              拒绝
            </button>
            {canRememberConversation && (
              <button
                onClick={() => void handleDecide("allow-conversation")}
                className="leemo-approval-card__button h-8 rounded-full border px-3.5 text-[12px] font-medium transition-all max-[760px]:w-full"
              >
                {shellScoped
                  ? "本次任务允许命令"
                  : computerScoped
                    ? "本次任务允许电脑操作"
                    : exactScoped
                      ? "本次任务允许这项操作"
                      : "本次任务允许此类操作"}
              </button>
            )}
            {canPersist && (
              <button
                onClick={() => void handleDecide("allow-permanent")}
                className="leemo-approval-card__button h-8 rounded-full border px-3.5 text-[12px] font-medium transition-all max-[760px]:w-full"
              >
                始终允许此类操作
              </button>
            )}
            <button
              onClick={() => void handleDecide("allow-once")}
              data-primary-action="true"
              className="leemo-approval-card__primary h-8 rounded-full px-4 text-[12px] font-semibold text-white transition-all max-[760px]:w-full"
            >
              允许一次
            </button>
        </div>
      </div>
    </>
  );
}
