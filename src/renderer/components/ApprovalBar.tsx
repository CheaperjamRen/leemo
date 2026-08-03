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
      "allow-conversation": isShellToolName(r.toolName)
        ? "本次任务已允许命令"
        : isMcpToolName(r.toolName)
          ? "本次任务已允许这项操作"
          : "本次任务已允许此类操作",
      "allow-permanent": "已始终允许此类操作",
      deny: "已拒绝",
      cancelled: "已取消",
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
  const shellScoped = isShellToolName(pending.toolName);
  const externalScoped = isMcpToolName(pending.toolName);
  const canRememberConversation = !dangerLocked;
  const canPersist = !dangerLocked && pending.risk !== "dangerous" && !shellScoped && !externalScoped;

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
        data-approval-id={pending.id}
        data-run-id={pending.runId}
        data-conversation-id={pending.conversationId}
        data-tool-name={pending.toolName}
        data-input-summary={pending.inputSummary}
        className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-[10px] border px-4 py-3"
        style={{
          borderColor: dangerLocked ? "var(--leemo-danger-line)" : "var(--leemo-amber-line)",
          background: dangerLocked ? "var(--leemo-danger-soft)" : "var(--leemo-amber-bg)",
        }}
      >
        <span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] border"
          style={{ background: "rgba(255,255,255,.8)" }}
        >
          <Shield className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium" style={{ color: "var(--leemo-ink)" }}>
            momo 想{verbOf(pending.toolName)}
          </p>
          <p
            className="mono mt-1 max-w-full truncate rounded-[5px] border px-1.5 py-px text-[11.5px]"
            style={{ background: "rgba(255,255,255,.8)" }}
          >
            {pending.inputSummary}
          </p>
          {dangerLocked && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-danger)" }}>
              危险操作，每次都会问你（可在设置→权限里调整）
            </p>
          )}
          {shellScoped ? (
            <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
              授权范围：仅这条命令；不会跨对话永久放行
            </p>
          ) : externalScoped ? (
            <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
              授权范围：仅当前目标与参数；下个任务会重新确认
            </p>
          ) : !dangerLocked ? (
            <p className="mt-1 text-[11px]" style={{ color: "var(--leemo-ink-3)" }}>
              “本次任务 / 始终允许”会覆盖同风险的全部{verbOf(pending.toolName)}操作
            </p>
          ) : null}
        </div>
        <div
          data-testid="approval-actions"
          className="col-span-full flex w-full flex-wrap items-center justify-end gap-2 border-t border-[var(--leemo-line-soft)] pt-2 max-[760px]:grid max-[760px]:grid-cols-2"
        >
            <button
              onClick={() => void handleDecide("deny")}
              className="h-8 rounded-[7px] border px-3 text-[12px] font-medium transition-colors max-[760px]:w-full"
              style={{
                borderColor: "var(--leemo-line)",
                color: "var(--leemo-ink-2)",
                background: "white",
              }}
            >
              拒绝
            </button>
            {canRememberConversation && (
              <button
                onClick={() => void handleDecide("allow-conversation")}
                className="h-8 rounded-[7px] border px-3 text-[12px] font-medium transition-colors max-[760px]:w-full"
                style={{
                  borderColor: "var(--leemo-line)",
                  color: "var(--leemo-ink-2)",
                  background: "white",
                }}
              >
                {shellScoped
                  ? "本次任务允许命令"
                  : externalScoped
                    ? "本次任务允许这项操作"
                    : "本次任务允许此类操作"}
              </button>
            )}
            {canPersist && (
              <button
                onClick={() => void handleDecide("allow-permanent")}
                className="h-8 rounded-[7px] border px-3 text-[12px] font-medium transition-colors max-[760px]:w-full"
                style={{
                  borderColor: "var(--leemo-line)",
                  color: "var(--leemo-ink-2)",
                  background: "white",
                }}
              >
                始终允许此类操作
              </button>
            )}
            <button
              onClick={() => void handleDecide("allow-once")}
              className="h-8 rounded-[7px] px-4 text-[12px] font-medium text-white transition-colors max-[760px]:w-full"
              style={{ background: "var(--leemo-ink)" }}
            >
              允许一次
            </button>
        </div>
      </div>
    </>
  );
}
