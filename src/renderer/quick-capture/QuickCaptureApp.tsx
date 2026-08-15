import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import type { Note, QuickDraft } from "../../captures";
import type { CreateTaskInput, UserTask } from "../../tasks";
import type { QuickCaptureClient } from "../capture/client";
import CaptureEditor from "../components/CaptureEditor";
import LeemoMark from "../components/brand/LeemoMark";
import "./QuickCaptureApp.css";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type DraftContent = Pick<
  QuickDraft,
  "mode" | "title" | "markdown" | "plannedAt" | "dueAt" | "reminderAt" | "recurrence"
>;
interface TaskDraft {
  plannedAt: number | null;
  dueAt: number | null;
  reminderAt: number | null;
  recurrence: UserTask["recurrence"];
}

type PendingAttachment =
  | { kind: "image"; name: string; mimeType: string; bytes: Uint8Array }
  | { kind: "file"; name: string; path: string };

const EMPTY_TASK_DRAFT: TaskDraft = {
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  recurrence: null,
};

export interface QuickCaptureAppProps {
  client: QuickCaptureClient;
  debounceMs?: number;
}

function sameContent(left: DraftContent, right: DraftContent): boolean {
  return left.title === right.title && left.markdown === right.markdown;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function inputTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateTimeInput(value: number | null): string {
  if (value === null) return "";
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function QuickCaptureApp({
  client,
  debounceMs = 350,
}: QuickCaptureAppProps) {
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [mode, setMode] = useState<QuickDraft["mode"]>("note");
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0);
  const [pendingAttachmentNames, setPendingAttachmentNames] = useState<string[]>([]);

  const revisionRef = useRef(0);
  const contentRef = useRef<DraftContent>({
    mode: "note", title: "", markdown: "", ...EMPTY_TASK_DRAFT,
  });
  const lastSavedRef = useRef<DraftContent>({
    mode: "note", title: "", markdown: "", ...EMPTY_TASK_DRAFT,
  });
  const saveQueueRef = useRef<Promise<number>>(Promise.resolve(0));
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitInFlightRef = useRef(false);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const committedNoteRef = useRef<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    void client.getQuickDraft().then((draft) => {
      if (cancelled) return;
      const restoredTaskDraft = {
        plannedAt: draft.plannedAt,
        dueAt: draft.dueAt,
        reminderAt: draft.reminderAt,
        recurrence: draft.recurrence,
      };
      const content = { mode: draft.mode, title: draft.title, markdown: draft.markdown, ...restoredTaskDraft };
      revisionRef.current = draft.revision;
      contentRef.current = content;
      lastSavedRef.current = content;
      saveQueueRef.current = Promise.resolve(draft.revision);
      setTitle(content.title);
      setMarkdown(content.markdown);
      setMode(content.mode);
      setTaskDraft(restoredTaskDraft);
      setSaveState("saved");
      setReady(true);
    }).catch((loadError) => {
      if (cancelled) return;
      setError(errorMessage(loadError, "草稿暂时无法读取，请重试。"));
    });

    return () => {
      cancelled = true;
    };
  }, [client, loadAttempt]);

  const persistSnapshot = useCallback((snapshot: DraftContent): Promise<number> => {
    const operation = saveQueueRef.current
      .catch(() => revisionRef.current)
      .then(async () => {
        if (sameContent(snapshot, lastSavedRef.current)) return revisionRef.current;
        setSaveState("saving");
        const saved = await client.saveQuickDraft({
          mode: snapshot.mode,
          title: snapshot.title,
          markdown: snapshot.markdown,
          plannedAt: snapshot.plannedAt,
          dueAt: snapshot.dueAt,
          reminderAt: snapshot.reminderAt,
          recurrence: snapshot.recurrence,
          expectedRevision: revisionRef.current,
        });
        revisionRef.current = saved.revision;
        lastSavedRef.current = snapshot;
        if (sameContent(snapshot, contentRef.current)) {
          setError(null);
          setSaveState("saved");
        }
        return saved.revision;
      })
      .catch((saveError) => {
        setError(errorMessage(saveError, "草稿暂时无法保存，请保留窗口后重试。"));
        setSaveState("error");
        throw saveError;
      });

    saveQueueRef.current = operation.catch(() => revisionRef.current);
    return operation;
  }, [client]);

  useEffect(() => {
    if (!ready) return;
    const snapshot = { mode, title, markdown, ...taskDraft };
    contentRef.current = snapshot;
    if (sameContent(snapshot, lastSavedRef.current)) return;

    setSaveState("dirty");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void persistSnapshot(snapshot).catch(() => undefined);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [debounceMs, markdown, mode, persistSnapshot, ready, taskDraft, title]);

  const updateTitle = (value: string) => {
    contentRef.current = { ...contentRef.current, title: value };
    setTitle(value);
  };

  const updateMarkdown = (value: string) => {
    contentRef.current = { ...contentRef.current, markdown: value };
    setMarkdown(value);
  };

  const updateMode = (value: QuickDraft["mode"]) => {
    contentRef.current = { ...contentRef.current, mode: value };
    setMode(value);
  };

  const updateTaskDraft = (patch: Partial<TaskDraft>) => {
    contentRef.current = { ...contentRef.current, ...patch };
    setTaskDraft((current) => ({ ...current, ...patch }));
  };

  const addPastedImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      pendingAttachmentsRef.current.push({
        kind: "image",
        name: file.name || "粘贴图片.png",
        mimeType: file.type,
        bytes,
      });
      setPendingAttachmentCount(pendingAttachmentsRef.current.length);
      setPendingAttachmentNames(pendingAttachmentsRef.current.map((attachment) => attachment.name));
      setError(null);
    } catch (attachmentError) {
      setError(errorMessage(attachmentError, "图片暂时无法读取，请重试。"));
    }
  }, []);

  const addDroppedFiles = useCallback((files: File[]) => {
    void (async () => {
      try {
        const attachments = files.map((file) => ({ file, path: client.pathForFile(file) }));
        if (attachments.some(({ path }) => !path)) {
          throw new Error("这个文件暂时无法读取，请从资源管理器重新拖入。" );
        }
        pendingAttachmentsRef.current.push(...attachments.map(({ file, path }) => ({
          kind: "file" as const,
          name: file.name || "未命名文件",
          path,
        })));
        setPendingAttachmentCount(pendingAttachmentsRef.current.length);
        setPendingAttachmentNames(pendingAttachmentsRef.current.map((attachment) => attachment.name));
        setError(null);
      } catch (attachmentError) {
        setError(errorMessage(attachmentError, "文件暂时无法添加，请重试。"));
      }
    })();
  }, [client]);

  const commit = useCallback(async () => {
    if (commitInFlightRef.current) return;
    const snapshot = contentRef.current;
    const hasPendingAttachments = pendingAttachmentsRef.current.length > 0;
    if (snapshot.mode === "note" && !hasPendingAttachments && !snapshot.title.trim() && !snapshot.markdown.trim()) {
      setError("请先写下一点内容，再保存便签。");
      return;
    }
    if (snapshot.mode === "task" && !snapshot.title.trim()) {
      setError("请填写待办标题，再创建待办。");
      return;
    }
    commitInFlightRef.current = true;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setCommitting(true);
    setError(null);
    try {
      const snapshotForCommit = snapshot.mode === "note" && !snapshot.title.trim() && !snapshot.markdown.trim()
        ? { ...snapshot, title: pendingAttachmentsRef.current[0]?.name ?? "" }
        : snapshot;
      const revision = committedNoteRef.current ? revisionRef.current : await persistSnapshot(snapshotForCommit);
      const emptyContent = { mode: "note" as const, title: "", markdown: "", ...EMPTY_TASK_DRAFT };
      if (snapshot.mode === "note") {
        let note = committedNoteRef.current ?? await client.commitQuickDraft({ expectedRevision: revision });
        revisionRef.current = 0;
        committedNoteRef.current = note;
        while (pendingAttachmentsRef.current.length > 0) {
          const attachment = pendingAttachmentsRef.current[0];
          note = attachment.kind === "image"
            ? await client.attachImageBytes({
              noteId: note.id,
              expectedRevision: note.revision,
              name: attachment.name,
              mimeType: attachment.mimeType,
              bytes: attachment.bytes,
            })
            : await client.attachDroppedFile({
              noteId: note.id,
              expectedRevision: note.revision,
              path: attachment.path,
            });
          pendingAttachmentsRef.current.shift();
          setPendingAttachmentCount(pendingAttachmentsRef.current.length);
          setPendingAttachmentNames(pendingAttachmentsRef.current.map((item) => item.name));
          committedNoteRef.current = note;
        }
        committedNoteRef.current = null;
      } else {
        await client.createTask({
          title: snapshot.title,
          details: snapshot.markdown,
          ...taskDraft,
        });
        const cleared = await client.saveQuickDraft({
          ...emptyContent,
          expectedRevision: revision,
        });
        revisionRef.current = cleared.revision;
      }
      contentRef.current = emptyContent;
      lastSavedRef.current = emptyContent;
      setTitle("");
      setMarkdown("");
      setMode("note");
      setTaskDraft(EMPTY_TASK_DRAFT);
      setPendingAttachmentCount(0);
      setPendingAttachmentNames([]);
      setEditorVersion((version) => version + 1);
      setSaveState("saved");
      await client.hide();
    } catch (commitError) {
      const fallback = snapshot.mode === "task"
        ? "待办暂时无法创建，请重试。"
        : committedNoteRef.current
          ? "便签已保存，但还有附件未保存；请保持窗口打开后重试。"
          : "便签暂时无法保存，请重试。";
      setError(errorMessage(commitError, fallback));
      setSaveState("error");
    } finally {
      commitInFlightRef.current = false;
      setCommitting(false);
    }
  }, [client, persistSnapshot, taskDraft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void client.hide();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void commit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [client, commit]);

  if (!ready) {
    return (
      <main className="quick-capture quick-capture--centered">
        {error ? (
          <div className="quick-capture__load-error">
            <p role="alert">{error}</p>
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              重试
            </button>
          </div>
        ) : (
          <p className="quick-capture__loading" role="status">正在恢复草稿…</p>
        )}
      </main>
    );
  }

  const statusLabel = saveState === "saving"
    ? "正在自动保存…"
    : saveState === "dirty"
      ? "尚未保存"
      : saveState === "error"
        ? "保存失败"
        : "已自动保存";

  return (
    <main className="quick-capture">
      <header className="quick-capture__header">
        <div className="quick-capture__identity">
          <LeemoMark size={24} label="Leemo 标志" />
          <span className="quick-capture__brand">快速记录</span>
        </div>
        <button
          type="button"
          className="quick-capture__close"
          aria-label="关闭快捷便签"
          onClick={() => void client.hide()}
        >
          <X size={19} strokeWidth={1.55} aria-hidden />
        </button>
      </header>

      <nav className="quick-capture__mode-bar" aria-label="记录类型">
        <div className="quick-capture__modes">
          <button
            type="button"
            className={`quick-capture__mode${mode === "note" ? " quick-capture__mode--active" : ""}`}
            onClick={() => updateMode("note")}
          >
            便签
          </button>
          <button
            type="button"
            className={`quick-capture__mode${mode === "task" ? " quick-capture__mode--active" : ""}`}
            onClick={() => updateMode("task")}
          >
            待办
          </button>
        </div>
      </nav>

      <section className="quick-capture__document" aria-label={mode === "task" ? "快捷待办" : "快捷便签"}>
        <input
          className="quick-capture__title"
          aria-label={mode === "task" ? "待办标题" : "便签标题"}
          placeholder={mode === "task" ? "待办标题" : "标题（可选）"}
          value={title}
          disabled={committing}
          onChange={(event) => updateTitle(event.currentTarget.value)}
        />
        {mode === "note" && pendingAttachmentNames.length > 0 ? (
          <div className="quick-capture__attachments" aria-label="待保存附件">
            {pendingAttachmentNames.map((name, index) => (
              <span className="quick-capture__attachment" key={`${name}-${index}`}>
                <FileText size={15} strokeWidth={1.7} aria-hidden />
                <span>{name}</span>
                <small>待保存</small>
              </span>
            ))}
          </div>
        ) : null}
        {mode === "note" ? (
          <CaptureEditor
            key={editorVersion}
            markdown={markdown}
            onMarkdownChange={updateMarkdown}
            onSave={() => void commit()}
            onPasteImage={(file) => void addPastedImage(file)}
            onDropFiles={addDroppedFiles}
            autoFocus
            disabled={committing}
          />
        ) : (
          <div className="quick-capture__task-fields">
            <textarea
              aria-label="待办说明"
              placeholder="说明（可选）"
              value={markdown}
              disabled={committing}
              onChange={(event) => updateMarkdown(event.currentTarget.value)}
            />
            <div className="quick-capture__task-details">
              <label><span>计划</span><input aria-label="计划时间" type="datetime-local" value={dateTimeInput(taskDraft.plannedAt)} disabled={committing} onChange={(event) => updateTaskDraft({ plannedAt: inputTimestamp(event.currentTarget.value) })} /></label>
              <label><span>截止</span><input aria-label="截止时间" type="datetime-local" value={dateTimeInput(taskDraft.dueAt)} disabled={committing} onChange={(event) => updateTaskDraft({ dueAt: inputTimestamp(event.currentTarget.value) })} /></label>
              <label><span>提醒</span><input aria-label="提醒时间" type="datetime-local" value={dateTimeInput(taskDraft.reminderAt)} disabled={committing} onChange={(event) => updateTaskDraft({ reminderAt: inputTimestamp(event.currentTarget.value) })} /></label>
              <label><span>重复</span><select aria-label="重复" value={taskDraft.recurrence ?? ""} disabled={committing} onChange={(event) => updateTaskDraft({ recurrence: event.currentTarget.value as UserTask["recurrence"] })}><option value="">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
            </div>
          </div>
        )}
      </section>

      <footer className="quick-capture__footer">
        <div className="quick-capture__feedback">
          {error ? <span role="alert">{error}{pendingAttachmentCount > 0 ? `（已添加 ${pendingAttachmentCount} 个附件，仍待保存）` : ""}</span> : pendingAttachmentCount > 0 ? <span role="status">已添加 {pendingAttachmentCount} 个附件</span> : <span role="status">{statusLabel}</span>}
        </div>
        <div className="quick-capture__actions">
          <span className="quick-capture__shortcut">Ctrl+S 收下 <span aria-hidden>·</span> Esc 稍后继续</span>
          <button
            type="button"
            className="quick-capture__save"
            disabled={committing}
            onClick={() => void commit()}
          >
            {committing ? "保存中…" : mode === "task" ? "创建待办" : "收下"}
          </button>
        </div>
      </footer>
    </main>
  );
}
