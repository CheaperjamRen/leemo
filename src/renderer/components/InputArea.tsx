import { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CornerUpRight,
  FileText,
  LoaderCircle,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Square,
  Trash2,
  Target,
  UsersRound,
  X,
} from "lucide-react";
import SlashMenu from "./SlashMenu";
import FileMentionMenu from "./FileMentionMenu";
import ComposerPlusMenu from "./ComposerPlusMenu";
import {
  parseSlashQuery,
  filterSkillsByQuery,
  moveSelection,
  applySlashPick,
} from "./slash-menu";
import type { AttachmentRef, GuideResponse, PermissionMode, ProviderSpec, SkillInfo } from "../../bridge/contract";
import type { WorkspaceFileNode } from "../workspace/client";
import type { ConversationGoal, ConversationTurnOptions, PendingSendDraft, QueuedTurn } from "../stores/conversations";
import type { ConversationContextUsage } from "../stores/context-usage";
import type { Note } from "../../captures";
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
import ContextUsageIndicator, {
  effectiveContextCapacity,
  formatContextTokens,
} from "./ContextUsageIndicator";
import { WORKSPACE_FILE_DRAG_TYPE } from "./workspace-file-drag";

export type Attachment = ComposerAttachment;

export { WORKSPACE_FILE_DRAG_TYPE } from "./workspace-file-drag";

function usedAttachmentSlots(draft: ComposerDraft): number {
  return draft.attachments.length
    + (draft.workspaceFiles?.length ?? 0)
    + draft.pendingStageCount;
}

interface NoteMention {
  start: number;
  end: number;
  query: string;
}

function parseNoteMention(value: string, caret: number): NoteMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCaret);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

function noteLabel(note: Note): string {
  return note.title.trim() || note.markdown.split("\n").find((line) => line.trim())?.trim() || "未命名便签";
}

function formatGoalElapsed(createdAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - createdAt) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export interface InputAreaProps {
  surface?: "workbench" | "buddy";
  conversationId: string | null;
  value: string;
  onChange: (v: string) => void;
  onSend: (
    text: string,
    attachments?: AttachmentRef[],
    workspaceFiles?: import("../../bridge/contract").WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => void | Promise<void>;
  onQueue?: (
    text: string,
    attachments?: AttachmentRef[],
    workspaceFiles?: import("../../bridge/contract").WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => void | Promise<void>;
  onGuide?: (text: string) => Promise<GuideResponse>;
  queuedTurns?: QueuedTurn[];
  onEditQueuedTurn?: (queuedTurnId: string) => void;
  onDeleteQueuedTurn?: (queuedTurnId: string) => void;
  onGuideQueuedTurn?: (queuedTurnId: string) => Promise<GuideResponse>;
  goal?: ConversationGoal;
  onSaveGoal?: (text: string) => void | Promise<void>;
  onToggleGoalPaused?: () => void | Promise<void>;
  onDeleteGoal?: () => void | Promise<void>;
  /** Memory-only copy retained after the host accepted a turn but the run later
   * failed. The shell owns the store actions; InputArea only renders them. */
  retryDraft?: PendingSendDraft | null;
  /** The active timeline already owns recovery for this exact failed run.
   * Keep the retry draft alive, but do not repeat its recovery UI above the composer. */
  retryRecoveryRendered?: boolean;
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
  /** Global notes already loaded by the shell's capture store. */
  notes?: Note[];
  /** Provider catalog (轮 3 卡 F). Same props-not-store discipline as `skills`.
   *  The picker filters to `configured === true` itself, so a caller may pass the
   *  whole list without leaking unconfigured families into the menu. */
  providers?: ProviderSpec[];
  /** The conversation's current pairing, for the trigger label + checkmark. */
  currentProviderId?: string | null;
  currentModelId?: string | null;
  /** Real main-loop prompt size for this conversation. */
  contextUsage?: ConversationContextUsage;
  /** The live permission policy applied to this and all active conversations. */
  permissionMode?: PermissionMode;
  /** Chosen provider instance + model → caller persists the pair. */
  onSelectModel?: (providerId: string, modelId: string) => void;
  /** Navigate to the settings page — the empty-state escape hatch when nothing
   *  is configured yet. Omitted in contexts with no router (tests, fixtures). */
  onOpenSettings?: () => void;
  /** Permission status is independently actionable from the model picker. */
  onOpenPermissionSettings?: () => void;
  /** Switch the live permission policy without leaving the conversation. */
  onSelectPermissionMode?: (mode: PermissionMode) => void;
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
  surface = "workbench",
  conversationId,
  value,
  onChange,
  onSend,
  onQueue,
  onGuide,
  queuedTurns = [],
  onEditQueuedTurn,
  onDeleteQueuedTurn,
  onGuideQueuedTurn,
  goal,
  onSaveGoal,
  onToggleGoalPaused,
  onDeleteGoal,
  retryDraft = null,
  retryRecoveryRendered = false,
  onRetry,
  onDismissRetry,
  busy = false,
  onStop,
  skills = [],
  workspaceFiles = [],
  workspaceId,
  notes = [],
  providers = [],
  currentProviderId = null,
  currentModelId = null,
  contextUsage,
  permissionMode = "acceptEdits",
  onSelectModel,
  onOpenSettings,
  onOpenPermissionSettings,
  onSelectPermissionMode,
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
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [slashEmptyOpen, setSlashEmptyOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [noteMentionIndex, setNoteMentionIndex] = useState(0);
  const [noteReferenceIds, setNoteReferenceIds] = useState<string[]>([]);
  const [queuedListExpanded, setQueuedListExpanded] = useState(false);
  const [guidancePending, setGuidancePending] = useState(false);
  const [guidanceNotice, setGuidanceNotice] = useState<string | null>(null);
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [goalDraftText, setGoalDraftText] = useState("");
  const [goalExpanded, setGoalExpanded] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalClock, setGoalClock] = useState(() => Date.now());
  const [caretPosition, setCaretPosition] = useState(value.length);
  /** The query Escape dismissed. Keyed by query text, not a boolean, so Escape
   *  hides THIS list while typing another character brings the menu back. */
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const [noteMentionDismissed, setNoteMentionDismissed] = useState<string | null>(null);
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
  const helpersEnabled = composerDraft.allowSubagents !== false;
  const planModeActive = composerDraft.planMode === true;

  useEffect(() => {
    if (!goal) return undefined;
    setGoalClock(Date.now());
    const timer = window.setInterval(() => setGoalClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [goal?.createdAt]);

  const openGoalEditor = () => {
    setPlusMenuOpen(false);
    setGoalDraftText(goal?.text ?? "");
    setGoalError(null);
    setGoalEditorOpen(true);
  };

  const saveGoal = async () => {
    const clean = goalDraftText.trim();
    if (!clean || !onSaveGoal || goalSaving) return;
    setGoalSaving(true);
    setGoalError(null);
    try {
      await onSaveGoal(clean);
      setGoalEditorOpen(false);
      setGoalExpanded(false);
    } catch (error) {
      setGoalError(error instanceof Error ? error.message : "目标没有保存，请重试。");
    } finally {
      setGoalSaving(false);
    }
  };
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
  const currentProvider = providers.find((provider) => provider.id === currentProviderId);
  const currentContextPolicy = currentModelId
    ? currentProvider?.modelContextPolicies?.[currentModelId]
    : undefined;
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
  const referencePickerWorkspaceFiles = workspaceId
    ? filterWorkspaceFiles(workspaceFiles, "", 12)
    : [];
  const mentionKey = fileMention ? `${fileMention.start}:${fileMention.end}:${fileMention.query}` : null;
  const noteMention = parseNoteMention(value, caretPosition);
  const noteMentionMatches = noteMention
    ? notes.filter((note) => `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(noteMention.query.toLocaleLowerCase()))
    : [];
  const noteMentionKey = noteMention ? `${noteMention.start}:${noteMention.end}:${noteMention.query}` : null;
  const noteMentionOpen = noteMention !== null
    && !referencePickerOpen
    && noteMentionMatches.length > 0
    && noteMentionDismissed !== noteMentionKey;
  const mentionOpen = Boolean(workspaceId)
    && !referencePickerOpen
    && !noteMentionOpen
    && fileMention !== null
    && mentionMatches.length > 0
    && mentionDismissed !== mentionKey;
  const approvalPermissionMode: Exclude<PermissionMode, "plan"> = permissionMode === "plan"
    ? "acceptEdits"
    : permissionMode;
  const permissionLabel: Record<Exclude<PermissionMode, "plan">, string> = {
    default: "每次确认",
    acceptEdits: "风险确认",
    bypassPermissions: "完全访问",
  };
  const permissionOptions: Array<{ mode: Exclude<PermissionMode, "plan">; detail: string }> = [
    { mode: "default", detail: "写入、联网或执行前都先问你" },
    { mode: "acceptEdits", detail: "常规改动直接做，风险操作再询问" },
    { mode: "bypassPermissions", detail: "不再请求权限；仅在信任当前任务时使用" },
  ];
  const dismissInlinePickers = () => {
    setSlashEmptyOpen(false);
    setReferencePickerOpen(false);
    if (slashQuery !== null) setSlashDismissed(slashQuery);
    if (mentionKey !== null) setMentionDismissed(mentionKey);
    if (noteMentionKey !== null) setNoteMentionDismissed(noteMentionKey);
  };
  useEffect(() => {
    const popoverOpen = plusMenuOpen
      || modelPickerOpen
      || permissionMenuOpen
      || referencePickerOpen
      || slashEmptyOpen
      || slashOpen
      || mentionOpen
      || noteMentionOpen;
    if (!popoverOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPlusMenuOpen(false);
      setModelPickerOpen(false);
      setPermissionMenuOpen(false);
      setSlashEmptyOpen(false);
      setReferencePickerOpen(false);
      if (slashQuery !== null) setSlashDismissed(slashQuery);
      if (mentionKey !== null) setMentionDismissed(mentionKey);
      if (noteMentionKey !== null) setNoteMentionDismissed(noteMentionKey);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [
    mentionKey,
    mentionOpen,
    modelPickerOpen,
    noteMentionKey,
    noteMentionOpen,
    permissionMenuOpen,
    plusMenuOpen,
    referencePickerOpen,
    slashEmptyOpen,
    slashOpen,
    slashQuery,
  ]);
  const togglePermissionMenu = () => {
    setModelPickerOpen(false);
    setPlusMenuOpen(false);
    dismissInlinePickers();
    setPermissionMenuOpen((open) => !open);
  };
  const selectPermissionMode = (mode: Exclude<PermissionMode, "plan">) => {
    setPermissionMenuOpen(false);
    if (onSelectPermissionMode) {
      onSelectPermissionMode(mode);
      return;
    }
    if (mode === "acceptEdits" && permissionMode === "bypassPermissions") {
      onDisableFullAccess?.();
      return;
    }
    onOpenPermissionSettings?.();
  };

  const submit = async () => {
    const t = value.trim();
    if (
      (!t && attachments.length === 0 && referencedWorkspaceFiles.length === 0 && noteReferenceIds.length === 0)
      || submitPending
      || submitInFlightRef.current
      || attachmentPending
    ) return;
    const targetKey = conversationKey;
    const submittedText = value;
    const submittedAttachmentIds = new Set(attachments.map((attachment) => attachment.id));
    const submittedWorkspaceFileIds = new Set(referencedWorkspaceFiles.map((file) => file.id));
    const submittedNoteReferenceIds = new Set(noteReferenceIds);
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
      const turnOptions: ConversationTurnOptions | undefined = (!helpersEnabled
        || noteReferenceIds.length > 0
        || composerDraft.planMode !== undefined)
        ? {
        ...(composerDraft.planMode !== undefined
          ? { permissionMode: planModeActive ? "plan" : approvalPermissionMode }
          : {}),
        ...(!helpersEnabled ? { allowSubagents: false } : {}),
        ...(noteReferenceIds.length > 0 ? { noteReferences: [...noteReferenceIds] } : {}),
          }
        : undefined;
      const dispatch = busy ? onQueue : onSend;
      if (!dispatch) throw new Error("当前任务仍在进行，暂时无法排队这条消息。");
      if (outgoingWorkspaceFiles && turnOptions) {
        await dispatch(t, outgoingAttachments, outgoingWorkspaceFiles, turnOptions);
      } else if (outgoingWorkspaceFiles) {
        await dispatch(t, outgoingAttachments, outgoingWorkspaceFiles);
      } else if (turnOptions) await dispatch(t, outgoingAttachments, undefined, turnOptions);
      else await dispatch(t, outgoingAttachments);
      setNoteReferenceIds((current) => current.filter((id) => !submittedNoteReferenceIds.has(id)));
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
          allowSubagents: undefined,
          planMode: current.planMode === false ? undefined : current.planMode,
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

  const pickNoteReference = (note: Note) => {
    if (submitPending || !noteMention) return;
    const label = noteLabel(note);
    const nextValue = `${value.slice(0, noteMention.start)}@${label} ${value.slice(noteMention.end)}`;
    setNoteReferenceIds((current) => current.includes(note.id) ? current : [...current, note.id]);
    onChange(nextValue);
    setNoteMentionDismissed(noteMentionKey);
    setNoteMentionIndex(0);
    const caret = noteMention.start + label.length + 2;
    setCaretPosition(caret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const insertReferenceLabel = (label: string): { value: string; caret: number } => {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const prefix = value.slice(0, caret);
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const inserted = `${needsLeadingSpace ? " " : ""}@${label} `;
    return {
      value: `${prefix}${inserted}${value.slice(caret)}`,
      caret: caret + inserted.length,
    };
  };

  const finishReferencePickerPick = (nextValue: string, caret: number) => {
    const pickedFileMention = parseFileMention(nextValue, caret);
    if (pickedFileMention) {
      setMentionDismissed(`${pickedFileMention.start}:${pickedFileMention.end}:${pickedFileMention.query}`);
    }
    onChange(nextValue);
    setReferencePickerOpen(false);
    setCaretPosition(caret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const pickNoteFromReferencePicker = (note: Note) => {
    if (submitPending) return;
    const picked = insertReferenceLabel(noteLabel(note));
    setNoteReferenceIds((current) => current.includes(note.id) ? current : [...current, note.id]);
    finishReferencePickerPick(picked.value, picked.caret);
  };

  const pickWorkspaceFileFromReferencePicker = (file: WorkspaceFileNode) => {
    if (submitPending || !workspaceId) return;
    const picked = insertReferenceLabel(file.name);
    updateComposerDraft(conversationKey, (current) => {
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
              workspaceId,
              workspacePath: file.path,
            }],
        submitError: atLimit && !duplicate ? "一次最多添加 20 个附件。" : null,
      };
    });
    finishReferencePickerPick(picked.value, picked.caret);
  };

  const removeNoteReference = (id: string) => {
    if (!submitPending) setNoteReferenceIds((current) => current.filter((entry) => entry !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (referencePickerOpen && e.key === "Escape") {
      e.preventDefault();
      setReferencePickerOpen(false);
      return;
    }
    if (e.key === "Enter" && e.ctrlKey && !composing && busy) {
      e.preventDefault();
      if (attachments.length > 0 || referencedWorkspaceFiles.length > 0 || noteReferenceIds.length > 0) {
        setGuidanceNotice("引导只支持纯文字；附件、文件或便签可按 Enter 排到下一轮");
        return;
      }
      const prompt = value.trim();
      if (!prompt || !onGuide || guidancePending) return;
      const targetKey = conversationKey;
      setGuidancePending(true);
      setGuidanceNotice(null);
      patchComposerDraft(targetKey, { submitError: null });
      void onGuide(prompt).then((result) => {
        if (valueRef.current.trim() === prompt) onChange("");
        setGuidanceNotice(result.delivery === "applied"
          ? "已加入当前任务"
          : "已排队，将在下一轮送达");
      }).catch((error: unknown) => {
        patchComposerDraft(targetKey, {
          submitError: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => setGuidancePending(false));
      return;
    }
    if (noteMentionOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setNoteMentionIndex((index) => moveSelection(
          index,
          e.key === "ArrowDown" ? 1 : -1,
          noteMentionMatches.length,
        ));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !composing) {
        e.preventDefault();
        const picked = noteMentionMatches[noteMentionIndex] ?? noteMentionMatches[0];
        if (picked) pickNoteReference(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setNoteMentionDismissed(noteMentionKey);
        return;
      }
    }
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
    if (slashEmptyOpen && e.key === "Escape") {
      e.preventDefault();
      setSlashEmptyOpen(false);
      return;
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
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      void submit();
    }
  };

  const editQueuedTurn = (queuedTurn: QueuedTurn) => {
    const targetKey = conversationKey;
    const restoredText = value.trim()
      ? `${queuedTurn.text.trimEnd()}\n\n${value}`
      : queuedTurn.text;
    const restoredAttachments: ComposerAttachment[] = queuedTurn.attachments.map((attachment, index) => ({
      ...attachment,
      id: `${queuedTurn.id}-attachment-${index}`,
    }));
    const restoredWorkspaceFiles = queuedTurn.workspaceFiles.map((file, index) => ({
      ...file,
      id: `${queuedTurn.id}-workspace-${index}`,
    }));
    updateComposerDraft(targetKey, (current) => ({
      ...current,
      text: restoredText,
      attachments: [...restoredAttachments, ...current.attachments],
      workspaceFiles: [...restoredWorkspaceFiles, ...(current.workspaceFiles ?? [])],
      allowSubagents: queuedTurn.allowSubagents,
      submitError: null,
    }));
    if (draftState === undefined || !onDraftStateChange) onChange(restoredText);
    if (queuedTurn.noteReferences?.length) {
      setNoteReferenceIds((current) => [...new Set([...queuedTurn.noteReferences!, ...current])]);
    }
    onEditQueuedTurn?.(queuedTurn.id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const guideQueuedTurn = async (queuedTurn: QueuedTurn) => {
    if (!onGuideQueuedTurn || guidancePending) return;
    setGuidancePending(true);
    setGuidanceNotice(null);
    patchComposerDraft(conversationKey, { submitError: null });
    try {
      const result = await onGuideQueuedTurn(queuedTurn.id);
      setGuidanceNotice(result.delivery === "applied"
        ? "已加入当前任务"
        : "已排队，将在下一轮送达");
    } catch (error) {
      patchComposerDraft(conversationKey, {
        submitError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setGuidancePending(false);
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

  const addWorkspaceFileReference = (file: { name: string; workspaceId: string; workspacePath: string }): boolean => {
    if (submitPending || !file.name || !file.workspaceId || !file.workspacePath) return false;
    const targetKey = conversationKey;
    updateComposerDraft(targetKey, (current) => {
      const existing = current.workspaceFiles ?? [];
      const duplicate = existing.some((entry) =>
        entry.workspaceId === file.workspaceId && entry.workspacePath === file.workspacePath,
      );
      const atLimit = usedAttachmentSlots(current) >= 20;
      return {
        ...current,
        workspaceFiles: duplicate || atLimit
          ? existing
          : [...existing, { ...file, id: `${Date.now()}-${Math.random()}` }],
        submitError: atLimit && !duplicate ? "一次最多添加 20 个附件。" : null,
      };
    });
    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addLocalFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const workspaceFileFromTransfer = (transfer: DataTransfer): { name: string; workspaceId: string; workspacePath: string } | null => {
    try {
      const raw = transfer.getData(WORKSPACE_FILE_DRAG_TYPE);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<{ name: string; workspaceId: string; workspacePath: string }>;
      if (typeof parsed.name !== "string" || typeof parsed.workspaceId !== "string" || typeof parsed.workspacePath !== "string") return null;
      return { name: parsed.name, workspaceId: parsed.workspaceId, workspacePath: parsed.workspacePath };
    } catch {
      return null;
    }
  };

  const isFileTransfer = (transfer: DataTransfer): boolean =>
    Array.from(transfer.types ?? []).includes("Files") || transfer.files.length > 0;

  const isComposerTransfer = (transfer: DataTransfer): boolean =>
    isFileTransfer(transfer) || Array.from(transfer.types ?? []).includes(WORKSPACE_FILE_DRAG_TYPE);

  const handleFileDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if ((!resolveFilePath && !workspaceId) || !isComposerTransfer(e.dataTransfer)) return;
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
    if ((!resolveFilePath && !workspaceId) || !isComposerTransfer(e.dataTransfer)) return;
    e.stopPropagation();
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFileDragActive(false);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if ((!resolveFilePath && !workspaceId) || !isComposerTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragActive(false);
    if (submitPending) return;
    const workspaceFile = workspaceFileFromTransfer(e.dataTransfer);
    if (workspaceFile) {
      addWorkspaceFileReference(workspaceFile);
      return;
    }
    if (resolveFilePath) addLocalFiles(e.dataTransfer.files);
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
    setPermissionMenuOpen(false);
    setPlusMenuOpen(false);
    dismissInlinePickers();
    setSlashDismissed(null);
    setSlashIndex(0);
    if (skills.length === 0) {
      setSlashEmptyOpen((open) => !open);
      textareaRef.current?.focus();
      return;
    }
    setSlashEmptyOpen(false);
    if (parseSlashQuery(value) === null) onChange("/");
    textareaRef.current?.focus();
  };

  const handleAttachmentClick = () => {
    setPlusMenuOpen(false);
    if (resolveFilePath && !submitPending) fileInputRef.current?.click();
  };

  const handleReferenceClick = () => {
    if (submitPending) return;
    setModelPickerOpen(false);
    setPermissionMenuOpen(false);
    setPlusMenuOpen(false);
    setSlashEmptyOpen(false);
    if (slashQuery !== null) setSlashDismissed(slashQuery);
    setMentionDismissed(null);
    setNoteMentionDismissed(null);
    setReferencePickerOpen((open) => !open);
    textareaRef.current?.focus();
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
      data-testid="shared-composer"
      data-surface={surface}
      className={surface === "buddy"
        ? "leemo-shared-composer bg-transparent px-4 pb-4 pt-2 max-[900px]:px-3"
        : "leemo-shared-composer bg-transparent px-4 pb-4 pt-2.5 max-[900px]:px-3"}
      onDragEnter={handleFileDrag}
      onDragOver={handleFileDrag}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {retryDraft?.errorMessage && !retryRecoveryRendered && (
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

      {queuedTurns[0] && (
        <div
          data-testid="queued-turn-list"
          className={`mb-2 space-y-1 ${queuedListExpanded ? "max-h-36 overflow-y-auto pr-0.5" : ""}`}
        >
          {queuedTurns
            .slice(0, queuedListExpanded ? queuedTurns.length : 1)
            .map((queuedTurn, index) => {
              const fileCount = queuedTurn.attachments.length
                + queuedTurn.workspaceFiles.length
                + (queuedTurn.noteReferences?.length ?? 0);
              const preview = Array.from(queuedTurn.text.trim() || "附件消息").slice(0, 24).join("");
              const canGuide = fileCount === 0 && queuedTurn.text.trim().length > 0;
              const guideTitle = canGuide
                ? "转为引导"
                : "含附件、文件或便签，不能转为引导";
              return (
                <div
                  key={queuedTurn.id}
                  data-testid={index === 0 ? "queued-turn-row" : "queued-turn-extra-row"}
                  className="flex h-8 min-w-0 items-center gap-2 rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-2.5 text-xs text-[var(--leemo-ink-2)]"
                >
                  <span className="shrink-0 text-[var(--leemo-amber-strong)]">已排队</span>
                  <span className="min-w-0 flex-1 truncate" title={queuedTurn.text}>{preview}</span>
                  {fileCount > 0 && <span className="shrink-0 text-[var(--leemo-ink-3)]">{fileCount} 个文件</span>}
                  {index === 0 && queuedTurns.length > 1 && (
                    <button
                      type="button"
                      aria-label={queuedListExpanded ? "收起排队消息" : `另有 ${queuedTurns.length - 1} 条`}
                      aria-expanded={queuedListExpanded}
                      className="shrink-0 rounded px-1 py-0.5 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)]"
                      onClick={() => setQueuedListExpanded((expanded) => !expanded)}
                    >
                      {queuedListExpanded ? "收起" : `另有 ${queuedTurns.length - 1} 条`}
                    </button>
                  )}
                  {queuedTurn.errorMessage && (
                    <span className="max-w-[180px] shrink truncate text-[var(--leemo-danger)]" title={queuedTurn.errorMessage}>
                      发送失败：{queuedTurn.errorMessage}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="编辑排队消息"
                    title="编辑"
                    className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)]"
                    onClick={() => editQueuedTurn(queuedTurn)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="删除排队消息"
                    title="删除"
                    className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-danger)]"
                    onClick={() => onDeleteQueuedTurn?.(queuedTurn.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="转为引导"
                    title={guideTitle}
                    disabled={!canGuide || !onGuideQueuedTurn || guidancePending}
                    className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={() => void guideQueuedTurn(queuedTurn)}
                  >
                    <CornerUpRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {(attachments.length > 0 || referencedWorkspaceFiles.length > 0 || noteReferenceIds.length > 0 || attachmentPending) && (
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
          {noteReferenceIds.map((id) => {
            const note = notes.find((candidate) => candidate.id === id);
            if (!note) return null;
            const label = noteLabel(note);
            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-1.5 text-sm"
              >
                <FileText className="h-4 w-4 text-[var(--leemo-amber-strong)]" aria-hidden />
                <span className="max-w-[220px] truncate text-[var(--leemo-ink-2)]">{label}</span>
                <span className="text-[10.5px] text-[var(--leemo-ink-4)]">便签</span>
                <button
                  type="button"
                  onClick={() => removeNoteReference(id)}
                  disabled={submitPending}
                  className="ml-1 text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink)]"
                  aria-label={`移除便签引用 ${label}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
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

      {goalEditorOpen && (
        <div className="leemo-goal-editor mb-2 rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-2 shadow-[var(--leemo-shadow-input)]">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber-strong)]" aria-hidden />
            <input
              autoFocus
              aria-label="目标内容"
              value={goalDraftText}
              onChange={(event) => setGoalDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void saveGoal();
                }
                if (event.key === "Escape") setGoalEditorOpen(false);
              }}
              placeholder="这段时间希望持续完成什么？"
              className="leemo-goal-editor__input min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)]"
            />
            <button
              type="button"
              aria-label="取消编辑目标"
              onClick={() => setGoalEditorOpen(false)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)]"
            >
              取消
            </button>
            <button
              type="button"
              aria-label="保存目标"
              disabled={!goalDraftText.trim() || !onSaveGoal || goalSaving}
              onClick={() => void saveGoal()}
              className="rounded-md bg-[var(--leemo-amber)] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[var(--leemo-amber-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              保存
            </button>
          </div>
          {goalError && <p role="alert" className="mt-1.5 pl-5 text-[11px] text-[var(--leemo-danger)]">{goalError}</p>}
        </div>
      )}

      {goal && !goalEditorOpen && (
        <div
          data-testid="conversation-goal-card"
          className="leemo-goal-card mb-2 rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-2.5 shadow-[var(--leemo-shadow-input)]"
        >
          <div className="flex h-9 min-w-0 items-center gap-2 text-xs text-[var(--leemo-ink-2)]">
            <Target className={`h-3.5 w-3.5 shrink-0 ${goal.status === "active" ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink-3)]"}`} aria-hidden />
            <span className="leemo-goal-status-label shrink-0 font-medium text-[var(--leemo-ink)]">
              {goal.status === "active" ? "进行中的目标" : "已暂停的目标"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-3)]" title={goal.text}>{goal.text}</span>
            <span className="leemo-goal-elapsed shrink-0 tabular-nums text-[var(--leemo-ink-3)]">{formatGoalElapsed(goal.createdAt, goalClock)}</span>
            <button type="button" aria-label="编辑目标" title="编辑" onClick={openGoalEditor} className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)]">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={goal.status === "active" ? "暂停目标" : "继续目标"} title={goal.status === "active" ? "暂停" : "继续"} onClick={() => void onToggleGoalPaused?.()} className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)]">
              {goal.status === "active" ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            </button>
            <button type="button" aria-label="删除目标" title="删除" onClick={() => void onDeleteGoal?.()} className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-danger)]">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={goalExpanded ? "收起完整目标" : "显示完整目标"} aria-expanded={goalExpanded} onClick={() => setGoalExpanded((expanded) => !expanded)} className="rounded p-1 text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-hover)] hover:text-[var(--leemo-ink)]">
              {goalExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
          {goalExpanded && <p className="border-t border-[var(--leemo-line)] py-2 pl-5 pr-2 text-xs leading-5 text-[var(--leemo-ink-2)]">{goal.text}</p>}
        </div>
      )}

      <div
        data-testid="composer-surface"
        className={`leemo-composer-surface leemo-input-shadow relative border border-[var(--leemo-line)] bg-[var(--leemo-card)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--leemo-amber)] ${surface === "buddy" ? "rounded-[20px]" : "rounded-[13px]"}`}
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
        {slashEmptyOpen && (
          <div
            role="status"
            className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[280px] rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3.5 py-3 shadow-[var(--leemo-shadow-popover)]"
          >
            <p className="text-[13px] font-medium text-[var(--leemo-ink)]">还没有启用技能</p>
            <p className="mt-1 text-[11.5px] leading-5 text-[var(--leemo-ink-3)]">请先在技能中心启用一个技能。</p>
          </div>
        )}
        {referencePickerOpen && (
          <div
            role="listbox"
            aria-label="引用文件或便签"
            className="absolute bottom-[calc(100%+8px)] left-0 z-30 max-h-[min(360px,58vh)] w-[420px] max-w-full min-w-[280px] overflow-y-auto rounded-[14px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[var(--leemo-shadow-popover)]"
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[11.5px] font-medium tracking-[0.02em] text-[var(--leemo-ink-3)]">
              引用到本轮
            </div>
            {notes.length > 0 && (
              <div className="pb-1">
                <div className="px-2.5 py-1 text-[11px] text-[var(--leemo-ink-3)]">便签</div>
                {notes.slice(0, 8).map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    role="option"
                    aria-selected={noteReferenceIds.includes(note.id)}
                    aria-label={`便签 ${noteLabel(note)}`}
                    onClick={() => pickNoteFromReferencePicker(note)}
                    className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--leemo-hover)] focus-visible:bg-[var(--leemo-hover)] focus-visible:outline-none"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--leemo-amber-soft)] text-[var(--leemo-amber-strong)]">
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[var(--leemo-ink)]">{noteLabel(note)}</span>
                      {note.markdown.trim() && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--leemo-ink-3)]">{note.markdown}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {referencePickerWorkspaceFiles.length > 0 && (
              <div className={notes.length > 0 ? "border-t border-[var(--leemo-line)] pt-1" : ""}>
                <div className="px-2.5 py-1 text-[11px] text-[var(--leemo-ink-3)]">当前本子文件</div>
                {referencePickerWorkspaceFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    role="option"
                    aria-selected={referencedWorkspaceFiles.some((entry) => entry.workspacePath === file.path)}
                    aria-label={`文件 ${file.name} ${file.path}`}
                    onClick={() => pickWorkspaceFileFromReferencePicker(file)}
                    className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--leemo-hover)] focus-visible:bg-[var(--leemo-hover)] focus-visible:outline-none"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--leemo-surface-2)] text-[var(--leemo-ink-3)]">
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[var(--leemo-ink)]">{file.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[var(--leemo-ink-3)]">{file.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {notes.length === 0 && referencePickerWorkspaceFiles.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-[13px] text-[var(--leemo-ink-2)]">还没有可引用的内容</p>
                <p className="mt-1 text-[11.5px] text-[var(--leemo-ink-3)]">创建便签或打开一个包含文件的本子后再试。</p>
              </div>
            )}
          </div>
        )}
        {noteMentionOpen && (
          <div
            data-testid="note-mention-menu"
            className="absolute bottom-full left-0 z-30 mb-2 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1 shadow-lg"
          >
            {noteMentionMatches.map((note, index) => (
              <button
                key={note.id}
                type="button"
                aria-label={`引用便签 ${noteLabel(note)}`}
                onMouseEnter={() => setNoteMentionIndex(index)}
                onClick={() => pickNoteReference(note)}
                className={`block w-full rounded px-3 py-2 text-left text-sm ${index === noteMentionIndex ? "bg-[var(--leemo-hover)]" : "hover:bg-[var(--leemo-hover)]"}`}
              >
                <span className="block truncate text-[var(--leemo-ink)]">{noteLabel(note)}</span>
                {note.markdown.trim() && (
                  <span className="mt-0.5 block truncate text-xs text-[var(--leemo-ink-3)]">{note.markdown}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {mentionOpen && (
          <FileMentionMenu
            files={mentionMatches}
            selectedIndex={Math.min(mentionIndex, mentionMatches.length - 1)}
            onPick={pickWorkspaceFile}
            onHover={setMentionIndex}
          />
        )}
        <ComposerPlusMenu
          open={plusMenuOpen}
          fileEnabled={Boolean(resolveFilePath) && !submitPending}
          planModeActive={planModeActive}
          hasGoal={Boolean(goal)}
          onPickFile={handleAttachmentClick}
          onTogglePlanMode={() => {
            patchComposerDraft(conversationKey, { planMode: planModeActive ? false : true });
            setPlusMenuOpen(false);
          }}
          onOpenGoal={openGoalEditor}
        />

        <textarea
          ref={textareaRef}
          aria-label="输入消息"
          placeholder="输入消息…"
          value={value}
          disabled={submitPending}
          onChange={(e) => {
            setSlashEmptyOpen(false);
            setReferencePickerOpen(false);
            setCaretPosition(e.target.selectionStart);
            setMentionDismissed(null);
            setMentionIndex(0);
            setNoteMentionDismissed(null);
            setNoteMentionIndex(0);
            onChange(e.target.value);
          }}
          onClick={(e) => setCaretPosition(e.currentTarget.selectionStart)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className={`leemo-composer-textarea w-full resize-none bg-transparent px-4 pb-2 pt-3.5 leading-[1.65] text-[var(--leemo-ink)] caret-[var(--leemo-amber)] outline-none placeholder:text-[var(--leemo-ink-3)] disabled:cursor-wait ${surface === "buddy" ? "text-[15.5px]" : "text-[14.5px]"}`}
          rows={1}
          style={{ minHeight: surface === "workbench" ? "66px" : "64px", maxHeight: "144px" }}
        />

        <div className="leemo-composer-toolbar flex min-h-11 items-center gap-1.5 px-2.5 pb-1.5">
          <button
            data-testid="composer-icon-control"
            type="button"
            onClick={() => {
              setModelPickerOpen(false);
              setPermissionMenuOpen(false);
              dismissInlinePickers();
              setPlusMenuOpen((open) => !open);
            }}
            disabled={submitPending}
            className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--leemo-hover)] disabled:cursor-wait disabled:opacity-35 ${
              planModeActive ? "bg-[var(--leemo-amber-soft)]" : ""
            }`}
            title={planModeActive ? "计划模式已开启；打开添加菜单" : "添加"}
            aria-label={planModeActive ? "添加，计划模式已开启" : "添加"}
            aria-expanded={plusMenuOpen}
          >
            <Plus className={`h-[18px] w-[18px] ${planModeActive ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink-3)]"}`} aria-hidden />
            {planModeActive && (
              <span
                data-testid="composer-plan-mode-indicator"
                className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-[var(--leemo-amber-strong)] ring-2 ring-[var(--leemo-card)]"
                aria-hidden
              />
            )}
          </button>
          <button
            data-testid="composer-icon-control"
            type="button"
            onClick={handleSkillClick}
            disabled={submitPending}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-[var(--leemo-hover)] disabled:cursor-wait disabled:opacity-35 disabled:hover:bg-transparent"
            title="技能"
            aria-label="/ 技能"
          >
            <span className="leemo-composer-slash-glyph grid h-[18px] w-[18px] -translate-y-px place-items-center text-[17px] font-medium leading-none text-[var(--leemo-ink-3)]" aria-hidden>/</span>
          </button>

          <button
            data-testid="composer-icon-control"
            type="button"
            onClick={handleReferenceClick}
            disabled={submitPending}
            aria-expanded={referencePickerOpen}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--leemo-hover)] disabled:cursor-wait disabled:opacity-35 disabled:hover:bg-transparent ${referencePickerOpen ? "bg-[var(--leemo-amber-soft)] text-[var(--leemo-amber-strong)]" : ""}`}
            title="引用文件或便签"
            aria-label="@ 引用"
          >
            <AtSign className={`h-[17px] w-[17px] ${referencePickerOpen ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink-3)]"}`} aria-hidden />
          </button>

          <>
              <span className="leemo-composer-divider mx-1 h-4 w-px bg-[var(--leemo-line)]" aria-hidden />
              <span className="leemo-composer-model-cluster flex min-w-0 items-center gap-0.5">
                {(contextUsage || currentContextPolicy) && (
                  <ContextUsageIndicator
                    usage={contextUsage}
                    providerId={currentProviderId ?? undefined}
                    modelId={currentModelId ?? undefined}
                    updating={busy}
                    policy={currentContextPolicy}
                  />
                )}
                <button
                  type="button"
                  className="leemo-composer-model flex min-h-8 min-w-0 max-w-[190px] items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-hover)]"
                  aria-label="切换模型"
                  title={`当前模型：${modelPickerLabel(currentModelId)}`}
                  onClick={() => {
                    setPermissionMenuOpen(false);
                    setPlusMenuOpen(false);
                    dismissInlinePickers();
                    setModelPickerOpen(!modelPickerOpen);
                  }}
                >
                  <Brain className="h-[15px] w-[15px] shrink-0" aria-hidden />
                  <span data-testid="composer-model-label" className="leemo-composer-responsive-label truncate">{modelPickerLabel(currentModelId)}</span>
                  <ChevronDown className="leemo-composer-responsive-chevron h-3 w-3 shrink-0" aria-hidden />
                </button>
              </span>
              <button
                type="button"
                aria-label={`权限模式：${permissionLabel[approvalPermissionMode]}`}
                aria-expanded={permissionMenuOpen}
                title="切换权限模式"
                onClick={togglePermissionMenu}
                className={`leemo-composer-permission flex min-h-8 min-w-0 max-w-[150px] items-center gap-1.5 truncate rounded-md px-2 py-1 text-[12.5px] hover:bg-[var(--leemo-hover)] ${
                  approvalPermissionMode === "bypassPermissions"
                    ? "text-[var(--leemo-amber-strong)]"
                    : "text-[var(--leemo-ink-2)]"
                }`}
              >
                <ShieldCheck className="h-[15px] w-[15px] shrink-0" aria-hidden />
                <span data-testid="composer-permission-label" className="leemo-composer-responsive-label truncate">
                  {permissionLabel[approvalPermissionMode]}
                </span>
                <ChevronDown className="leemo-composer-responsive-chevron h-3 w-3 shrink-0" aria-hidden />
              </button>
              <button
                data-testid="composer-icon-control"
                type="button"
                disabled={submitPending}
                aria-label={helpersEnabled ? "本轮自动召集助手" : "本轮不使用助手"}
                aria-pressed={helpersEnabled}
                title={helpersEnabled ? "助手分工：自动" : "助手分工：本轮关闭"}
                onClick={() => patchComposerDraft(conversationKey, {
                  allowSubagents: helpersEnabled ? false : undefined,
                })}
                className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-md transition-[background-color,color] hover:bg-[var(--leemo-hover)] disabled:cursor-wait disabled:opacity-50 ${
                  helpersEnabled ? "text-[var(--leemo-ink-3)]" : "bg-[var(--leemo-hover)] text-[var(--leemo-ink-2)]"
                }`}
              >
                <UsersRound className="h-[15px] w-[15px]" aria-hidden />
                {!helpersEnabled && (
                  <span
                    data-testid="assistant-disabled-slash"
                    className="pointer-events-none absolute h-[1.5px] w-[18px] -rotate-45 rounded-full bg-current"
                    aria-hidden
                  />
                )}
              </button>
          </>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={submitPending}
            onChange={handleFileSelect}
            className="hidden"
          />

          <span
            data-testid="composer-shortcut-hint"
            className={`leemo-composer-shortcut ${surface === "buddy" ? "max-[900px]:hidden" : ""} text-[10.5px] text-[var(--leemo-ink-4)]`}
          >
            {busy ? "Ctrl+Enter 引导当前任务 · Shift+Enter 换行" : "Enter 发送 · Shift+Enter 换行"}
          </span>

          {busy ? (
            <button
              type="button"
              aria-label="停止"
              onClick={() => onStop?.()}
              className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--leemo-ink)] text-white shadow-sm transition-colors hover:bg-black"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送"
              onClick={() => void submit()}
              disabled={submitPending || attachmentPending || (!value.trim() && attachments.length === 0 && referencedWorkspaceFiles.length === 0)}
              className="leemo-composer-submit ml-auto grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[12px] text-white disabled:cursor-not-allowed"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {permissionMenuOpen && (
          <div
            role="menu"
            aria-label="权限模式"
            className="absolute bottom-[calc(100%+8px)] left-3 right-3 z-40 overflow-hidden rounded-[14px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[0_14px_36px_rgba(17,31,49,0.16)] sm:left-[132px] sm:right-auto sm:w-[340px]"
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] text-[var(--leemo-ink-3)]">本轮如何执行</div>
            {permissionOptions.map((option) => {
              const selected = approvalPermissionMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => selectPermissionMode(option.mode)}
                  className={`flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--leemo-hover)] ${
                    selected ? "bg-[var(--leemo-hover)]" : ""
                  }`}
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${
                    option.mode === "bypassPermissions" ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink-3)]"
                  }`}>
                    {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] font-medium ${
                      option.mode === "bypassPermissions" ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink)]"
                    }`}>{permissionLabel[option.mode]}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--leemo-ink-3)]">{option.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {modelPickerOpen && (
          <div
            data-testid="model-picker-menu"
            className="absolute bottom-[calc(100%+8px)] left-3 right-3 z-40 max-h-72 overflow-y-auto rounded-[14px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-2 shadow-[var(--leemo-shadow-popover)] sm:left-[132px] sm:right-auto sm:w-[360px]"
          >
            {modelGroups.length === 0 ? (
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
                    const optionProvider = providers.find((provider) => provider.id === option.providerId);
                    const optionCapacity = effectiveContextCapacity(
                      optionProvider?.modelContextPolicies?.[option.modelId],
                    );
                    const needsContextHandoff = optionCapacity !== undefined
                      && contextUsage !== undefined
                      && contextUsage.currentTokens > optionCapacity;
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
                        {optionCapacity !== undefined && (
                          <span className="shrink-0 text-[10px] tabular-nums text-[var(--leemo-ink-3)]">
                            {formatContextTokens(optionCapacity)}
                          </span>
                        )}
                        {needsContextHandoff && (
                          <span className="shrink-0 rounded-full bg-[var(--leemo-warm-soft)] px-1.5 py-0.5 text-[10px] text-[var(--leemo-amber-strong)]">
                            将先整理
                          </span>
                        )}
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

      {submitError && (
        <div role="alert" className="leemo-composer-alert" title={submitError}>
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{submitError}</span>
          <button
            type="button"
            className="leemo-composer-alert__dismiss"
            aria-label="关闭错误提示"
            title="关闭"
            onClick={() => patchComposerDraft(conversationKey, { submitError: null })}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {guidanceNotice && !submitError && (
        <div role="status" className="mt-1.5 px-2 text-xs text-[var(--leemo-ink-3)]">
          {guidanceNotice}
        </div>
      )}

    </div>
  );
}
