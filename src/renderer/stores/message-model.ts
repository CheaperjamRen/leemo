import type { BrowserCaptureRef, LeemoEvent, PathAudit, UsageRecord } from "../../bridge/contract";

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
  | { kind: "tool"; id: string; runId: string; toolUseId: string; name: string; input: unknown; status: "running" | "ok" | "error"; summary?: string; browserCapture?: BrowserCaptureRef }
  | { kind: "plan"; id: string; runId: string; toolUseId: string; todos: PlanTodo[] }
  | {
      kind: "activity";
      id: string;
      runId: string;
      parentToolUseId: string;
      childToolUseIds: string[];
      tools: { toolUseId: string; name: string; input?: unknown; status: "running" | "ok" | "error"; summary?: string; browserCapture?: BrowserCaptureRef }[];
      transcript: { kind: "text" | "thinking"; text: string }[];
    }
  | { kind: "result"; id: string; runId: string; isError: boolean; interrupted: boolean; finalText: string; pathAudit: PathAudit; createdAt?: number }
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
    out.push({ text, status: (typeof rawStatus === "string" && TODO_STATUS_MAP[rawStatus]) || "todo" });
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

type FileChange = Extract<TimelineItem, { kind: "files" }>["changes"][number]["change"];

function netFileChange(previous: FileChange, next: FileChange): FileChange | null {
  if (previous === "added") return next === "deleted" ? null : "added";
  if (previous === "modified") return next === "deleted" ? "deleted" : "modified";
  return next === "deleted" ? "deleted" : "modified";
}

/** Pure reducer: fold one LeemoEvent into the timeline. `runId` tags every
 *  appended item (render layer groups by it). Slice 2 handles text + run
 *  lifecycle here; tool/plan/activity/compact land in the same switch. */
export function applyEvent(items: TimelineItem[], event: LeemoEvent, runId: string, occurredAt?: number): TimelineItem[] {
  switch (event.type) {
    case "text.delta": {
      const last = items[items.length - 1];
      if (last && last.kind === "text" && last.role === "momo" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...items, {
        kind: "text", id: `m${items.length}`, runId, role: "momo", text: event.text, streaming: true,
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "text.final": {
      // Real streams emit usage.final BETWEEN the last text.delta and
      // text.final, so the streaming bubble is NOT necessarily the last item.
      // Scan backwards for this run's momo bubble and replace it in place.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "text" && it.role === "momo" && it.runId === runId) {
          return [
            ...items.slice(0, i),
            {
              ...it,
              text: event.text,
              streaming: false,
              ...(it.createdAt === undefined && occurredAt !== undefined ? { createdAt: occurredAt } : {}),
            },
            ...items.slice(i + 1),
          ];
        }
      }
      // No bubble streamed this run (no deltas arrived) — append the final text.
      return [...items, {
        kind: "text", id: `m${items.length}`, runId, role: "momo", text: event.text, streaming: false,
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "thinking.delta": {
      const last = items[items.length - 1];
      if (last && last.kind === "thinking" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...items, { kind: "thinking", id: `m${items.length}`, runId, text: event.text, streaming: true }];
    }
    case "run.finished": {
      const cleared = items.map((it) =>
        (it.kind === "text" && it.streaming) || (it.kind === "thinking" && it.streaming)
          ? { ...it, streaming: false }
          : it,
      );
      return [...cleared, {
        kind: "result", id: `m${items.length}`, runId,
        isError: event.isError, interrupted: event.subtype === "interrupted",
        finalText: event.finalText, pathAudit: event.pathAudit,
        ...(occurredAt !== undefined ? { createdAt: occurredAt } : {}),
      }];
    }
    case "tool.started": {
      if (event.name === "TodoWrite") {
        const todos = parseTodos(event.input);
        if (todos) {
          return [...items, { kind: "plan", id: `m${items.length}`, runId, toolUseId: event.toolUseId, todos }];
        }
      }
      if (event.name === "TaskCreate") {
        const todo = parseTaskCreate(event.input, event.toolUseId);
        if (todo) {
          for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.kind === "plan" && item.runId === runId && item.todos.some((candidate) => candidate.createToolUseId)) {
              return [...items.slice(0, i), { ...item, todos: [...item.todos, todo] }, ...items.slice(i + 1)];
            }
          }
          return [...items, { kind: "plan", id: `m${items.length}`, runId, toolUseId: event.toolUseId, todos: [todo] }];
        }
      }
      if (event.name === "TaskUpdate") {
        const update = parseTaskUpdate(event.input);
        if (update) {
          for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.kind !== "plan" || item.runId !== runId || !item.todos.some((todo) => todo.taskId === update.taskId)) continue;
            return [
              ...items.slice(0, i),
              {
                ...item,
                todos: item.todos.map((todo) => todo.taskId === update.taskId
                  ? { ...todo, ...(update.status ? { status: update.status } : {}), ...(update.text ? { text: update.text } : {}) }
                  : todo),
              },
              ...items.slice(i + 1),
            ];
          }
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
            };
            return [...items.slice(0, i), updated, ...items.slice(i + 1)];
          }
        }
      }
      return [...items, { kind: "tool", id: `m${items.length}`, runId, toolUseId: event.toolUseId, name: event.name, input: event.input, status: "running" }];
    }
    case "tool.finished": {
      const createdTaskId = !event.isError
        ? /\bTask\s+#([^\s]+)\s+created\b/i.exec(event.contentSummary)?.[1]
        : undefined;
      if (createdTaskId) {
        return items.map((item) => item.kind === "plan" && item.todos.some((todo) => todo.createToolUseId === event.toolUseId)
          ? {
              ...item,
              todos: item.todos.map((todo) => todo.createToolUseId === event.toolUseId
                ? { ...todo, taskId: createdTaskId }
                : todo),
            }
          : item);
      }
      return items.map((it) => {
        if (it.kind === "tool" && it.toolUseId === event.toolUseId) {
          return {
            ...it,
            status: event.isError ? "error" as const : "ok" as const,
            summary: event.contentSummary,
            ...(event.browserCapture ? { browserCapture: event.browserCapture } : {}),
          };
        }
        if (it.kind === "activity" && it.tools.some((tool) => tool.toolUseId === event.toolUseId)) {
          return {
            ...it,
            tools: it.tools.map((tool) => tool.toolUseId === event.toolUseId
              ? {
                  ...tool,
                  status: event.isError ? "error" as const : "ok" as const,
                  summary: event.contentSummary,
                  ...(event.browserCapture ? { browserCapture: event.browserCapture } : {}),
                }
              : tool),
          };
        }
        return it;
      });
    }
    case "subagent.activity": {
      const exists = items.some((it) => it.kind === "activity" && it.parentToolUseId === event.parentToolUseId);
      if (exists) return items;
      return [...items, {
        kind: "activity",
        id: `m${items.length}`,
        runId,
        parentToolUseId: event.parentToolUseId,
        childToolUseIds: [],
        tools: [],
        transcript: [],
      }];
    }
    case "subagent.output": {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "activity" && it.parentToolUseId === event.parentToolUseId) {
          const updated = { ...it, transcript: [...it.transcript, { kind: event.kind, text: event.text }] };
          return [...items.slice(0, i), updated, ...items.slice(i + 1)];
        }
      }
      return [...items, {
        kind: "activity",
        id: `m${items.length}`,
        runId,
        parentToolUseId: event.parentToolUseId,
        childToolUseIds: [],
        tools: [],
        transcript: [{ kind: event.kind, text: event.text }],
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
