import type { TimelineItem } from "../../stores/message-model";
import { TriangleAlert } from "lucide-react";
import TextBubble from "./TextBubble";
import ProcessFold from "./ProcessFold";
import MessageFooter from "./MessageFooter";
import ApprovalBar from "../ApprovalBar";
import VisualizationCard from "../VisualizationCard";
import AskUserCard from "../AskUserCard";
import { LEEMO_VISUALIZATION_TOOL_NAME, LEEMO_ASK_USER_TOOL_NAME } from "../../bridge/tool-names";
import {
  useApprovals,
  useConversations,
  useMemory,
  useSettings,
  useUi,
  useWorkspace,
  useWorkspaces,
} from "../../bridge/context";
import { pairAskUserQuestions } from "./ask-user-pairing";

function fileName(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

function previewKind(filePath: string): "markdown" | "pdf" | "html" | "other" {
  const lower = filePath.toLocaleLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "other";
}

const isProcess = (i: TimelineItem) =>
  (i.kind === "tool" && i.name !== LEEMO_VISUALIZATION_TOOL_NAME && i.name !== LEEMO_ASK_USER_TOOL_NAME) ||
  i.kind === "plan" ||
  i.kind === "activity" ||
  i.kind === "compact" ||
  i.kind === "thinking";

export default function TurnBlock({
  items,
  active,
  runId,
  density = "workbench",
}: {
  items: TimelineItem[];
  active: boolean;
  runId: string;
  density?: "workbench" | "buddy";
}) {
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const resolvedByRun = useApprovals((s) => s.resolvedByRun);
  const activeConversationId = useConversations((s) => s.activeId);
  const pendingUndoIds = useMemory((s) => s.pendingUndoIds);
  const undoneChangeIds = useMemory((s) => s.undoneChangeIds);
  const undoErrors = useMemory((s) => s.undoErrors);
  const undoMemory = useMemory((s) => s.undo);
  const openPreview = useUi((s) => s.openPreview);
  const setView = useUi((s) => s.setView);
  const setMode = useSettings((s) => s.setMode);
  const workspace = useWorkspace();
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);

  // Which tool calls in THIS turn have an approval card to show? Approvals are
  // rendered next to the tool that raised them (see ProcessFold) instead of
  // being appended at the end of the turn: an approval is a step in momo's
  // work, so it belongs in the flow where that work happens.
  const anchoredToolUseIds = new Set<string>();
  const pendingToolUseIds = new Set<string>();
  for (const p of Object.values(pendingByConversation)) {
    if (p?.kind === "approval" && p.runId === runId && p.toolUseId) {
      anchoredToolUseIds.add(p.toolUseId);
      pendingToolUseIds.add(p.toolUseId);
    }
  }
  for (const r of resolvedByRun[runId] ?? []) {
    if (r.kind === "approval" && r.toolUseId) anchoredToolUseIds.add(r.toolUseId);
  }

  // Anything we could NOT anchor (no toolUseId, or its tool is not in this
  // turn) still has to reach the user — an invisible permission prompt stalls
  // the round until the SDK's permission stream times out.
  const anchorableIds = new Set(
    items.flatMap((i) => (i.kind === "tool" && i.toolUseId ? [i.toolUseId] : [])),
  );
  const pendingUnanchoredApprovals = Object.values(pendingByConversation).filter(
    (p) => p?.kind === "approval" && p.runId === runId && (!p.toolUseId || !anchorableIds.has(p.toolUseId)),
  );
  const resolvedUnanchoredApprovals = (resolvedByRun[runId] ?? []).filter(
    (r) => r.kind === "approval" && (!r.toolUseId || !anchorableIds.has(r.toolUseId)),
  );
  const pendingUnanchoredIds = new Set(pendingUnanchoredApprovals.map((item) => item!.id));
  const resolvedUnanchoredIds = new Set(resolvedUnanchoredApprovals.map((item) => item.id));

  // Ask-user pairing (卡 D): AskUserPayload carries no toolUseId, so each
  // ask_user tool-call item pairs with this run's questions by index (see
  // ask-user-pairing.ts). Never folded into ProcessFold — momo asking a
  // direct question is not "干活过程" to hide.
  const askUserPairing = pairAskUserQuestions(items, runId, pendingByConversation, resolvedByRun);
  const resolvedOverflowQuestions = askUserPairing.overflow.filter((interaction) => "items" in interaction);
  const pendingOverflowQuestions = askUserPairing.overflow.filter((interaction) => !("items" in interaction));
  let askUserIndex = 0;

  const archivedInteractionCount = resolvedUnanchoredApprovals.length + resolvedOverflowQuestions.length;
  const archivedContent = !active && archivedInteractionCount > 0 ? (
    <>
      {resolvedUnanchoredApprovals.length > 0 && (
        <ApprovalBar
          runId={runId}
          unanchoredOnly
          interactionIds={resolvedUnanchoredIds}
          state="resolved"
          density={density === "buddy" ? "buddy" : "default"}
        />
      )}
      {resolvedOverflowQuestions.map((interaction) => (
        <AskUserCard
          key={`archived-question-${interaction.id}`}
          interaction={interaction}
          density={density === "buddy" ? "buddy" : "default"}
        />
      ))}
    </>
  ) : undefined;

  let archiveBeforeIndex = -1;
  if (archivedContent) {
    const resultIndex = items.findIndex((item) => item.kind === "result" || item.kind === "error");
    const searchFrom = resultIndex >= 0 ? resultIndex - 1 : items.length - 1;
    for (let index = searchFrom; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "text" && item.role === "momo") {
        archiveBeforeIndex = index;
        break;
      }
    }
    if (archiveBeforeIndex < 0) archiveBeforeIndex = resultIndex;
  }

  const usage = items.find((i) => i.kind === "usage") as Extract<TimelineItem, { kind: "usage" }> | undefined;
  const files = items.find(
    (item): item is Extract<TimelineItem, { kind: "files" }> => item.kind === "files",
  );
  const memory = [...items].reverse().find(
    (item): item is Extract<TimelineItem, { kind: "memory" }> => item.kind === "memory",
  );
  const memoryUndoState = memory
    ? memory.undone || undoneChangeIds.includes(memory.changeId)
      ? "undone" as const
      : pendingUndoIds.includes(memory.changeId)
        ? "pending" as const
        : undoErrors[memory.changeId]
          ? "error" as const
          : "idle" as const
    : undefined;
  const terminalResult = [...items].reverse().find(
    (item): item is Extract<TimelineItem, { kind: "result" }> => item.kind === "result",
  );
  const hasConcreteError = items.some(
    (item) => item.kind === "error" && item.message.trim().length > 0,
  );
  const processOutcome = terminalResult
    ? terminalResult.interrupted
      ? "interrupted" as const
      : terminalResult.isError
        ? "error" as const
        : "success" as const
    : items.some((item) => item.kind === "error")
      ? "error" as const
      : undefined;
  const processItems = items.filter(isProcess);
  const firstProcessIndex = items.findIndex(isProcess);
  const hasPendingApproval = processItems.some(
    (item) => item.kind === "tool" && pendingToolUseIds.has(item.toolUseId),
  );
  const receiptIndex = firstProcessIndex >= 0
    ? firstProcessIndex
    : archivedContent
      ? archiveBeforeIndex >= 0 ? archiveBeforeIndex : items.length
      : -1;
  const processReceipt = receiptIndex >= 0 ? (
    <ProcessFold
      key={`process-${runId}`}
      items={processItems}
      defaultCollapsed={hasPendingApproval ? false : density === "buddy" ? true : !active}
      runId={runId}
      density={density}
      active={active}
      outcome={processOutcome}
      stale={!active && !items.some((item) => item.kind === "result" || item.kind === "error")}
      archivedCount={archivedInteractionCount}
      archivedContent={archivedContent}
      summaryOverride={processItems.length === 0
        ? density === "buddy" ? "momo 收好确认记录" : "确认记录已归档"
        : undefined}
    />
  ) : null;

  const nodes: React.ReactNode[] = [];
  let receiptPlaced = false;
  items.forEach((it, idx) => {
    if (processReceipt && idx === receiptIndex) {
      nodes.push(processReceipt);
      receiptPlaced = true;
    }
    if (isProcess(it)) return;
    if (it.kind === "usage") return; // no visual footprint; must not split a process fold
    if (it.kind === "files") return; // folded into MessageFooter; never a separate card/message
    if (it.kind === "memory") return; // folded into MessageFooter; never a separate card/message
    if (it.kind === "text") nodes.push(<TextBubble key={it.id} item={it} />);
    else if (it.kind === "result") nodes.push(
      <MessageFooter
        key={it.id}
        result={it}
        usage={usage}
        files={files}
        memory={memory}
        memoryUndoState={memoryUndoState}
        memoryUndoError={memory ? undoErrors[memory.changeId] : undefined}
        hideErrorLead={hasConcreteError}
        onOpenFile={files ? (change) => {
          const target = change.workspacePath ?? change.path;
          setView("chat");
          openPreview(target, fileName(change.path), previewKind(target));
          if (density === "buddy") setMode("workbench");
        } : undefined}
        onRevealFile={files && workspace ? (change) => {
          void workspace.reveal(change.workspacePath ?? change.path, activeWorkspaceId).catch(() => {});
        } : undefined}
        onUndoMemory={memory ? (target) => {
          void undoMemory({
            ...(activeConversationId ? { conversationId: activeConversationId } : {}),
            scope: target.scope,
            targetChangeId: target.changeId,
          });
        } : undefined}
      />,
    );
    else if (it.kind === "error") nodes.push(
      <div key={it.id} className="flex items-start gap-1 text-xs text-[var(--leemo-danger)]">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{it.message}</span>
      </div>
    );
    // Render VisualizationCard for visualization tools
    else if (it.kind === "tool" && it.name === LEEMO_VISUALIZATION_TOOL_NAME) {
      nodes.push(<VisualizationCard key={it.id} item={it} />);
    }
    // Render momo's question card in place of its ask_user tool-call item —
    // same slot in the flow, three states (pending/answered/cancelled) live
    // inside AskUserCard. No paired question yet (index has no entry) means
    // the push hasn't landed — render nothing this pass; it reappears the
    // instant wiring.ts folds the push in (never silently dropped).
    else if (it.kind === "tool" && it.name === LEEMO_ASK_USER_TOOL_NAME) {
      const interaction = askUserPairing.byToolIndex[askUserIndex];
      askUserIndex += 1;
      if (interaction) nodes.push(<AskUserCard key={it.id} interaction={interaction} density={density === "buddy" ? "buddy" : "default"} />);
    }
  });
  if (processReceipt && !receiptPlaced) nodes.push(processReceipt);

  // Pending fallback interactions stay prominent so the round cannot stall.
  // Once resolved, a finished turn archives them before its final answer.
  const tailApprovalIds = active
    ? new Set([...pendingUnanchoredIds, ...resolvedUnanchoredIds])
    : pendingUnanchoredIds;
  if (tailApprovalIds.size > 0) {
    nodes.push(
      <ApprovalBar
        key={`approval-${runId}`}
        runId={runId}
        unanchoredOnly
        interactionIds={tailApprovalIds}
        state={active ? "all" : "pending"}
        density={density === "buddy" ? "buddy" : "default"}
      />,
    );
  }

  // Fallback only: questions whose push arrived before their own tool.started
  // event landed in the timeline (race) — still rendered, never dropped.
  const tailQuestions = active ? askUserPairing.overflow : pendingOverflowQuestions;
  for (const interaction of tailQuestions) {
    nodes.push(
      <AskUserCard
        key={`askuser-overflow-${interaction.id}`}
        interaction={interaction}
        density={density === "buddy" ? "buddy" : "default"}
      />,
    );
  }

  return <div className="leemo-rise space-y-2.5">{nodes}</div>;
}
