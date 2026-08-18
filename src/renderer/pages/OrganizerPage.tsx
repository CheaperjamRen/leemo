import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FilePlus2, Inbox, Pencil, Save, Trash2 } from "lucide-react";
import type { Note, NoteAttachment } from "../../captures";
import type { CreateTaskInput, UserTask } from "../../tasks";
import { parseTaskText, type ParsedTaskField, type TaskTextParseResult } from "../../task-text-parser";
import {
  useApprovals,
  useArtifacts,
  useBridgeClient,
  useCaptures,
  useConversations,
  useNotebooks,
  useProviders,
  useSettings,
  useTasks,
  useUi,
} from "../bridge/context";
import { IpcCaptureClient } from "../capture/client";
import CaptureEditor from "../components/CaptureEditor";
import type { OrganizerTab } from "../stores/ui";
import { IpcTrashClient, type TrashSnapshot } from "../trash/client";
import "./OrganizerPage.css";

type NoteLibraryView = "active" | "archived";
type TaskListFilter = "open" | "today" | "upcoming" | "done";
type TaskDateCategory = "today" | "overdue" | "upcoming" | "undated";

interface EditorDraft {
  key: string;
  noteId: string | null;
  title: string;
  markdown: string;
  revision: number | null;
  attachments: NoteAttachment[];
}

interface TaskDraft {
  id: string | null;
  expectedRevision: number | null;
  details: string;
  plannedAt: string;
  dueAt: string;
  reminderAt: string;
  recurrence: "" | NonNullable<UserTask["recurrence"]>;
  notebookId: string;
}

interface NoteTaskCandidate {
  id: string;
  title: string;
  details: string;
  selected: boolean;
  detailsOpen: boolean;
  plannedAt: string;
  dueAt: string;
  reminderAt: string;
}

const EMPTY_TASK_DRAFT: TaskDraft = {
  id: null,
  expectedRevision: null,
  details: "",
  plannedAt: "",
  dueAt: "",
  reminderAt: "",
  recurrence: "",
  notebookId: "",
};

const TABS: Array<{ id: OrganizerTab; label: string }> = [
  { id: "today", label: "今天" },
  { id: "notes", label: "便签" },
  { id: "tasks", label: "待办" },
  { id: "trash", label: "回收站" },
];

function visibleNoteTitle(note: Pick<Note, "title" | "markdown">): string {
  const title = note.title.trim();
  if (title) return title;
  const firstLine = note.markdown
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:[-*+] |\d+[.)] |[-*+] \[[ xX]\] )/, "")
      .replace(/[*_`>#]/g, "")
      .trim())
    .find(Boolean);
  return firstLine || "无标题便签";
}

function noteTaskCandidates(markdown: string): NoteTaskCandidate[] {
  const candidates: NoteTaskCandidate[] = [];
  markdown.replace(/\r\n/g, "\n").split("\n").forEach((details, index) => {
    const line = details.trim();
    if (!line || /^[-*+]\s+\[[xX]\]\s+/u.test(line)) return;
    const title = line
      .replace(/^[-*+]\s+\[ \]\s+/u, "")
      .replace(/^[-*+]\s+/u, "")
      .replace(/^\d+[.)]\s+/u, "")
      .trim();
    if (!title) return;
    candidates.push({
      id: `${index}:${details}`,
      title,
      details,
      selected: true,
      detailsOpen: false,
      plannedAt: "",
      dueAt: "",
      reminderAt: "",
    });
  });
  return candidates;
}

function noteDraft(note: Note): EditorDraft {
  return {
    key: `${note.id}:${note.revision}`,
    noteId: note.id,
    title: note.title,
    markdown: note.markdown,
    revision: note.revision,
    attachments: note.attachments ? note.attachments.map((attachment) => ({ ...attachment })) : [],
  };
}

function formatToday(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

function localTimestamp(date: string, time?: string): number {
  return new Date(`${date}T${time ?? "00:00"}`).getTime();
}

function inputTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateTimeInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function parsedInput(title: string, fields: ParsedTaskField[]): CreateTaskInput {
  const input: CreateTaskInput = { title };
  for (const field of fields) {
    if (field.kind === "planned") input.plannedAt = localTimestamp(field.date, field.time);
    if (field.kind === "due") input.dueAt = localTimestamp(field.date, field.time);
    if (field.kind === "reminder") input.reminderAt = localTimestamp(field.date, field.time);
    if (field.kind === "reminderOffset") input.reminderOffsetMinutes = field.minutesBefore;
    if (field.kind === "recurrence") input.recurrence = field.rule;
  }
  return input;
}

function taskInput(title: string, fields: ParsedTaskField[], draft: TaskDraft, useExplicitFields: boolean): CreateTaskInput {
  const input: CreateTaskInput = {
    ...parsedInput(title, fields),
    title,
  };
  if (!useExplicitFields) return input;
  return {
    ...input,
    details: draft.details.trim(),
    plannedAt: inputTimestamp(draft.plannedAt),
    dueAt: inputTimestamp(draft.dueAt),
    reminderAt: inputTimestamp(draft.reminderAt),
    recurrence: draft.recurrence || null,
    notebookId: draft.notebookId || null,
  };
}

function taskDraft(task: UserTask): TaskDraft {
  return {
    id: task.id,
    expectedRevision: task.revision,
    details: task.details ?? "",
    plannedAt: dateTimeInput(task.plannedAt),
    dueAt: dateTimeInput(task.dueAt),
    reminderAt: dateTimeInput(task.reminderAt),
    recurrence: task.recurrence ?? "",
    notebookId: task.notebookId ?? "",
  };
}

function withModelTaskFields(
  parsed: TaskTextParseResult,
  modelFields: ParsedTaskField[] | undefined,
): TaskTextParseResult {
  if (!parsed.requiresModel || !modelFields?.length) return parsed;
  const fields = [...parsed.fields, ...modelFields].filter((field, index, all) => (
    all.findIndex((candidate) => candidate.kind === field.kind && candidate.source === field.source) === index
  ));
  const { reason: _reason, ...rest } = parsed;
  return { ...rest, fields, requiresModel: false };
}

function fieldLabel(field: ParsedTaskField): string {
  if (field.kind === "recurrence") {
    return `重复 ${{ daily: "每天", weekly: "每周", monthly: "每月", weekdays: "工作日" }[field.rule]}`;
  }
  if (field.kind === "reminderOffset") {
    const value = field.minutesBefore % 1_440 === 0
      ? `${field.minutesBefore / 1_440} 天`
      : field.minutesBefore % 60 === 0
        ? `${field.minutesBefore / 60} 小时`
        : `${field.minutesBefore} 分钟`;
    return `提醒 提前 ${value}`;
  }
  const prefix = field.kind === "planned" ? "计划" : field.kind === "due" ? "截止" : "提醒";
  const [year, month, day] = field.date.split("-").map(Number);
  return `${prefix} ${month}月${day}日${field.time ? ` ${field.time}` : ""}`;
}

function formatTaskTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function taskWhen(task: UserTask): string | null {
  const timestamp = task.dueAt ?? task.plannedAt;
  return timestamp === null ? null : formatTaskTimestamp(timestamp);
}

function taskReminderLabel(task: UserTask): string | null {
  if (task.reminderAt !== null) return `提醒 ${formatTaskTimestamp(task.reminderAt)}`;
  if (task.reminderOffsetMinutes === null) return null;
  const minutes = task.reminderOffsetMinutes;
  const offset = minutes % 1_440 === 0
    ? `${minutes / 1_440} 天`
    : minutes % 60 === 0
      ? `${minutes / 60} 小时`
      : `${minutes} 分钟`;
  return `提前 ${offset} 提醒`;
}

function taskMetadata(task: UserTask, notebookTitle: string | undefined): string[] {
  const metadata = [taskWhen(task), taskReminderLabel(task)];
  if (task.recurrence) {
    metadata.push(`${{
      daily: "每天",
      weekly: "每周",
      monthly: "每月",
      weekdays: "工作日",
    }[task.recurrence]}重复`);
  }
  if (task.notebookId) metadata.push(`本子 ${notebookTitle ?? task.notebookId}`);
  return metadata.filter((item): item is string => item !== null);
}

function isSameLocalDay(timestamp: number, now: number): boolean {
  const value = new Date(timestamp);
  const today = new Date(now);
  return value.getFullYear() === today.getFullYear()
    && value.getMonth() === today.getMonth()
    && value.getDate() === today.getDate();
}

function taskDateCategory(task: UserTask, now: number): TaskDateCategory {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const scheduledTimestamps = [task.plannedAt, task.dueAt]
    .filter((timestamp): timestamp is number => timestamp !== null);

  if (task.dueAt !== null && task.dueAt < startOfToday.getTime()) return "overdue";
  if (scheduledTimestamps.some((timestamp) => isSameLocalDay(timestamp, now))) return "today";
  if (scheduledTimestamps.some((timestamp) => timestamp < startOfToday.getTime())) return "overdue";
  if (scheduledTimestamps.length > 0) return "upcoming";
  return isSameLocalDay(task.createdAt, now) ? "today" : "undated";
}

function taskMatchesFilter(task: UserTask, filter: TaskListFilter, now: number): boolean {
  if (filter === "done") return task.status === "done";
  if (task.status !== "open") return false;
  if (filter === "open") return true;

  const category = taskDateCategory(task, now);
  if (filter === "today") return category === "today";
  if (category !== "upcoming") return false;

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const nextScheduledAt = Math.min(...[task.plannedAt, task.dueAt]
    .filter((timestamp): timestamp is number => timestamp !== null));
  return nextScheduledAt <= endOfToday.getTime() + (7 * 24 * 60 * 60 * 1_000);
}

function taskGroupLabel(task: UserTask, filter: TaskListFilter, now: number): string {
  if (filter === "done") return "已完成";
  if (filter === "today") return "今天";
  if (filter === "upcoming") return "即将到期";

  const category = taskDateCategory(task, now);
  if (category === "today") return "今天";
  if (category === "overdue") return "已过期";
  if (category === "upcoming") return "接下来";
  return "不限期限";
}

function notePreview(markdown: string): string {
  return markdown
    .replace(/[#>*_`]/g, "")
    .replace(/^\s*(?:[-+] |\d+[.)] |\[[ xX]\] )/gmu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function remainingTrashDays(purgeAfter: number | undefined, now: number): number | null {
  if (purgeAfter === undefined) return null;
  return Math.max(0, Math.ceil((purgeAfter - now) / (24 * 60 * 60 * 1_000)));
}

export default function OrganizerPage() {
  const tab = useUi((state) => state.organizerTab);
  const setTab = useUi((state) => state.openOrganizer);
  const [noteLibraryView, setNoteLibraryView] = useState<NoteLibraryView>("active");
  const [noteSearch, setNoteSearch] = useState("");
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [noteTaskDrafts, setNoteTaskDrafts] = useState<NoteTaskCandidate[] | null>(null);
  const [noteTaskReceipt, setNoteTaskReceipt] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [trash, setTrash] = useState<TrashSnapshot | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashBusy, setTrashBusy] = useState<string | null>(null);
  const [deletedTasksOpen, setDeletedTasksOpen] = useState(false);
  const newDraftNumber = useRef(0);
  const notes = useCaptures((state) => state.notes);
  const archivedNotes = useCaptures((state) => state.archivedNotes);
  const status = useCaptures((state) => state.status);
  const error = useCaptures((state) => state.error);
  const saving = useCaptures((state) => state.saving);
  const captureFileDropMode = useSettings((state) => state.captureFileDropMode);
  const taskModelParsingEnabled = useSettings((state) => state.taskModelParsingEnabled);
  const defaultProviderId = useSettings((state) => state.defaultProviderId);
  const defaultModelId = useSettings((state) => state.defaultModelId);
  const configuredProviders = useProviders((state) => state.configured);
  const bridgeClient = useBridgeClient();
  const taskModelTarget = useMemo(() => {
    const preferred = defaultProviderId
      ? configuredProviders.find((provider) => provider.id === defaultProviderId)
      : undefined;
    if (!preferred || preferred.authMode === "oauth-subscription") return null;
    const modelId = defaultModelId || preferred.models[0];
    return modelId ? { providerId: preferred.id, modelId } : null;
  }, [configuredProviders, defaultModelId, defaultProviderId]);
  const notebooks = useNotebooks((state) => state.list);
  const selectNote = useCaptures((state) => state.selectNote);
  const createNote = useCaptures((state) => state.createNote);
  const updateNote = useCaptures((state) => state.updateNote);
  const deleteNote = useCaptures((state) => state.deleteNote);
  const archiveNote = useCaptures((state) => state.archiveNote);
  const unarchiveNote = useCaptures((state) => state.unarchiveNote);
  const libraryNotes = noteLibraryView === "active" ? notes : archivedNotes;
  const filteredLibraryNotes = useMemo(() => {
    const query = noteSearch.trim().toLocaleLowerCase();
    if (!query) return libraryNotes;
    return libraryNotes.filter((note) => `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(query));
  }, [libraryNotes, noteSearch]);
  const recentNotes = useMemo(() => notes.slice(0, 3), [notes]);
  const conversations = useConversations((state) => state.byId);
  const runIds = useConversations((state) => state.runIds);
  const switchActiveConversation = useConversations((state) => state.switchActive);
  const pendingByConversation = useApprovals((state) => state.pendingByConversation);
  const artifacts = useArtifacts((state) => state.entries);
  const setView = useUi((state) => state.setView);
  const activeConversations = useMemo(() => Object.entries(runIds)
    .flatMap(([conversationId, runId]) => {
      const conversation = conversations[conversationId];
      return runId && conversation && !pendingByConversation[conversationId]
        ? [{ id: conversationId, title: conversation.title || "未命名对话", lastActivityAt: conversation.lastActivityAt }]
        : [];
    })
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, 2), [conversations, pendingByConversation, runIds]);
  const attentionConversations = useMemo(() => {
    const pending = Object.values(pendingByConversation)
      .flatMap((interaction) => {
        if (!interaction) return [];
        const conversation = conversations[interaction.conversationId];
        if (!conversation) return [];
        return [{
          id: interaction.conversationId,
          title: conversation.title || "未命名对话",
          label: interaction.kind === "approval" ? "等你确认" : "等你回答",
          at: interaction.receivedAt,
        }];
      });
    const pendingIds = new Set(pending.map((item) => item.id));
    const unread = Object.values(conversations)
      .filter((conversation) => conversation.unread && !pendingIds.has(conversation.id))
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title || "未命名对话",
        label: "未读更新",
        at: conversation.lastActivityAt,
      }));
    return [...pending, ...unread].sort((left, right) => right.at - left.at).slice(0, 3);
  }, [conversations, pendingByConversation]);
  const recentArtifacts = useMemo(() => [...artifacts]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 3), [artifacts]);
  const tasks = useTasks((state) => state.tasks);
  const taskStatus = useTasks((state) => state.status);
  const taskError = useTasks((state) => state.error);
  const taskSaving = useTasks((state) => state.saving);
  const createTask = useTasks((state) => state.create);
  const createManyTasks = useTasks((state) => state.createMany);
  const updateTask = useTasks((state) => state.update);
  const deleteTask = useTasks((state) => state.delete);
  const toggleTask = useTasks((state) => state.toggle);
  const taskListNow = Date.now();
  const todayTasks = useMemo(() => tasks.filter((task) => task.status === "open"
    && taskDateCategory(task, taskListNow) === "today"), [taskListNow, tasks]);
  const [quickTaskText, setQuickTaskText] = useState("");
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [taskListFilter, setTaskListFilter] = useState<TaskListFilter>("open");
  const [taskDraftState, setTaskDraftState] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [modelTaskFields, setModelTaskFields] = useState<Record<string, ParsedTaskField[]>>({});
  const [modelTaskParsing, setModelTaskParsing] = useState(false);
  const attemptedTaskTexts = useRef(new Set<string>());
  const taskLines = useMemo(() => quickTaskText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean), [quickTaskText]);
  const locallyParsedTasks = useMemo(() => taskLines.map((line) => ({
    line,
    parsed: parseTaskText(line),
  })), [taskLines]);
  const parsedTasks = useMemo(() => locallyParsedTasks.map(({ line, parsed }) => ({
    line,
    parsed: withModelTaskFields(parsed, taskModelParsingEnabled ? modelTaskFields[line] : undefined),
  })), [locallyParsedTasks, modelTaskFields, taskModelParsingEnabled]);
  const taskFilterCounts = useMemo(() => ({
    open: tasks.filter((task) => taskMatchesFilter(task, "open", taskListNow)).length,
    today: tasks.filter((task) => taskMatchesFilter(task, "today", taskListNow)).length,
    upcoming: tasks.filter((task) => taskMatchesFilter(task, "upcoming", taskListNow)).length,
    done: tasks.filter((task) => taskMatchesFilter(task, "done", taskListNow)).length,
  }), [taskListNow, tasks]);
  const taskGroups = useMemo(() => {
    const groups = new Map<string, UserTask[]>();
    tasks
      .filter((task) => taskMatchesFilter(task, taskListFilter, taskListNow))
      .forEach((task) => {
        const label = taskGroupLabel(task, taskListFilter, taskListNow);
        groups.set(label, [...(groups.get(label) ?? []), task]);
      });
    const order = taskListFilter === "open"
      ? ["今天", "已过期", "接下来", "不限期限"]
      : [taskListFilter === "done" ? "已完成" : taskListFilter === "today" ? "今天" : "即将到期"];
    return order.flatMap((label) => {
      const entries = groups.get(label);
      return entries?.length ? [{ label, tasks: entries }] : [];
    });
  }, [taskListFilter, taskListNow, tasks]);
  const trashNow = Date.now();
  const trashNoteGroups = useMemo(() => {
    const notesInTrash = trash?.notes ?? [];
    const expiring = notesInTrash.filter((note) => {
      const days = remainingTrashDays(note.purgeAfter, trashNow);
      return days !== null && days <= 7;
    });
    const expiringIds = new Set(expiring.map((note) => note.id));
    const recent = notesInTrash.filter((note) => !expiringIds.has(note.id));
    return [
      { label: "近期删除", notes: recent },
      { label: "即将清理", notes: expiring },
    ].filter((group) => group.notes.length > 0);
  }, [trash, trashNow]);
  const manualDateProvided = Boolean(
    taskDraftState.plannedAt || taskDraftState.dueAt || taskDraftState.reminderAt,
  );
  const unresolvedTask = parsedTasks.find(({ parsed }) => parsed.requiresModel);
  const taskSubmitDisabled = taskSaving
    || taskLines.length === 0
    || (Boolean(unresolvedTask) && !(taskLines.length === 1 && manualDateProvided));
  const locallyParsedNoteTasks = useMemo(() => (noteTaskDrafts ?? []).map((candidate) => ({
    ...candidate,
    parsed: parseTaskText(candidate.title),
  })), [noteTaskDrafts]);
  const parsedNoteTasks = useMemo(() => locallyParsedNoteTasks.map((candidate) => ({
    ...candidate,
    parsed: withModelTaskFields(
      candidate.parsed,
      taskModelParsingEnabled ? modelTaskFields[candidate.title] : undefined,
    ),
  })), [locallyParsedNoteTasks, modelTaskFields, taskModelParsingEnabled]);
  const selectedNoteTasks = parsedNoteTasks.filter((candidate) => candidate.selected);
  const noteTaskSubmitDisabled = taskSaving
    || !draft?.noteId
    || selectedNoteTasks.length === 0
    || selectedNoteTasks.some((candidate) => candidate.parsed.requiresModel
      && !candidate.plannedAt
      && !candidate.dueAt
      && !candidate.reminderAt);

  const ambiguousTaskTexts = useMemo(() => Array.from(new Set([
    ...locallyParsedTasks.filter((item) => item.parsed.requiresModel).map((item) => item.line),
    ...locallyParsedNoteTasks
      .filter((item) => item.selected && item.parsed.requiresModel)
      .map((item) => item.title),
  ])), [locallyParsedNoteTasks, locallyParsedTasks]);

  useEffect(() => {
    if (!taskModelParsingEnabled || !bridgeClient || !taskModelTarget) return;
    const pending = ambiguousTaskTexts.filter((text) => (
      !modelTaskFields[text] && !attemptedTaskTexts.current.has(text)
    ));
    if (pending.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      pending.forEach((text) => attemptedTaskTexts.current.add(text));
      setModelTaskParsing(true);
      void bridgeClient.invoke("bridge:resolveTaskTimes", {
        providerId: taskModelTarget.providerId,
        modelId: taskModelTarget.modelId,
        texts: pending,
        localNow: new Date().toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).then((result) => {
        if (cancelled || !result.ok) return;
        setModelTaskFields((current) => {
          const next = { ...current };
          for (const item of result.items) {
            const text = pending[item.index];
            if (text && item.fields.length > 0) next[text] = item.fields.map((field) => ({ ...field }));
          }
          return next;
        });
      }).catch(() => {
        // Keep the original text and the existing manual-confirmation path.
      }).finally(() => {
        if (!cancelled) setModelTaskParsing(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ambiguousTaskTexts, bridgeClient, modelTaskFields, taskModelParsingEnabled, taskModelTarget]);

  const openNote = (note: Note) => {
    selectNote(note.id);
    setDraft(noteDraft(note));
    setNoteTaskDrafts(null);
    setNoteTaskReceipt(null);
    setTab("notes");
  };

  const openConversation = (conversationId: string) => {
    switchActiveConversation(conversationId);
    setView("chat");
  };

  const startNote = () => {
    newDraftNumber.current += 1;
    selectNote(null);
    setNoteTaskDrafts(null);
    setNoteTaskReceipt(null);
    setDraft({
      key: `new:${newDraftNumber.current}`,
      noteId: null,
      title: "",
      markdown: "",
      revision: null,
      attachments: [],
    });
  };

  const saveDraft = async () => {
    if (!draft || (!draft.title.trim() && !draft.markdown.trim())) return;
    try {
      const saved = draft.noteId && draft.revision !== null
        ? await updateNote({
            id: draft.noteId,
            title: draft.title,
            markdown: draft.markdown,
            expectedRevision: draft.revision,
          })
        : await createNote({ title: draft.title, markdown: draft.markdown });
      setDraft(noteDraft(saved));
    } catch {
      // The shared store exposes the user-facing error beside the editor.
    }
  };

  const changeArchiveState = async () => {
    if (!draft?.noteId || draft.revision === null) return;
    try {
      const affected = noteLibraryView === "active"
        ? await archiveNote({ id: draft.noteId, expectedRevision: draft.revision, childStrategy: "subtree" })
        : await unarchiveNote({ id: draft.noteId, expectedRevision: draft.revision });
      const saved = affected.find((note) => note.id === draft.noteId);
      if (saved) setDraft(noteDraft(saved));
      setNoteLibraryView(noteLibraryView === "active" ? "archived" : "active");
    } catch {
      // The shared store exposes the user-facing error beside the editor.
    }
  };

  const moveNoteToTrash = async () => {
    if (!draft?.noteId || draft.revision === null) return;
    try {
      await deleteNote({ id: draft.noteId, expectedRevision: draft.revision, childStrategy: "subtree" });
      setDraft(null);
      setNoteTaskDrafts(null);
    } catch {
      // The shared store exposes the user-facing error beside the editor.
    }
  };

  const requireAttachmentClient = (): IpcCaptureClient => {
    if (!window.leemoCapture) throw new Error("此环境暂时无法添加附件。");
    return new IpcCaptureClient(window.leemoCapture);
  };

  const attachFiles = async (files: File[]): Promise<void> => {
    const initial = draft;
    if (!initial?.noteId || initial.revision === null || files.length === 0) return;
    if (!window.leemoWorkspace) {
      setAttachmentError("无法读取拖入文件的位置，请改用桌面版 Leemo。");
      return;
    }
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const client = requireAttachmentClient();
      let current = initial;
      for (const file of files) {
        const path = window.leemoWorkspace.pathForFile(file);
        if (!path) throw new Error("无法读取这个文件的位置，请重新选择文件。");
        const updated = captureFileDropMode === "copy"
          ? await client.attachFileCopy({ noteId: current.noteId!, expectedRevision: current.revision!, path })
          : await client.attachExternalFile({ noteId: current.noteId!, expectedRevision: current.revision!, path });
        current = noteDraft(updated);
      }
      setDraft(current);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "附件没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const attachPastedImage = async (file: File): Promise<void> => {
    const current = draft;
    if (!current?.noteId || current.revision === null || !file.type.startsWith("image/")) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const updated = await requireAttachmentClient().attachImageBytes({
        noteId: current.noteId,
        expectedRevision: current.revision,
        name: file.name || "粘贴图片.png",
        mimeType: file.type,
        bytes,
      });
      setDraft(noteDraft(updated));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "图片没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = async (attachment: NoteAttachment): Promise<void> => {
    const current = draft;
    if (!current?.noteId || current.revision === null) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const updated = await requireAttachmentClient().removeAttachment({
        noteId: current.noteId,
        attachmentId: attachment.id,
        expectedRevision: current.revision,
      });
      setDraft(noteDraft(updated));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "附件没有移除。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const openNoteTaskPreview = () => {
    if (!draft?.noteId) return;
    setNoteTaskReceipt(null);
    setNoteTaskDrafts(noteTaskCandidates(draft.markdown));
  };

  const submitNoteTasks = async () => {
    if (!draft?.noteId || noteTaskSubmitDisabled) return;
    try {
      const created = await createManyTasks(selectedNoteTasks.map((candidate) => ({
        ...parsedInput(candidate.title, candidate.parsed.fields),
        ...(candidate.plannedAt ? { plannedAt: new Date(candidate.plannedAt).getTime() } : {}),
        ...(candidate.dueAt ? { dueAt: new Date(candidate.dueAt).getTime() } : {}),
        ...(candidate.reminderAt ? { reminderAt: new Date(candidate.reminderAt).getTime() } : {}),
        details: candidate.details,
        noteId: draft.noteId,
      })));
      setNoteTaskDrafts(null);
      setNoteTaskReceipt(`已创建 ${created.length} 条待办 · 便签原文保留`);
    } catch {
      // The shared task store renders its user-facing error in the preview.
    }
  };

  const editNoteTaskTimes = (candidate: typeof parsedNoteTasks[number]) => {
    setNoteTaskDrafts((current) => current?.map((item) => {
      if (item.id !== candidate.id) return item;
      const next = { ...item, detailsOpen: true };
      for (const field of candidate.parsed.fields) {
        const value = "date" in field ? `${field.date}T${field.time ?? "00:00"}` : "";
        if (field.kind === "planned" && !next.plannedAt) next.plannedAt = value;
        if (field.kind === "due" && !next.dueAt) next.dueAt = value;
        if (field.kind === "reminder" && !next.reminderAt) next.reminderAt = value;
      }
      return next;
    }) ?? null);
  };

  const openTaskDetails = () => {
    const parsed = parsedTasks.length === 1 ? parsedTasks[0].parsed.fields : [];
    setTaskDraftState((current) => {
      const next = { ...current };
      for (const field of parsed) {
        if (field.kind === "planned" && !next.plannedAt) next.plannedAt = `${field.date}T${field.time ?? "00:00"}`;
        if (field.kind === "due" && !next.dueAt) next.dueAt = `${field.date}T${field.time ?? "00:00"}`;
        if (field.kind === "reminder" && !next.reminderAt) next.reminderAt = `${field.date}T${field.time ?? "00:00"}`;
        if (field.kind === "recurrence" && !next.recurrence) next.recurrence = field.rule;
      }
      return next;
    });
    setTaskDetailsOpen(true);
  };

  const resetTaskDraft = () => {
    setQuickTaskText("");
    setTaskDetailsOpen(false);
    setTaskDraftState(EMPTY_TASK_DRAFT);
  };

  const submitTask = async () => {
    if (taskSubmitDisabled) return;
    try {
      if (taskDraftState.id && taskDraftState.expectedRevision !== null) {
        const parsed = parsedTasks[0]?.parsed.fields ?? [];
        await updateTask({
          id: taskDraftState.id,
          expectedRevision: taskDraftState.expectedRevision,
          ...taskInput(taskLines[0], parsed, taskDraftState, true),
        });
      } else if (parsedTasks.length === 1) {
        await createTask(taskInput(
          parsedTasks[0].line,
          parsedTasks[0].parsed.fields,
          taskDraftState,
          taskDetailsOpen,
        ));
      } else {
        await createManyTasks(parsedTasks.map(({ line, parsed }) => parsedInput(line, parsed.fields)));
      }
      resetTaskDraft();
    } catch {
      // The shared store renders the user-facing error below the form.
    }
  };

  const editTask = (task: UserTask) => {
    setQuickTaskText(task.title);
    setTaskDraftState(taskDraft(task));
    setTaskDetailsOpen(true);
  };

  const moveTaskToTrash = async (task: UserTask) => {
    try {
      await deleteTask({ id: task.id, expectedRevision: task.revision });
      if (taskDraftState.id === task.id) resetTaskDraft();
    } catch {
      // The shared store renders the user-facing error below the form.
    }
  };

  const requireTrashClient = (): IpcTrashClient => {
    if (!window.leemoTrash) throw new Error("此环境暂时无法打开回收站。");
    return new IpcTrashClient(window.leemoTrash);
  };

  const loadTrash = async (): Promise<void> => {
    setTrashError(null);
    try {
      setTrash(await requireTrashClient().list());
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "回收站暂时无法读取。");
    }
  };

  const restoreTrashItem = async (kind: "note" | "task", id: string, expectedRevision: number): Promise<void> => {
    const key = `${kind}:${id}`;
    setTrashBusy(key);
    setTrashError(null);
    try {
      await requireTrashClient().restore({ kind, id, expectedRevision });
      setTrash((current) => current && {
        notes: kind === "note" ? current.notes.filter((note) => note.id !== id) : current.notes,
        tasks: kind === "task" ? current.tasks.filter((task) => task.id !== id) : current.tasks,
      });
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "恢复失败，请稍后重试。");
    } finally {
      setTrashBusy(null);
    }
  };

  const permanentlyDeleteTrashItem = async (kind: "note" | "task", id: string, expectedRevision: number, title: string): Promise<void> => {
    if (!window.confirm(`确定要彻底删除“${title}”吗？此操作无法恢复。`)) return;
    const key = `${kind}:${id}`;
    setTrashBusy(key);
    setTrashError(null);
    try {
      await requireTrashClient().permanentlyDelete({ kind, id, expectedRevision });
      setTrash((current) => current && {
        notes: kind === "note" ? current.notes.filter((note) => note.id !== id) : current.notes,
        tasks: kind === "task" ? current.tasks.filter((task) => task.id !== id) : current.tasks,
      });
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "彻底删除失败，请稍后重试。");
    } finally {
      setTrashBusy(null);
    }
  };

  return (
    <section className="organizer" aria-label="工作看板">
      <header className="organizer__header">
        <h1>看板</h1>
        <nav className="organizer__tabs" role="tablist" aria-label="工作看板视图">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`organizer-panel-${item.id}`}
              className="organizer__tab"
              onClick={() => {
                setTab(item.id);
                if (item.id === "trash") {
                  setDeletedTasksOpen(false);
                  void loadTrash();
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "today" ? (
        <div
          id="organizer-panel-today"
          role="tabpanel"
          className="organizer-today"
          aria-label="今天"
        >
          <header className="organizer-today__title">
            <div>
              <p>{formatToday()}</p>
              <h2>今天</h2>
              <p className="organizer-today__summary">
                {todayTasks.length} 件要做 · {activeConversations.length} 项执行中 · {attentionConversations.length} 件等你处理
              </p>
            </div>
          </header>

          <div className="organizer-today__columns">
            <div className="organizer-today__column organizer-today__column--primary" role="region" aria-label="今天的行动与状态">
              <section className="organizer-record organizer-record--lead" aria-label="今天要做">
                <header>
                  <h3>今天要做</h3>
                  <span>{todayTasks.length}</span>
                </header>
                {todayTasks.length > 0 ? (
                  <div className="organizer-record__links">
                    {todayTasks.slice(0, 3).map((task) => (
                      <button key={task.id} type="button" onClick={() => setTab("tasks")}>{task.title}</button>
                    ))}
                  </div>
                ) : <p>今天没有未完成的待办。</p>}
              </section>

              <section className="organizer-record" aria-label="正在执行">
                <header>
                  <h3>正在执行</h3>
                  <span>{activeConversations.length}</span>
                </header>
                {activeConversations.length > 0 ? (
                  <div className="organizer-record__links">
                    {activeConversations.map((conversation) => (
                      <button key={conversation.id} type="button" onClick={() => openConversation(conversation.id)}>
                        {conversation.title}
                      </button>
                    ))}
                  </div>
                ) : <p>当前没有执行中的任务。</p>}
              </section>

              <section className="organizer-record" aria-label="等你处理">
                <header>
                  <h3>等你处理</h3>
                  <span>{attentionConversations.length}</span>
                </header>
                {attentionConversations.length > 0 ? (
                  <div className="organizer-record__links">
                    {attentionConversations.map((conversation) => (
                      <button
                        key={`${conversation.id}:${conversation.label}`}
                        type="button"
                        aria-label={`${conversation.title}（${conversation.label}）`}
                        onClick={() => openConversation(conversation.id)}
                      >
                        {conversation.title} · {conversation.label}
                      </button>
                    ))}
                  </div>
                ) : <p>暂时没有需要你处理的事项。</p>}
              </section>
            </div>

            <div className="organizer-today__column organizer-today__column--secondary" role="region" aria-label="今天的记录与成果">
              <section className="organizer-record" aria-label="收集箱">
                <header>
                  <h3>收集箱</h3>
                  <span>{status === "loading" ? "读取中" : `${notes.length} 条便签`}</span>
                </header>
                {recentNotes.length > 0 ? (
                  <div className="organizer-record__links">
                    {recentNotes.map((note) => (
                      <button key={note.id} type="button" onClick={() => openNote(note)}>
                        {visibleNoteTitle(note)}
                      </button>
                    ))}
                  </div>
                ) : <p>{status === "loading" ? "正在读取便签…" : "还没有便签。"}</p>}
              </section>

              <section className="organizer-record" aria-label="最近成果">
                <header>
                  <h3>最近成果</h3>
                  <span>{recentArtifacts.length}</span>
                </header>
                {recentArtifacts.length > 0 ? (
                  <div className="organizer-record__links">
                    {recentArtifacts.map((artifact) => (
                      <button key={artifact.id} type="button" onClick={() => setView("artifacts")}>
                        {artifact.title}
                      </button>
                    ))}
                  </div>
                ) : <p>还没有最近成果。</p>}
              </section>

              <section className="organizer-record organizer-record--continue" aria-label="继续记录">
                <header>
                  <h3>继续记录</h3>
                </header>
                {recentNotes[0] ? (
                  <button type="button" onClick={() => openNote(recentNotes[0])}>
                    {visibleNoteTitle(recentNotes[0])}
                  </button>
                ) : <p>新建便签后，最近编辑的内容会出现在这里。</p>}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div
          id="organizer-panel-notes"
          role="tabpanel"
          className={`organizer-notes${draft ? " is-editor-open" : ""}`}
          aria-label="便签"
        >
          <aside className="organizer-notes__library" aria-label="便签列表">
            <div className="organizer-notes__library-header">
              <div>
                <h2>{noteLibraryView === "active" ? "便签" : "已归档"}</h2>
                <span>{libraryNotes.length}</span>
              </div>
              <button type="button" onClick={startNote} aria-label="新建便签" title="新建便签">
                <FilePlus2 size={17} strokeWidth={1.7} aria-hidden />
              </button>
            </div>
            <div className="organizer-notes__library-tools">
              <input
                type="search"
                aria-label="搜索便签"
                placeholder="搜索标题和内容"
                value={noteSearch}
                onChange={(event) => setNoteSearch(event.target.value)}
              />
              <div role="group" aria-label="便签范围" className="organizer-notes__library-switch">
                <button
                  type="button"
                  aria-pressed={noteLibraryView === "active"}
                  onClick={() => {
                    setNoteLibraryView("active");
                    setDraft(null);
                    selectNote(null);
                  }}
                >
                  便签
                </button>
                <button
                  type="button"
                  aria-pressed={noteLibraryView === "archived"}
                  onClick={() => {
                    setNoteLibraryView("archived");
                    setDraft(null);
                    selectNote(null);
                  }}
                >
                  已归档
                </button>
              </div>
            </div>

            {status === "loading" ? <p className="organizer-notes__message">正在读取便签…</p> : null}
            {status === "error" && error ? (
              <p className="organizer-notes__message organizer-notes__message--error" role="alert">{error}</p>
            ) : null}
            {status === "ready" && libraryNotes.length === 0 ? (
              <div className="organizer-notes__empty">
                <Inbox size={19} strokeWidth={1.5} aria-hidden />
                <p>{noteLibraryView === "active" ? "还没有便签" : "还没有已归档便签"}</p>
                {noteLibraryView === "active" ? <button type="button" onClick={startNote}>新建便签</button> : null}
              </div>
            ) : null}
            {status === "ready" && libraryNotes.length > 0 && filteredLibraryNotes.length === 0 ? (
              <p className="organizer-notes__message">没有匹配的便签</p>
            ) : null}

            <div className="organizer-notes__list">
              {filteredLibraryNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={draft?.noteId === note.id ? "is-active" : ""}
                  aria-label={`打开便签 ${visibleNoteTitle(note)}`}
                  onClick={() => openNote(note)}
                >
                  <div>
                    <strong>{visibleNoteTitle(note)}</strong>
                    {notePreview(note.markdown) ? <p>{notePreview(note.markdown)}</p> : null}
                  </div>
                  <time dateTime={new Date(note.updatedAt).toISOString()}>
                    {new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(note.updatedAt)}
                  </time>
                </button>
              ))}
            </div>
          </aside>

          <section className="organizer-notes__editor" aria-label="便签编辑">
            {draft ? (
              <>
                <div className="organizer-notes__editor-header">
                  <button
                    type="button"
                    className="organizer-notes__back"
                    aria-label="返回便签列表"
                    onClick={() => {
                      setDraft(null);
                      setNoteTaskDrafts(null);
                      selectNote(null);
                    }}
                  >
                    便签列表
                  </button>
                  <input
                    aria-label="便签标题"
                    placeholder="标题"
                    value={draft.title}
                    disabled={saving}
                    onChange={(event) => setDraft((current) => current
                      ? { ...current, title: event.target.value }
                      : current)}
                  />
                  {draft.noteId ? (
                    <button
                      type="button"
                      className="organizer-notes__convert"
                      aria-label={noteLibraryView === "active" ? "归档便签" : "恢复便签"}
                      disabled={saving}
                      onClick={() => void changeArchiveState()}
                    >
                      {noteLibraryView === "active" ? "归档" : "恢复"}
                    </button>
                  ) : null}
                  {draft.noteId ? (
                    <button
                      type="button"
                      className="organizer-notes__delete"
                      aria-label="移入回收站"
                      disabled={saving}
                      onClick={() => void moveNoteToTrash()}
                    >
                      <Trash2 size={15} strokeWidth={1.7} aria-hidden />
                    </button>
                  ) : null}
                  {draft.noteId && noteLibraryView === "active" ? (
                    <button
                      type="button"
                      className="organizer-notes__convert"
                      aria-label="从便签创建待办"
                      disabled={saving || taskSaving || noteTaskCandidates(draft.markdown).length === 0}
                      onClick={openNoteTaskPreview}
                    >
                      从便签创建待办
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="organizer-notes__save"
                    aria-label="保存便签"
                    disabled={saving || (!draft.title.trim() && !draft.markdown.trim())}
                    onClick={() => void saveDraft()}
                  >
                    <Save size={15} strokeWidth={1.8} aria-hidden />
                    <span>{saving ? "保存中" : "保存"}</span>
                  </button>
                </div>
                {error ? <p className="organizer-notes__save-error" role="alert">{error}</p> : null}
                {noteTaskDrafts ? (
                  <section className="organizer-note-tasks" aria-label="创建待办预览">
                    <header>
                      <div>
                        <strong>从便签创建待办</strong>
                        <span>确认要保留的条目，便签内容不会改变。</span>
                      </div>
                      <button type="button" onClick={() => setNoteTaskDrafts(null)}>取消</button>
                    </header>
                    <div className="organizer-note-tasks__list">
                      {parsedNoteTasks.map((candidate, index) => (
                        <div className="organizer-note-tasks__item" key={candidate.id}>
                          <input
                            type="checkbox"
                            aria-label={`选择待办 ${candidate.title}`}
                            checked={candidate.selected}
                            onChange={(event) => setNoteTaskDrafts((current) => current?.map((item) => item.id === candidate.id
                              ? { ...item, selected: event.target.checked }
                              : item) ?? null)}
                          />
                          <div>
                            <input
                              type="text"
                              aria-label={`待办标题 ${index + 1}`}
                              value={candidate.title}
                              onChange={(event) => setNoteTaskDrafts((current) => current?.map((item) => item.id === candidate.id
                                ? { ...item, title: event.target.value }
                                : item) ?? null)}
                            />
                            {candidate.parsed.requiresModel ? (
                              <div className="organizer-note-tasks__ambiguity" role="status">
                                <span>{modelTaskParsing ? "正在识别计划、截止和提醒…" : candidate.parsed.reason}</span>
                                {!modelTaskParsing ? (
                                  <button type="button" onClick={() => editNoteTaskTimes(candidate)}>手动填写时间</button>
                                ) : null}
                              </div>
                            ) : candidate.parsed.fields.length > 0 ? (
                              <div className="organizer-note-tasks__chips">
                                {candidate.parsed.fields.map((field) => (
                                  <button
                                    type="button"
                                    key={`${field.kind}:${field.source}`}
                                    onClick={() => editNoteTaskTimes(candidate)}
                                    title="点击修改"
                                  >
                                    {fieldLabel(field)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {candidate.detailsOpen ? (
                              <div className="organizer-note-tasks__times">
                                <label>
                                  计划
                                  <input
                                    type="datetime-local"
                                    aria-label={`计划时间 ${index + 1}`}
                                    value={candidate.plannedAt}
                                    onChange={(event) => setNoteTaskDrafts((current) => current?.map((item) => item.id === candidate.id
                                      ? { ...item, plannedAt: event.target.value }
                                      : item) ?? null)}
                                  />
                                </label>
                                <label>
                                  截止
                                  <input
                                    type="datetime-local"
                                    aria-label={`截止时间 ${index + 1}`}
                                    value={candidate.dueAt}
                                    onChange={(event) => setNoteTaskDrafts((current) => current?.map((item) => item.id === candidate.id
                                      ? { ...item, dueAt: event.target.value }
                                      : item) ?? null)}
                                  />
                                </label>
                                <label>
                                  提醒
                                  <input
                                    type="datetime-local"
                                    aria-label={`提醒时间 ${index + 1}`}
                                    value={candidate.reminderAt}
                                    onChange={(event) => setNoteTaskDrafts((current) => current?.map((item) => item.id === candidate.id
                                      ? { ...item, reminderAt: event.target.value }
                                      : item) ?? null)}
                                  />
                                </label>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {taskError ? <p className="organizer-tasks__error" role="alert">{taskError}</p> : null}
                    <footer>
                      <span>已选 {selectedNoteTasks.length} 条</span>
                      <button
                        type="button"
                        disabled={noteTaskSubmitDisabled}
                        onClick={() => void submitNoteTasks()}
                      >
                        创建 {selectedNoteTasks.length} 条待办
                      </button>
                    </footer>
                  </section>
                ) : null}
                {noteTaskReceipt ? <p className="organizer-note-tasks__receipt" role="status">{noteTaskReceipt}</p> : null}
                {draft.noteId ? (
                  <section
                    className="organizer-note-attachments"
                    aria-label="附件"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void attachFiles(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <header>
                      <strong>附件</strong>
                      <label>
                        <span>{attachmentBusy ? "处理中…" : "添加文件"}</span>
                        <input
                          type="file"
                          aria-label="添加附件"
                          disabled={attachmentBusy}
                          onChange={(event) => {
                            void attachFiles(Array.from(event.target.files ?? []));
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </header>
                    {attachmentError ? <p role="alert">{attachmentError}</p> : null}
                    {draft.attachments.length > 0 ? (
                      <ul>
                        {draft.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <span>{attachment.storage === "external" ? attachment.path : attachment.name}</span>
                            <small>{attachment.storage === "external" ? "仅引用" : "已保存副本"}</small>
                            <button
                              type="button"
                              aria-label={`移除附件 ${attachment.name}`}
                              disabled={attachmentBusy}
                              onClick={() => void removeAttachment(attachment)}
                            >
                              移除
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : <p>拖入文件或选择文件；粘贴图片会保存到 Leemo 文件存储位置。</p>}
                  </section>
                ) : null}
                <div
                  className="organizer-notes__editor-body"
                  onPaste={(event) => {
                    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
                    if (!image) return;
                    event.preventDefault();
                    void attachPastedImage(image);
                  }}
                >
                  <CaptureEditor
                    key={draft.key}
                    markdown={draft.markdown}
                    disabled={saving || attachmentBusy}
                    onMarkdownChange={(markdown) => setDraft((current) => current
                      ? { ...current, markdown }
                      : current)}
                    onSave={() => void saveDraft()}
                  />
                </div>
              </>
            ) : (
              <div className="organizer-notes__editor-empty">
                <p>选择一条便签，或新建便签。</p>
                <button type="button" onClick={startNote}>新建便签</button>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div
          id="organizer-panel-tasks"
          role="tabpanel"
          className="organizer-tasks"
          aria-label="待办"
        >
          <section className="organizer-tasks__composer" aria-label="新增待办">
            <div className="organizer-tasks__composer-title">
              <div>
                <h2>{taskDraftState.id ? "编辑待办" : "新增待办"}</h2>
                <p>一行一条，可一次新增多条。</p>
              </div>
              <button
                type="button"
                className="organizer-tasks__details-toggle"
                aria-expanded={taskDetailsOpen}
                onClick={() => taskDetailsOpen ? setTaskDetailsOpen(false) : openTaskDetails()}
              >
                补充信息
                <ChevronDown size={15} strokeWidth={1.7} aria-hidden />
              </button>
            </div>
            <textarea
              aria-label="快速新增待办"
              value={quickTaskText}
              rows={taskLines.length > 1 ? Math.min(5, taskLines.length + 1) : 2}
              placeholder="写下要做的事，也可以带上时间"
              disabled={taskSaving}
              onChange={(event) => setQuickTaskText(event.target.value)}
            />

            {parsedTasks.length > 0 ? (
              <div className="organizer-tasks__parse" aria-live="polite">
                {unresolvedTask ? (
                  <p className="organizer-tasks__ambiguity" role="status">
                    {modelTaskParsing
                      ? "正在识别计划、截止和提醒…"
                      : "需要确认：多个日期无法判断各自是计划、截止还是提醒时间。请补充信息或改写。"}
                  </p>
                ) : null}
                {parsedTasks.length === 1 ? parsedTasks[0].parsed.fields.map((field) => (
                  <button
                    key={`${field.kind}:${field.source}`}
                    type="button"
                    className="organizer-tasks__chip"
                    onClick={openTaskDetails}
                    title="点击修改"
                  >
                    {fieldLabel(field)}
                  </button>
                )) : (
                  <span>{parsedTasks.length} 条待办</span>
                )}
              </div>
            ) : null}

            {taskDetailsOpen && taskLines.length <= 1 ? (
              <div className="organizer-tasks__details">
                <label className="organizer-tasks__details-wide">
                  <span>详情</span>
                  <textarea
                    aria-label="待办详情"
                    value={taskDraftState.details}
                    rows={2}
                    onChange={(event) => setTaskDraftState((current) => ({ ...current, details: event.target.value }))}
                  />
                </label>
                <label>
                  <span>计划</span>
                  <input aria-label="计划时间" type="datetime-local" value={taskDraftState.plannedAt} onChange={(event) => setTaskDraftState((current) => ({ ...current, plannedAt: event.target.value }))} />
                </label>
                <label>
                  <span>截止</span>
                  <input aria-label="截止时间" type="datetime-local" value={taskDraftState.dueAt} onChange={(event) => setTaskDraftState((current) => ({ ...current, dueAt: event.target.value }))} />
                </label>
                <label>
                  <span>提醒</span>
                  <input aria-label="提醒时间" type="datetime-local" value={taskDraftState.reminderAt} onChange={(event) => setTaskDraftState((current) => ({ ...current, reminderAt: event.target.value }))} />
                </label>
                <label>
                  <span>重复</span>
                  <select aria-label="重复" value={taskDraftState.recurrence} onChange={(event) => setTaskDraftState((current) => ({ ...current, recurrence: event.target.value as TaskDraft["recurrence"] }))}>
                    <option value="">不重复</option>
                    <option value="daily">每天</option>
                    <option value="weekdays">工作日</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </label>
                <label>
                  <span>关联本子</span>
                  <select aria-label="关联本子" value={taskDraftState.notebookId} onChange={(event) => setTaskDraftState((current) => ({ ...current, notebookId: event.target.value }))}>
                    <option value="">不关联本子</option>
                    {notebooks.map((notebook) => <option key={notebook.id} value={notebook.id}>{notebook.title}</option>)}
                  </select>
                </label>
              </div>
            ) : null}

            {taskError ? <p className="organizer-tasks__error" role="alert">{taskError}</p> : null}
            <div className="organizer-tasks__actions">
              {taskDraftState.id ? <button type="button" onClick={resetTaskDraft}>取消</button> : null}
              <button
                type="button"
                className="organizer-tasks__submit"
                disabled={taskSubmitDisabled}
                onClick={() => void submitTask()}
              >
                {taskDraftState.id
                  ? "保存待办"
                  : parsedTasks.length > 1
                    ? `批量新增 ${parsedTasks.length} 条待办`
                    : "新增待办"}
              </button>
            </div>
          </section>

          <section className="organizer-tasks__list" aria-label="待办列表">
            <header>
              <h2>待办</h2>
              <span>{taskFilterCounts.open}</span>
            </header>
            <div className="organizer-tasks__filters" role="group" aria-label="待办筛选">
              {([
                { id: "open", label: "未完成" },
                { id: "today", label: "今天" },
                { id: "upcoming", label: "即将到期" },
                { id: "done", label: "已完成" },
              ] as Array<{ id: TaskListFilter; label: string }>).map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={taskListFilter === filter.id}
                  onClick={() => setTaskListFilter(filter.id)}
                >
                  {filter.label} <span>{taskFilterCounts[filter.id]}</span>
                </button>
              ))}
            </div>
            {taskStatus === "loading" ? <p className="organizer-tasks__empty">正在读取待办…</p> : null}
            {taskStatus === "ready" && taskGroups.length === 0 ? <p className="organizer-tasks__empty">这里还没有待办。</p> : null}
            {taskGroups.map((group) => (
              <section key={group.label} className="organizer-tasks__group" aria-label={`${group.label}待办`}>
                <h3>{group.label}</h3>
                {group.tasks.map((task) => {
                  const metadata = taskMetadata(
                    task,
                    notebooks.find((notebook) => notebook.id === task.notebookId)?.title,
                  );
                  return (
                    <article key={task.id} className={task.status === "done" ? "is-done" : ""}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={task.status === "done"}
                        aria-label={`${task.status === "done" ? "重新打开" : "完成"} ${task.title}`}
                        className="organizer-tasks__check"
                        onClick={() => void toggleTask(task.id).catch(() => undefined)}
                      >
                        {task.status === "done" ? <Check size={13} strokeWidth={2} aria-hidden /> : null}
                      </button>
                      <div>
                        <strong>{task.title}</strong>
                        {task.details ? <p>{task.details}</p> : null}
                        {metadata.length > 0 ? (
                          <ul className="organizer-tasks__metadata" aria-label={`${task.title} 的待办信息`}>
                            {metadata.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                          </ul>
                        ) : null}
                      </div>
                      <div className="organizer-tasks__row-actions">
                        <button type="button" aria-label={`编辑 ${task.title}`} className="organizer-tasks__edit" onClick={() => editTask(task)}>
                          <Pencil size={15} strokeWidth={1.6} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`移入回收站 ${task.title}`}
                          className="organizer-tasks__edit organizer-tasks__delete"
                          disabled={taskSaving}
                          onClick={() => void moveTaskToTrash(task)}
                        >
                          <Trash2 size={15} strokeWidth={1.6} aria-hidden />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </section>
        </div>
      ) : null}

      {tab === "trash" ? (
        <div
          id="organizer-panel-trash"
          role="tabpanel"
          className="organizer-trash"
          aria-label="回收站"
        >
          <header className="organizer-trash__header">
            <div>
              <h2>回收站</h2>
              <p>删除的便签会保留 30 天，到期后自动清理。</p>
            </div>
            <button type="button" onClick={() => void loadTrash()} disabled={trashBusy !== null}>刷新</button>
          </header>
          {trashError ? <p className="organizer-trash__error" role="alert">{trashError}</p> : null}
          {trash ? (
            trash.notes.length === 0 && trash.tasks.length === 0 ? (
              <p className="organizer-trash__empty">回收站是空的。</p>
            ) : (
              <>
                {trash.tasks.length > 0 ? (
                  <button
                    type="button"
                    className="organizer-trash__task-entry"
                    aria-expanded={deletedTasksOpen}
                    onClick={() => setDeletedTasksOpen((open) => !open)}
                  >
                    {deletedTasksOpen ? "收起" : "查看"}已删除待办 {trash.tasks.length}
                  </button>
                ) : null}

                {trash.notes.length === 0 ? <p className="organizer-trash__empty">没有已删除便签。</p> : null}
                {trashNoteGroups.map((group) => (
                  <section key={group.label} className="organizer-trash__group" aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <div className="organizer-trash__list">
                      {group.notes.map((note) => {
                        const title = visibleNoteTitle(note);
                        const busy = trashBusy === `note:${note.id}`;
                        const remainingDays = remainingTrashDays(note.purgeAfter, trashNow);
                        return (
                          <article key={`note:${note.id}`}>
                            <div>
                              <strong>{title}</strong>
                              <p>
                                {note.deletedAt
                                  ? `${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(note.deletedAt)} 删除`
                                  : "已删除"}
                                {remainingDays !== null ? ` · 还剩 ${remainingDays} 天` : ""}
                              </p>
                            </div>
                            <div className="organizer-trash__actions">
                              <button type="button" disabled={busy} aria-label={`恢复便签 ${title}`} onClick={() => void restoreTrashItem("note", note.id, note.revision)}>恢复</button>
                              <button type="button" disabled={busy} aria-label={`彻底删除便签 ${title}`} onClick={() => void permanentlyDeleteTrashItem("note", note.id, note.revision, title)}>彻底删除</button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}

                {deletedTasksOpen && trash.tasks.length > 0 ? (
                  <section className="organizer-trash__group organizer-trash__group--tasks" aria-label="已删除待办">
                    <h3>已删除待办</h3>
                    <div className="organizer-trash__list">
                      {trash.tasks.map((task) => {
                        const busy = trashBusy === `task:${task.id}`;
                        return (
                          <article key={`task:${task.id}`}>
                            <div>
                              <strong>{task.title}</strong>
                              {task.details ? <p>{task.details}</p> : null}
                            </div>
                            <div className="organizer-trash__actions">
                              <button type="button" disabled={busy} aria-label={`恢复待办 ${task.title}`} onClick={() => void restoreTrashItem("task", task.id, task.revision)}>恢复</button>
                              <button type="button" disabled={busy} aria-label={`彻底删除待办 ${task.title}`} onClick={() => void permanentlyDeleteTrashItem("task", task.id, task.revision, task.title)}>彻底删除</button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            )
          ) : <p className="organizer-trash__empty">正在读取回收站…</p>}
        </div>
      ) : null}
    </section>
  );
}
