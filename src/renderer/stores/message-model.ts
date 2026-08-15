import type { BrowserCaptureRef, LeemoEvent, PathAudit, UsageRecord } from "../../bridge/contract";
import {
  LEEMO_WORK_OVERVIEW_TOOL,
  normalizeWorkOverviewInput,
  type WorkOverviewData,
} from "../../bridge/work-overview";

export interface TimelineAttachment {
  name: string;
  size: number;
  mimeType?: string;
  sourceKind?: "local" | "workspace";
  workspaceId?: string;
  workspacePath?: string;
}

interface PlanTodo {
  text: string;
  status: "done" | "active" | "todo";
  /** Current Claude Code Task* protocol metadata. Hidden from presentation but
   *  needed to join TaskCreate results with later TaskUpdate calls. */
  taskId?: string;
  createToolUseId?: string;
}

/** The ordered, discriminated timeline the frontend renders against. Time
 *  order lives in the array; visual grouping (by runId) lives in the render
 *  layer. `kind` is the discriminant. */
export type TimelineItem =
  | { kind: "text"; id: string; runId: string; role: "user" | "momo"; text: string; streaming: boolean; createdAt?: number; attachments?: TimelineAttachment[] }
  | { kind: "thinking"; id: string; runId: string; text: string; streaming: boolean }
  | {
      kind: "retry";
      id: string;
      runId: string;
      attempt: number;
      maxAttempts: number;
      summary: string;
      detail: string;
      state: "retrying" | "recovered" | "failed";
      scope?: "connection" | "subagent";
      retryId?: string;
    }
  | { kind: "tool"; id: string; runId: string; toolUseId: string; name: string; input: unknown; status: "running" | "ok" | "error"; summary?: string; outcome?: "completed" | "failed" | "denied" | "cancelled" | "interrupted"; userFeedback?: string; browserCapture?: BrowserCaptureRef; createdAt?: number }
  | { kind: "plan"; id: string; runId: string; toolUseId: string; todos: PlanTodo[] }
  | {
      kind: "overview";
      id: string;
      runId: string;
      toolUseId: string;
      overview: WorkOverviewData;
      createdAt?: number;
    }
  | {
      kind: "activity";
      id: string;
      runId: string;
      parentToolUseId: string;
      status?: "running" | "ok" | "error";
      role?: string;
      task?: string;
      startedAt?: number;
      updatedAt?: number;
      childToolUseIds: string[];
      tools: { toolUseId: string; name: string; input?: unknown; status: "running" | "ok" | "error"; summary?: string; outcome?: "completed" | "failed" | "denied" | "cancelled" | "interrupted"; userFeedback?: string; browserCapture?: BrowserCaptureRef }[];
      transcript: { kind: "text" | "thinking"; text: string; createdAt?: number }[];
    }
  | { kind: "result"; id: string; runId: string; isError: boolean; interrupted: boolean; finalText: string; pathAudit: PathAudit; outcome?: Extract<LeemoEvent, { type: "run.finished" }>["outcome"]; retryable?: boolean; statusCode?: number; createdAt?: number }
  | { kind: "compact"; id: string; trigger: string; preTokens: number; postTokens?: number }
  | { kind: "usage"; id: string; runId: string; usage: UsageRecord }
  | {
      kind: "files";
      id: string;
      runId: string;
      changes: {
        path: string;
        workspacePath?: string;
        change: "added" | "modified" | "deleted";
      }[];
      omitted: number;
    }
  | {
      kind: "memory";
      id: string;
      runId: string;
      changeId: string;
      action: Extract<LeemoEvent, { type: "memory.changed" }>["action"];
      label: string;
      scope: Extract<LeemoEvent, { type: "memory.changed" }>["scope"];
      undone: boolean;
      undoChangeId?: string;
    }
  | { kind: "error"; id: string; runId: string; message: string };

export const RENDERER_RUN_ID_INITIAL = "run-0";

type TodoStatus = "done" | "active" | "todo";
const TODO_STATUS_MAP: Record<string, TodoStatus> = { completed: "done", in_progress: "active", pending: "todo" };

/** Defensive TodoWrite input → plan todos. Returns null when the shape is not
 *  a recognizable todo list (caller degrades to a plain tool item). Never throws. */
function parseTodos(input: unknown): { text: string; status: TodoStatus }[] | null {
  if (!input || typeof input !== "object") return null;
  const todos = (input as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: { text: string; status: TodoStatus }[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") return null;
    const text = (t as { content?: unknown; text?: unknown }).content ?? (t as { text?: unknown }).text;
    const rawStatus = (t as { status?: unknown }).status;
    if (typeof text !== "string") return null;
    if (typeof rawStatus !== "string" || !TODO_STATUS_MAP[rawStatus]) return null;
    out.push({ text, status: TODO_STATUS_MAP[rawStatus] });
  }
  return out;
}

function parseTaskCreate(input: unknown, toolUseId: string): PlanTodo | null {
  if (!input || typeof input !== "object") return null;
  const subject = (input as { subject?: unknown }).subject;
  if (typeof subject !== "string" || !subject.trim()) return null;
  return { text: subject.trim(), status: "todo", createToolUseId: toolUseId };
}

function parseTaskUpdate(input: unknown): { taskId: string; status?: TodoStatus; text?: string } | null {
  if (!input || typeof input !== "object") return null;
  const rawTaskId = (input as { taskId?: unknown }).taskId;
  if (typeof rawTaskId !== "string" && typeof rawTaskId !== "number") return null;
  const rawStatus = (input as { status?: unknown }).status;
  const subject = (input as { subject?: unknown }).subject;
  const status = typeof rawStatus === "string" ? TODO_STATUS_MAP[rawStatus] : undefined;
  const text = typeof subject === "string" && subject.trim() ? subject.trim() : undefined;
  if (!status && !text) return null;
  return { taskId: String(rawTaskId), ...(status ? { status } : {}), ...(text ? { text } : {}) };
}

function subagentIdentity(input: unknown): { role: string; task?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { role: "任务助手" };
  const fields = input as Record<string, unknown>;
  const type = typeof fields.subagent_type === "string" ? fields.subagent_type.toLowerCase() : "";
  const rawTask = typeof fields.description === "string"
    ? fields.description
    : typeof fields.prompt === "string"
      ? fields.prompt.split(/\r?\n/, 1)[0]
      : "";
  const task = rawTask.trim().replace(/\s+/g, " ").slice(0, 120) || undefined;
  const haystack = `${type} ${task ?? ""}`.toLowerCase();
  const role = /explore|research|search|调研|研究|检索/.test(haystack)
    ? "调研助手"
    : /plan|architect|规划|方案/.test(haystack)
      ? "规划助手"
      : /review|verify|test|audit|校验|验收|审查|测试/.test(haystack)
        ? "校验助手"
        : /write|draft|撰写|写作|文案/.test(haystack)
          ? "撰写助手"
          : "任务助手";
  return { role, ...(task ? { task } : {}) };
}

type FileChange = Extract<TimelineItem, { kind: "files" }>["changes"][number]["change"];

function netFileChange(previous: FileChange, next: FileChange): FileChange | null {
  if (previous === "added") return next === "deleted" ? null : "added";
  if (previous === "modified") return next === "deleted" ? "deleted" : "modified";
  return next === "deleted" ? "deleted" : "modified";
}

function settleRetry(
  items: TimelineItem[],
  runId: string,
  state: "recovered" | "failed",
): TimelineItem[] {
  return items.map((item) => item.kind === "retry"
    && item.runId === runId
    && (item.scope ?? "connection") === "connection"
    && item.state === "retrying"
    ? { ...item, state }
    : item);
}

/** Pure reducer: fold one LeemoEvent into the timeline. `runId` tags every
 *  appended item (render layer groups by it). Slice 2 handles text + run
 *  lifecycle here; tool/plan/activity/compact land in the same switch. */
export function applyEvent(items: TimelineItem[], event: LeemoEvent, runId: string, occurredAt?: number): TimelineItem[] {
  switch (event.type) {
    case "text.delta": {
      const current = settleRetry(items, runId, "recovered");
      const last = current[current.length - 1];
      if (last && last.kind === "text" && last.role === "momo" && last.streaming) {
        return [...current.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...current, {
        kind: "text", id: `m${current.length}`, runId, role: "momo", text: event.text, streaming: true,
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "text.final": {
      const current = settleRetry(items, runId, "recovered");
      // Real streams emit usage.final BETWEEN the last text.delta and
      // text.final, so the streaming bubble is NOT necessarily the last item.
      // Scan backwards for this run's momo bubble and replace it in place.
      for (let i = current.length - 1; i >= 0; i--) {
        const it = current[i];
        if (it.kind === "text" && it.role === "momo" && it.runId === runId) {
          return [
            ...current.slice(0, i),
            {
              ...it,
              text: event.text,
              streaming: false,
              ...(it.createdAt === undefined && occurredAt !== undefined ? { createdAt: occurredAt } : {}),
            },
            ...current.slice(i + 1),
          ];
        }
      }
      // No bubble streamed this run (no deltas arrived) — append the final text.
      return [...current, {
        kind: "text", id: `m${current.length}`, runId, role: "momo", text: event.text, streaming: false,
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "thinking.delta": {
      const current = settleRetry(items, runId, "recovered");
      const last = current[current.length - 1];
      if (last && last.kind === "thinking" && last.streaming) {
        return [...current.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...current, { kind: "thinking", id: `m${current.length}`, runId, text: event.text, streaming: true }];
    }
    case "stream.retry": {
      const scope = event.scope ?? "connection";
      const existing = items.findIndex((item) => item.kind === "retry"
        && item.runId === runId
        && (item.scope ?? "connection") === scope
        && (scope === "connection" || item.retryId === event.retryId));
      const retry: Extract<TimelineItem, { kind: "retry" }> = {
        kind: "retry",
        id: existing >= 0 ? items[existing].id : `m${items.length}`,
        runId,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        summary: event.summary,
        detail: event.detail,
        state: "retrying",
        scope,
        ...(event.retryId ? { retryId: event.retryId } : {}),
      };
      return existing >= 0
        ? [...items.slice(0, existing), retry, ...items.slice(existing + 1)]
        : [...items, retry];
    }
    case "run.finished": {
      const cleared = items.map((it) =>
        (it.kind === "text" && it.streaming) || (it.kind === "thinking" && it.streaming)
          ? { ...it, streaming: false }
          : it.kind === "retry" && it.runId === runId
            ? { ...it, state: event.isError ? "failed" as const : "recovered" as const }
          : it,
      );
      return [...cleared, {
        kind: "result", id: `m${items.length}`, runId,
        isError: event.isError,
        interrupted: event.outcome === "cancelled" || event.subtype === "interrupted",
        finalText: event.finalText, pathAudit: event.pathAudit,
        ...(event.outcome ? { outcome: event.outcome } : {}),
        ...(event.retryable !== undefined ? { retryable: event.retryable } : {}),
        ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "tool.started": {
      if (event.name === "TodoWrite") {
        const todos = parseTodos(event.input);
        if (todos) {
          for (let i = items.length - 1; i >= 0; i -= 1) {
            const item = items[i];
            if (item.kind !== "plan" || item.runId !== runId) continue;
            return [
              ...items.slice(0, i),
              { ...item, toolUseId: event.toolUseId, todos },
              ...items.slice(i + 1),
            ];
          }
          return [...items, { kind: "plan", id: `m${items.length}`, runId, toolUseId: event.toolUseId, todos }];
        }
      }
      if (event.subagent) {
        // Keep each child tool under the exact Agent invocation. Older event
        // producers omitted parentToolUseId, so the most recent activity stays
        // as a compatibility fallback rather than dropping the tool.
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "activity" && (!event.parentToolUseId || it.parentToolUseId === event.parentToolUseId)) {
            if (it.childToolUseIds.includes(event.toolUseId)) return items;
            const updated = {
              ...it,
              childToolUseIds: [...it.childToolUseIds, event.toolUseId],
              tools: [...it.tools, { toolUseId: event.toolUseId, name: event.name, input: event.input, status: "running" as const }],
              ...(occurredAt !== undefined ? { updatedAt: occurredAt } : {}),
            };
            return [...items.slice(0, i), updated, ...items.slice(i + 1)];
          }
        }
      }
      return [...items, {
        kind: "tool",
        id: `m${items.length}`,
        runId,
        toolUseId: event.toolUseId,
        name: event.name,
        input: event.input,
        status: "running",
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "tool.finished": {
      const pendingIndex = items.findIndex((item) =>
        item.kind === "tool" && item.toolUseId === event.toolUseId,
      );
      const pending = pendingIndex >= 0 && items[pendingIndex].kind === "tool"
        ? items[pendingIndex] as Extract<TimelineItem, { kind: "tool" }>
        : undefined;

      if (!event.isError && pending?.name === LEEMO_WORK_OVERVIEW_TOOL) {
        const normalized = normalizeWorkOverviewInput(pending.input);
        if (normalized.ok) {
          const previous = [...items].reverse().find(
            (item): item is Extract<TimelineItem, { kind: "overview" }> => item.kind === "overview",
          );
          const semantic: Extract<TimelineItem, { kind: "overview" }> = {
            kind: "overview",
            id: pending.id,
            runId: pending.runId,
            toolUseId: pending.toolUseId,
            overview: { ...previous?.overview, ...normalized.value },
            ...((occurredAt ?? pending.createdAt) !== undefined
              ? { createdAt: occurredAt ?? pending.createdAt }
              : {}),
          };
          return [...items.slice(0, pendingIndex), semantic, ...items.slice(pendingIndex + 1)];
        }
      }

      if (!event.isError && pending?.name === "TaskCreate") {
        const draft = parseTaskCreate(pending.input, pending.toolUseId);
        if (draft) {
          const taskId = /\bTask\s+#([^\s]+)\s+created\b/i.exec(event.contentSummary)?.[1];
          const todo = taskId ? { ...draft, taskId } : draft;
          const withoutPending = items.filter((_, index) => index !== pendingIndex);
          for (let i = withoutPending.length - 1; i >= 0; i -= 1) {
            const item = withoutPending[i];
            if (
              item.kind !== "plan"
              || item.runId !== pending.runId
              || !item.todos.some((candidate) => candidate.createToolUseId)
            ) continue;
            if (item.todos.some((candidate) => candidate.createToolUseId === pending.toolUseId)) return withoutPending;
            return [
              ...withoutPending.slice(0, i),
              { ...item, todos: [...item.todos, todo] },
              ...withoutPending.slice(i + 1),
            ];
          }
          return [...withoutPending, {
            kind: "plan",
            id: pending.id,
            runId: pending.runId,
            toolUseId: pending.toolUseId,
            todos: [todo],
          }];
        }
      }

      if (!event.isError && pending?.name === "TaskUpdate") {
        const update = parseTaskUpdate(pending.input);
        if (update) {
          const withoutPending = items.filter((_, index) => index !== pendingIndex);
          for (let i = withoutPending.length - 1; i >= 0; i -= 1) {
            const item = withoutPending[i];
            if (
              item.kind !== "plan"
              || item.runId !== pending.runId
              || !item.todos.some((todo) => todo.taskId === update.taskId)
            ) continue;
            return [
              ...withoutPending.slice(0, i),
              {
                ...item,
                todos: item.todos.map((todo) => todo.taskId === update.taskId
                  ? { ...todo, ...(update.status ? { status: update.status } : {}), ...(update.text ? { text: update.text } : {}) }
                  : todo),
              },
              ...withoutPending.slice(i + 1),
            ];
          }
        }
      }
      return items.map((it) => {
        if (it.kind === "tool" && it.toolUseId === event.toolUseId) {
          return {
            ...it,
            status: event.isError ? "error" as const : "ok" as const,
            summary: event.contentSummary,
            ...(event.outcome ? { outcome: event.outcome } : {}),
            ...(event.userFeedback ? { userFeedback: event.userFeedback } : {}),
            ...(event.browserCapture ? { browserCapture: event.browserCapture } : {}),
          };
        }
        if (it.kind === "activity" && it.tools.some((tool) => tool.toolUseId === event.toolUseId)) {
          return {
            ...it,
            ...(occurredAt !== undefined ? { updatedAt: occurredAt } : {}),
            tools: it.tools.map((tool) => tool.toolUseId === event.toolUseId
              ? {
                  ...tool,
                  status: event.isError ? "error" as const : "ok" as const,
                  summary: event.contentSummary,
                  ...(event.outcome ? { outcome: event.outcome } : {}),
                  ...(event.userFeedback ? { userFeedback: event.userFeedback } : {}),
                  ...(event.browserCapture ? { browserCapture: event.browserCapture } : {}),
                }
              : tool),
          };
        }
        if (it.kind === "activity" && it.parentToolUseId === event.toolUseId) {
          return {
            ...it,
            status: event.isError ? "error" as const : "ok" as const,
            ...(occurredAt !== undefined ? { updatedAt: occurredAt } : {}),
          };
        }
        return it;
      });
    }
    case "subagent.activity": {
      const exists = items.some((it) => it.kind === "activity" && it.parentToolUseId === event.parentToolUseId);
      if (exists) return items;
      const parentIndex = items.findIndex((it) =>
        it.kind === "tool" && it.toolUseId === event.parentToolUseId
      );
      const parent = parentIndex >= 0 && items[parentIndex].kind === "tool"
        ? items[parentIndex] as Extract<TimelineItem, { kind: "tool" }>
        : undefined;
      const identity = subagentIdentity(parent?.input);
      const activity: Extract<TimelineItem, { kind: "activity" }> = {
        kind: "activity",
        id: parent?.id ?? `m${items.length}`,
        runId: parent?.runId ?? runId,
        parentToolUseId: event.parentToolUseId,
        status: "running",
        ...identity,
        ...((parent?.createdAt ?? occurredAt) !== undefined
          ? { startedAt: parent?.createdAt ?? occurredAt }
          : {}),
        ...(occurredAt !== undefined ? { updatedAt: occurredAt } : {}),
        childToolUseIds: [],
        tools: [],
        transcript: [],
      };
      return parentIndex >= 0
        ? [...items.slice(0, parentIndex), activity, ...items.slice(parentIndex + 1)]
        : [...items, activity];
    }
    case "subagent.output": {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "activity" && it.parentToolUseId === event.parentToolUseId) {
          const updated = {
            ...it,
            ...(occurredAt !== undefined ? { updatedAt: occurredAt } : {}),
            transcript: [...it.transcript, {
              kind: event.kind,
              text: event.text,
              ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
            }],
          };
          return [...items.slice(0, i), updated, ...items.slice(i + 1)];
        }
      }
      return [...items, {
        kind: "activity",
        id: `m${items.length}`,
        runId,
        parentToolUseId: event.parentToolUseId,
        status: "running",
        role: "任务助手",
        ...(occurredAt !== undefined ? { startedAt: occurredAt, updatedAt: occurredAt } : {}),
        childToolUseIds: [],
        tools: [],
        transcript: [{
          kind: event.kind,
          text: event.text,
          ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
        }],
      }];
    }
    case "compact.boundary": {
      const item: TimelineItem = { kind: "compact", id: `m${items.length}`, trigger: event.trigger, preTokens: event.preTokens };
      if (event.postTokens !== undefined) item.postTokens = event.postTokens;
      return [...items, item];
    }
    case "usage.final":
      return [...items, { kind: "usage", id: `m${items.length}`, runId, usage: event.usage }];
    case "file.changed": {
      const receiptIndex = items.findIndex((item) => item.kind === "files" && item.runId === runId);
      if (receiptIndex < 0) {
        return [...items, {
          kind: "files",
          id: `m${items.length}`,
          runId,
          changes: [{
            path: event.path,
            ...(event.workspacePath ? { workspacePath: event.workspacePath } : {}),
            change: event.change,
          }],
          omitted: event.omitted ?? 0,
        }];
      }

      const receipt = items[receiptIndex] as Extract<TimelineItem, { kind: "files" }>;
      const changeIndex = receipt.changes.findIndex((change) => change.path === event.path);
      const changes = changeIndex < 0
        ? [...receipt.changes, {
            path: event.path,
            ...(event.workspacePath ? { workspacePath: event.workspacePath } : {}),
            change: event.change,
          }]
        : (() => {
            const net = netFileChange(receipt.changes[changeIndex].change, event.change);
            if (net === null) return receipt.changes.filter((_, index) => index !== changeIndex);
            return receipt.changes.map((change, index) => index === changeIndex ? { ...change, change: net } : change);
          })();

      if (changes.length === 0) {
        return [...items.slice(0, receiptIndex), ...items.slice(receiptIndex + 1)];
      }
      return [
        ...items.slice(0, receiptIndex),
        { ...receipt, changes, omitted: Math.max(receipt.omitted, event.omitted ?? 0) },
        ...items.slice(receiptIndex + 1),
      ];
    }
    case "memory.changed": {
      if (event.action === "undone" && event.targetChangeId) {
        return items.map((item) => item.kind === "memory" && item.changeId === event.targetChangeId
          ? { ...item, undone: true, undoChangeId: event.changeId }
          : item);
      }
      const next: Extract<TimelineItem, { kind: "memory" }> = {
        kind: "memory",
        id: `m${items.length}`,
        runId,
        changeId: event.changeId,
        action: event.action,
        label: event.label,
        scope: event.scope,
        undone: false,
      };
      // A round can consolidate several low-level writes. The footer stays
      // deliberately quiet: one slot per run, showing only the latest change.
      const existingIndex = items.findIndex((item) => item.kind === "memory" && item.runId === runId);
      if (existingIndex < 0) return [...items, next];
      return [...items.slice(0, existingIndex), { ...next, id: items[existingIndex].id }, ...items.slice(existingIndex + 1)];
    }
    case "error":
      return [...items, { kind: "error", id: `m${items.length}`, runId, message: event.message }];
    default:
      return items;
  }
}
