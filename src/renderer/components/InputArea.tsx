import { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  LoaderCircle,
  Paperclip,
  Square,
  Wrench,
  X,
} from "lucide-react";
import SlashMenu from "./SlashMenu";
import FileMentionMenu from "./FileMentionMenu";
import {
  parseSlashQuery,
  filterSkillsByQuery,
  moveSelection,
  applySlashPick,
} from "./slash-menu";
import type { AttachmentRef, PermissionMode, ProviderSpec, SkillInfo } from "../../bridge/contract";
import type { WorkspaceFileNode } from "../workspace/client";
import type { PendingSendDraft } from "../stores/conversations";
import {
  EMPTY_COMPOSER_DRAFT,
  type ComposerAttachment,
  type ComposerDraft,
} from "../stores/composer-drafts";
import { buildModelGroups, modelPickerLabel, isCurrentModel } from "./model-picker";
import {
  applyFileMentionPick,
  filterWorkspaceFiles,
  parseFileMention,
} from "./file-mention";

export type Attachment = ComposerAttachment;

function usedAttachmentSlots(draft: ComposerDraft): number {
  return draft.attachments.length
    + (draft.workspaceFiles?.length ?? 0)
    + draft.pendingStageCount;
}

export interface InputAreaProps {
  conversationId: string | null;
  value: string;
  onChange: (v: string) => void;
  onSend: (
    text: string,
    attachments?: AttachmentRef[],
    workspaceFiles?: import("../../bridge/contract").WorkspaceFileRef[],
  ) => void | Promise<void>;
  /** Memory-only copy retained after the host accepted a turn but the run later
   * failed. The shell owns the store actions; InputArea only renders them. */
  retryDraft?: PendingSendDraft | null;
  onRetry?: () => void | Promise<void>;
  onDismissRetry?: () => void;
  busy?: boolean;
  onStop?: () => void;
  /** ENABLED skills, for the `/` menu. Passed in rather than pulled from the
   *  store so this component stays usable (and testable) without a
   *  BridgeProvider — both shells own the store subscription instead. */
  skills?: SkillInfo[];
  /** Real, current workspace tree used by the inline @ file picker. Paths stay
   * relative; host resolves them only when this conversation sends. */
  workspaceFiles?: WorkspaceFileNode[];
  workspaceId?: string;
  /** Provider catalog (轮 3 卡 F). Same props-not-store discipline as `skills`.
   *  The picker filters to `configured === true` itself, so a caller may pass the
   *  whole list without leaking unconfigured families into the menu. */
  providers?: ProviderSpec[];
  /** The conversation's current pairing, for the trigger label + checkmark. */
  currentProviderId?: string | null;
  currentModelId?: string | null;
  /** The live permission policy applied to this and all active conversations. */
  permissionMode?: PermissionMode;
  /** Chosen provider instance + model → caller persists the pair. */
  onSelectModel?: (providerId: string, modelId: string) => void;
  /** Navigate to the settings page — the empty-state escape hatch when nothing
   *  is configured yet. Omitted in contexts with no router (tests, fixtures). */
  onOpenSettings?: () => void;
  /** Permission status is independently actionable from the model picker. */
  onOpenPermissionSettings?: () => void;
  /** Full access is deliberately easy to leave from either shell. */
  onDisableFullAccess?: () => void;
  /** Electron-only capability backed by webUtils.getPathForFile. Without it the
   * attachment button is disabled so browser fixtures never pretend a selected
   * file can reach Claude Code. */
  resolveFilePath?: (file: File) => string;
  /** Persists the current clipboard bitmap to a temporary local file so the
   * host receives the same verifiable path shape as a picked attachment. */
  stageClipboardImage?: () => Promise<AttachmentRef | null>;
  /** Releases a screenshot staged by `stageClipboardImage`. Normal selected
   * files never use this path and are never deleted by Leemo. */
  releaseClipboardImage?: (path: string) => Promise<void>;
  /** Production shells keep this state in one shared store so changing modes
   * or workspaces never drops an unfinished turn. Omitted by isolated fixtures,
   * which use the component's local fallback. */
  draftScope?: string;
  draftState?: ComposerDraft;
  onDraftStateChange?: (update: (draft: ComposerDraft) => ComposerDraft) => void;
}

export default function InputArea({
  conversationId,
  value,
  onChange,
  onSend,
  retryDraft = null,
  onRetry,
  onDismissRetry,
  busy = false,
  onStop,
  skills = [],
  workspaceFiles = [],
  workspaceId,
  providers = [],
  currentProviderId = null,
  currentModelId = null,
  permissionMode = "acceptEdits",
  onSelectModel,
  onOpenSettings,
  onOpenPermissionSettings,
  onDisableFullAccess,
  resolveFilePath,
  stageClipboardImage,
  releaseClipboardImage,
  draftScope,
  draftState,
  onDraftStateChange,
}: InputAreaProps) {
  const [composing, setComposing] = useState(false);
  const [draftsByConversation, setDraftsByConversation] = useState<Record<string, ComposerDraft>>({});
  const [fileDragActive, setFileDragActive] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caretPosition, setCaretPosition] = useState(value.length);
  /** The query Escape dismissed. Keyed by query text, not a boolean, so Escape
   *  hides THIS list while typing another character brings the menu back. */
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const submitInFlightRef = useRef(false);
  const conversationKey = draftScope ?? conversationId ?? "__new__";
  const composerDraft = draftState ?? draftsByConversation[conversationKey] ?? EMPTY_COMPOSER_DRAFT;
  const { attachments, submitPending, retryPending, submitError } = composerDraft;
  const referencedWorkspaceFiles = composerDraft.workspaceFiles ?? [];
  const attachmentPending = composerDraft.pendingStageCount > 0;
  const updateComposerDraft = (
    targetKey: string,
    update: (current: ComposerDraft) => ComposerDraft,
  ) => {
    if (draftState !== undefined && onDraftStateChange) {
      onDraftStateChange(update);
      return;
    }
    setDraftsByConversation((current) => ({
      ...current,
      [targetKey]: update(current[targetKey] ?? EMPTY_COMPOSER_DRAFT),
    }));
  };
  const patchComposerDraft = (targetKey: string, patch: Partial<ComposerDraft>) => {
    updateComposerDraft(targetKey, (current) => ({ ...current, ...patch }));
  };

  // Only configured providers contribute models (用户 7/26: unconfigured families
  // must not clutter the picker).
  const modelGroups = buildModelGroups(providers);
  const currentModel = modelGroups
    .flatMap((group) => group.options)
    .find((option) => isCurrentModel(option, currentProviderId, currentModelId));
  const hasImageAttachment = attachments.some((attachment) =>
    attachment.mimeType?.toLowerCase().startsWith("image/")
      || /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i.test(attachment.name),
  );
  const imageCapabilityNotice = !hasImageAttachment
    || (currentModel?.imageStatus === "verified")
      ? null
      : currentModel?.imageStatus === "failed" && currentModel.imageSource === "probe"
        ? "本次检测未通过，模型仍可能支持图片。"
        : "尚未确认当前模型的图片能力，仍可直接发送。";
  const retryFiles = retryDraft
    ? [...retryDraft.attachments, ...(retryDraft.workspaceFiles ?? [])]
    : [];
  const retryAttachmentSummary = retryFiles.length > 0
    ? `${retryFiles.slice(0, 2).map((attachment) => attachment.name).join("、")}${
        retryFiles.length > 2 ? `，另有 ${retryFiles.length - 2} 个` : ""
      }`
    : null;

  const slashQuery = parseSlashQuery(value);
  const slashMatches = slashQuery === null ? [] : filterSkillsByQuery(skills, slashQuery);
  // An empty result set means no menu at all — a floating empty box is noise.
  const slashOpen =
    slashQuery !== null && slashMatches.length > 0 && slashDismissed !== slashQuery;
  const fileMention = parseFileMention(value, caretPosition);
  const mentionMatches = fileMention ? filterWorkspaceFiles(workspaceFiles, fileMention.query) : [];
  const mentionKey = fileMention ? `${fileMention.start}:${fileMention.end}:${fileMention.query}` : null;
  const mentionOpen = Boolean(workspaceId)
    && fileMention !== null
    && mentionMatches.length > 0
    && mentionDismissed !== mentionKey;
  const permissionLabel: Record<PermissionMode, string> = {
    default: "每次确认",
    acceptEdits: "任务中少打扰",
    plan: "只规划",
    bypassPermissions: "完全访问",
  };
  const canDisableFullAccess = permissionMode === "bypassPermissions" && onDisableFullAccess !== undefined;

  const submit = async () => {
    const t = value.trim();
    if (
      (!t && attachments.length === 0 && referencedWorkspaceFiles.length === 0)
      || busy
      || submitPending
      || submitInFlightRef.current
      || attachmentPending
    ) return;
    const targetKey = conversationKey;
    const submittedText = value;
    const submittedAttachmentIds = new Set(attachments.map((attachment) => attachment.id));
    const submittedWorkspaceFileIds = new Set(referencedWorkspaceFiles.map((file) => file.id));
    submitInFlightRef.current = true;
    patchComposerDraft(targetKey, { submitPending: true, submitError: null });
    try {
      const outgoingAttachments = attachments.length > 0
        ? attachments.map(({ name, path, size, mimeType }) => ({ name, path, size, mimeType }))
        : undefined;
      const outgoingWorkspaceFiles = referencedWorkspaceFiles.length > 0
        ? referencedWorkspaceFiles.map(({ name, workspaceId: fileWorkspaceId, workspacePath }) => ({
            name,
            workspaceId: fileWorkspaceId,
            workspacePath,
          }))
        : undefined;
      if (outgoingWorkspaceFiles) await onSend(t, outgoingAttachments, outgoingWorkspaceFiles);
      else await onSend(t, outgoingAttachments);
      updateComposerDraft(targetKey, (current) => {
        const text = current.text === submittedText ? "" : current.text;
        const remainingAttachments = current.attachments.filter(
          (attachment) => !submittedAttachmentIds.has(attachment.id),
        );
        const remainingWorkspaceFiles = (current.workspaceFiles ?? []).filter(
          (file) => !submittedWorkspaceFileIds.has(file.id),
        );
        const hasRemainingDraft = text.length > 0
          || remainingAttachments.length > 0
          || remainingWorkspaceFiles.length > 0
          || current.pendingStageCount > 0;
        return {
          ...current,
          text,
          attachments: remainingAttachments,
          workspaceFiles: remainingWorkspaceFiles,
          assignedConversationId: hasRemainingDraft ? current.assignedConversationId : null,
        };
      });
      // Production shells keep text inside the same atomic ComposerDraft
      // update above. The callback is only needed by isolated controlled-text
      // fixtures; calling both would reopen a tiny cross-render lost-update
      // window if another store mutation landed in the same microtask.
      if (
        (draftState === undefined || !onDraftStateChange)
        && valueRef.current === submittedText
      ) onChange("");
    } catch (error) {
      patchComposerDraft(targetKey, {
        submitError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      submitInFlightRef.current = false;
      patchComposerDraft(targetKey, { submitPending: false });
    }
  };

  const retryFailedSend = async () => {
    if (!onRetry || retryPending || busy) return;
    const targetKey = conversationKey;
    patchComposerDraft(targetKey, { retryPending: true, submitError: null });
    try {
      await onRetry();
    } catch (error) {
      patchComposerDraft(targetKey, {
        submitError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      patchComposerDraft(targetKey, { retryPending: false });
    }
  };

  const pickSkill = (skill: SkillInfo) => {
    if (submitPending) return;
    // Bare name only (卡 E §二): `/pdf `, never `/leemo:pdf `.
    onChange(applySlashPick(skill));
    setSlashIndex(0);
    textareaRef.current?.focus();
  };

  const pickWorkspaceFile = (file: WorkspaceFileNode) => {
    if (submitPending || !fileMention) return;
    const picked = applyFileMentionPick(value, fileMention);
    const targetKey = conversationKey;
    updateComposerDraft(targetKey, (current) => {
      const existing = current.workspaceFiles ?? [];
      const duplicate = existing.some((entry) => entry.workspacePath === file.path);
      const atLimit = usedAttachmentSlots(current) >= 20;
      return {
        ...current,
        text: picked.value,
        workspaceFiles: duplicate || atLimit
          ? existing
          : [...existing, {
              id: `${Date.now()}-${Math.random()}`,
              name: file.name,
              workspaceId: workspaceId!,
              workspacePath: file.path,
            }],
        submitError: atLimit && !duplicate ? "一次最多添加 20 个附件。" : null,
      };
    });
    if (draftState === undefined || !onDraftStateChange) onChange(picked.value);
    setMentionDismissed(mentionKey);
    setMentionIndex(0);
    setCaretPosition(picked.caret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(picked.caret, picked.caret);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((index) => moveSelection(
          index,
          e.key === "ArrowDown" ? 1 : -1,
          mentionMatches.length,
        ));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !composing) {
        e.preventDefault();
        const picked = mentionMatches[mentionIndex] ?? mentionMatches[0];
        if (picked) pickWorkspaceFile(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(mentionKey);
        return;
      }
    }
    // The open menu owns ↑↓/Enter/Escape; without this Enter would send a bare
    // "/pd" instead of completing the command the user is clearly typing.
    if (slashOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => moveSelection(i, e.key === "ArrowDown" ? 1 : -1, slashMatches.length));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !composing) {
        e.preventDefault();
        const picked = slashMatches[slashIndex] ?? slashMatches[0];
        if (picked) pickSkill(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(slashQuery);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !composing && !busy) {
      e.preventDefault();
      void submit();
    }
  };

  const addLocalFiles = (files: FileList | readonly File[]): boolean => {
    const list = Array.from(files);
    if (list.length === 0 || !resolveFilePath || submitPending) return false;
    const candidates: Attachment[] = [];
    for (const file of list) {
      const filePath = resolveFilePath(file);
      if (!filePath) continue;
      candidates.push({
        id: `${Date.now()}-${Math.random()}`,
        name: file.name,
        path: filePath,
        size: file.size,
        ...(file.type ? { mimeType: file.type } : {}),
      });
    }
    const targetKey = conversationKey;
    updateComposerDraft(targetKey, (current) => {
      // In-flight clipboard images already own a future slot. Counting the
      // reservation here prevents a picker/drop from silently taking it while
      // the main process is still writing the PNG.
      const remaining = Math.max(0, 20 - usedAttachmentSlots(current));
      const accepted = candidates.slice(0, remaining);
      const submitError = candidates.length === 0
        ? "没有取得文件路径，请从本机重新选择附件。"
        : candidates.length > remaining
          ? "一次最多添加 20 个附件。"
          : null;
      return {
        ...current,
        attachments: [...current.attachments, ...accepted],
        submitError,
      };
    });
    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addLocalFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isFileTransfer = (transfer: DataTransfer): boolean =>
    Array.from(transfer.types ?? []).includes("Files") || transfer.files.length > 0;

  const handleFileDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if (!resolveFilePath || !isFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    if (submitPending) {
      setFileDragActive(false);
      return;
    }
    e.dataTransfer.dropEffect = "copy";
    setFileDragActive(true);
  };

  const handleFileDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!resolveFilePath || !isFileTransfer(e.dataTransfer)) return;
    e.stopPropagation();
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFileDragActive(false);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!resolveFilePath || !isFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragActive(false);
    if (submitPending) return;
    addLocalFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (submitPending) return;
    const imageFiles = Array.from(e.clipboardData.files).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    e.preventDefault();
    if (resolveFilePath) {
      const localImages = imageFiles.filter((file) => Boolean(resolveFilePath(file)));
      if (localImages.length > 0) {
        addLocalFiles(localImages);
        return;
      }
    }
    if (!stageClipboardImage) {
      patchComposerDraft(conversationKey, {
        submitError: "暂时无法读取剪贴板图片，请使用附件按钮选择图片。",
      });
      return;
    }
    if (usedAttachmentSlots(composerDraft) >= 20) {
      patchComposerDraft(conversationKey, { submitError: "一次最多添加 20 个附件。" });
      return;
    }
    const targetKey = conversationKey;
    updateComposerDraft(targetKey, (current) => ({
      ...current,
      pendingStageCount: current.pendingStageCount + 1,
      submitError: null,
    }));
    void stageClipboardImage()
      .then((attachment) => {
        if (!attachment) throw new Error("剪贴板里没有可用的图片。");
        updateComposerDraft(targetKey, (current) => {
          if (usedAttachmentSlots(current) > 20) {
            // A shared-draft mutation outside this component may still consume
            // the reserved slot. The file already exists at this point, so
            // reject it visibly and return ownership to the main process.
            if (releaseClipboardImage) {
              void releaseClipboardImage(attachment.path).catch(() => {});
            }
            return { ...current, submitError: "一次最多添加 20 个附件。" };
          }
          return {
            ...current,
            attachments: [
              ...current.attachments,
              { ...attachment, id: `${Date.now()}-${Math.random()}`, temporary: true },
            ],
          };
        });
      })
      .catch((error: unknown) => {
        patchComposerDraft(targetKey, {
          submitError: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        updateComposerDraft(targetKey, (current) => ({
          ...current,
          pendingStageCount: Math.max(0, current.pendingStageCount - 1),
        }));
      });
  };

  const removeAttachment = (id: string) => {
    if (submitPending) return;
    updateComposerDraft(conversationKey, (current) => {
      const removed = current.attachments.find((attachment) => attachment.id === id);
      if (removed?.temporary && releaseClipboardImage) {
        void releaseClipboardImage(removed.path).catch(() => {});
      }
      return {
        ...current,
        attachments: current.attachments.filter((attachment) => attachment.id !== id),
      };
    });
  };

  const removeWorkspaceFile = (id: string) => {
    if (submitPending) return;
    updateComposerDraft(conversationKey, (current) => ({
      ...current,
      workspaceFiles: (current.workspaceFiles ?? []).filter((file) => file.id !== id),
    }));
  };

  /** The toolbar `/` is now a shortcut for typing one: the menu is driven by the
   *  draft text, so seeding "/" opens it through the same path as the keyboard. */
  const handleSkillClick = () => {
    if (submitPending) return;
    setModelPickerOpen(false);
    setSlashDismissed(null);
    setSlashIndex(0);
    if (parseSlashQuery(value) === null) onChange("/");
    textareaRef.current?.focus();
  };

  const handleAttachmentClick = () => {
    if (resolveFilePath && !submitPending) fileInputRef.current?.click();
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, 144);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div
      className="bg-transparent px-8 pb-3 pt-2.5 max-[900px]:px-4"
      onDragEnter={handleFileDrag}
      onDragOver={handleFileDrag}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {retryDraft?.errorMessage && (
        <div
          role="alert"
          className="mb-2 rounded-[8px] border border-[var(--leemo-danger-line)] bg-[var(--leemo-danger-soft)] px-3 py-2 text-xs text-[var(--leemo-ink-2)]"
        >
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-danger)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-[var(--leemo-ink)]">任务没有完成</span>
                <span className="break-words text-[var(--leemo-ink-2)]">{retryDraft.errorMessage}</span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[var(--leemo-ink-3)]">
                <span className="shrink-0">原消息和附件已保留</span>
                {retryAttachmentSummary && (
                  <span
                    className="min-w-0 truncate"
                    title={retryFiles.map((attachment) => attachment.name).join("、")}
                  >
                    &nbsp;· {retryAttachmentSummary}
                  </span>
                )}
                <button
                  type="button"
                  disabled={retryPending || busy}
                  className="font-medium text-[var(--leemo-danger)] hover:underline disabled:cursor-wait disabled:opacity-50"
                  onClick={() => void retryFailedSend()}
                >
                  仍用当前模型重试
                </button>
                <button
                  type="button"
                  className="font-medium text-[var(--leemo-ink-2)] hover:underline"
                  onClick={() => {
                    setSlashDismissed(null);
                    setModelPickerOpen(true);
                  }}
                >
                  选择其他模型
                </button>
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭重试提示"
              title="关闭"
              className="shrink-0 rounded p-1 text-[var(--leemo-ink-3)] hover:bg-red-100 hover:text-[var(--leemo-ink)]"
              onClick={onDismissRetry}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {(attachments.length > 0 || referencedWorkspaceFiles.length > 0 || attachmentPending) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 text-[var(--leemo-ink-3)]" aria-hidden />
              <span className="text-[var(--leemo-ink-2)]">{att.name}</span>
              <span className="text-[var(--leemo-ink-4)]">{formatFileSize(att.size)}</span>
              <button
                onClick={() => removeAttachment(att.id)}
                disabled={submitPending}
                className="ml-1 text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink)]"
                aria-label="移除附件"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          {referencedWorkspaceFiles.map((file) => (
            <div
              key={file.id}
              title={file.workspacePath}
              className="flex items-center gap-2 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 text-[var(--leemo-amber-strong)]" aria-hidden />
              <span className="max-w-[220px] truncate text-[var(--leemo-ink-2)]">{file.name}</span>
              <span className="text-[10.5px] text-[var(--leemo-ink-4)]">工作区</span>
              <button
                type="button"
                onClick={() => removeWorkspaceFile(file.id)}
                disabled={submitPending}
                className="ml-1 text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink)]"
                aria-label={`移除引用 ${file.name}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          {attachmentPending && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-1.5 text-sm text-[var(--leemo-ink-3)]"
            >
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              <span>正在添加图片…</span>
            </div>
          )}
        </div>
      )}

      {imageCapabilityNotice && (
        <div
          role="status"
          className="mb-2 flex items-center gap-1.5 px-1 text-xs text-[var(--leemo-ink-3)]"
        >
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{imageCapabilityNotice}</span>
        </div>
      )}

      <div
        className="leemo-input-shadow relative rounded-[10px] border border-[var(--leemo-line)] bg-white transition-all duration-200 focus-within:border-[var(--leemo-amber)] focus-within:ring-4 focus-within:ring-[var(--leemo-amber-soft)]/50"
        data-file-drop-active={fileDragActive ? "true" : "false"}
      >
        {fileDragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[9px] border-2 border-dashed border-[var(--leemo-amber)] bg-[var(--leemo-amber-bg)]/95 text-sm font-medium text-[var(--leemo-amber-strong)]">
            <span className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" aria-hidden />
              松开作为本轮附件
            </span>
          </div>
        )}
        {slashOpen && (
          <SlashMenu
            skills={slashMatches}
            selectedIndex={Math.min(slashIndex, slashMatches.length - 1)}
            onPick={pickSkill}
            onHover={setSlashIndex}
          />
        )}
        {mentionOpen && (
          <FileMentionMenu
            files={mentionMatches}
            selectedIndex={Math.min(mentionIndex, mentionMatches.length - 1)}
            onPick={pickWorkspaceFile}
            onHover={setMentionIndex}
          />
        )}

        <textarea
          ref={textareaRef}
          aria-label="输入消息"
          placeholder="输入消息…"
          value={value}
          disabled={submitPending}
          onChange={(e) => {
            setCaretPosition(e.target.selectionStart);
            setMentionDismissed(null);
            setMentionIndex(0);
            onChange(e.target.value);
          }}
          onClick={(e) => setCaretPosition(e.currentTarget.selectionStart)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="w-full resize-none bg-transparent px-4 py-3 text-[15px] text-[var(--leemo-ink)] caret-[var(--leemo-amber)] outline-none placeholder:text-[var(--leemo-ink-3)] disabled:cursor-wait"
          rows={1}
          style={{ minHeight: "48px", maxHeight: "144px" }}
        />

        <div className="flex items-center gap-1 px-2.5 pb-1.5">
          <button
            type="button"
            onClick={handleSkillClick}
            disabled={submitPending}
            className="rounded p-1.5 hover:bg-[var(--leemo-hover)] disabled:cursor-wait disabled:opacity-35 disabled:hover:bg-transparent"
            title="/ 技能"
            aria-label="/ 技能"
          >
            <Wrench className="h-4 w-4 text-[var(--leemo-ink-3)]" aria-hidden />
          </button>

          <button
            type="button"
            onClick={handleAttachmentClick}
            disabled={!resolveFilePath || submitPending}
            className="rounded p-1.5 hover:bg-[var(--leemo-hover)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
            title={resolveFilePath ? "附件" : "附件仅在桌面版可用"}
            aria-label="附件"
          >
            <Paperclip className="h-4 w-4 text-[var(--leemo-ink-3)]" aria-hidden />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={submitPending}
            onChange={handleFileSelect}
            className="hidden"
          />

          <span className="text-[10.5px] text-[var(--leemo-ink-4)] max-[900px]:hidden">
            Enter 发送 · Shift+Enter 换行
          </span>

          {busy ? (
            <button
              type="button"
              aria-label="停止"
              onClick={() => onStop?.()}
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--leemo-ink)] text-white shadow-sm transition-colors hover:bg-black"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送"
              onClick={() => void submit()}
              disabled={submitPending || attachmentPending || (!value.trim() && attachments.length === 0 && referencedWorkspaceFiles.length === 0)}
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--leemo-amber)] text-white shadow-sm transition-colors hover:bg-[var(--leemo-amber-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="h-[15px] w-[15px]" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {submitError && (
        <div role="alert" className="mt-1.5 px-2 text-xs text-red-600">
          {submitError}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1 px-1 text-xs text-[var(--leemo-ink-3)]">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-1 hover:bg-[var(--leemo-hover)]"
          aria-label="切换模型"
          title={`当前模型：${modelPickerLabel(currentModelId)}`}
          onClick={() => setModelPickerOpen(!modelPickerOpen)}
        >
          <Brain className="h-3.5 w-3.5" aria-hidden />
          <span>{modelPickerLabel(currentModelId)}</span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
        <span aria-hidden>·</span>
        <button
          type="button"
          aria-label={canDisableFullAccess ? "关闭完全访问" : `权限模式：${permissionLabel[permissionMode]}`}
          title={canDisableFullAccess ? "关闭完全访问" : "打开权限设置"}
          onClick={canDisableFullAccess ? onDisableFullAccess : onOpenPermissionSettings}
          className={`rounded px-1 py-1 hover:bg-[var(--leemo-hover)] ${
            permissionMode === "bypassPermissions"
              ? "text-[var(--leemo-danger)]"
              : permissionMode === "plan"
                ? "text-[var(--leemo-amber-strong)]"
                : ""
          }`}
        >
          {canDisableFullAccess ? "完全访问 · 关闭" : permissionLabel[permissionMode]}
        </button>
      </div>

      {modelPickerOpen && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--leemo-line)] bg-white p-2 shadow-lg">
          {modelGroups.length === 0 ? (
            /* No configured provider yet. An empty box would read as a bug, so
               point at the one place that fixes it. */
            <div className="p-2">
              <div className="text-xs text-[var(--leemo-ink-2)]">还没有可用的模型</div>
              <div className="mt-1 text-xs text-[var(--leemo-ink-3)]">
                去设置页接入一个云端或本地模型服务，模型会出现在这里。
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  className="mt-2 rounded border border-[var(--leemo-line)] px-2 py-1 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-hover)]"
                  onClick={() => {
                    setModelPickerOpen(false);
                    onOpenSettings();
                  }}
                >
                  去设置页配置模型
                </button>
              )}
            </div>
          ) : (
            modelGroups.map((group) => (
              <div key={group.providerId} className="mb-1 last:mb-0">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--leemo-ink-3)]">
                  {group.providerName}
                </div>
                {group.options.map((option) => {
                  const current = isCurrentModel(option, currentProviderId, currentModelId);
                  return (
                    <button
                      key={`${option.providerId}::${option.modelId}`}
                      type="button"
                      aria-current={current ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--leemo-hover)] ${
                        current ? "bg-[var(--leemo-hover)]" : ""
                      }`}
                      onClick={() => {
                        setModelPickerOpen(false);
                        onSelectModel?.(option.providerId, option.modelId);
                      }}
                    >
                      <span className="grid w-3 shrink-0 place-items-center text-[var(--leemo-accent)]">
                        {current && <Check className="h-3.5 w-3.5" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink)]">
                        {option.modelId}
                      </span>
                      {option.reasoningStatus === "verified" && (
                        <span className="shrink-0 rounded bg-[var(--leemo-hover)] px-1 text-[10px] text-[var(--leemo-ink-3)]">
                          思考
                        </span>
                      )}
                      {option.imageStatus === "verified" && (
                        <span className="shrink-0 rounded bg-[var(--leemo-hover)] px-1 text-[10px] text-[var(--leemo-ink-3)]">
                          识图
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
