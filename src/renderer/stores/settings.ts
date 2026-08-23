import { createStore, type StoreApi } from "zustand/vanilla";
import type { PermissionMode } from "../../bridge/contract";
import {
  isValidGlobalOverviewTime,
  normalizeGlobalOverviewTime,
} from "../global-overview/auto-refresh";

/** momo's opening line: time-of-day tone + optional memory recall (02 §4.1). */
export function buildGreeting(hour: number, memory?: string): string {
  const tod = hour < 5 ? "夜里好" : hour < 11 ? "早呀" : hour < 18 ? "下午好" : "晚上好";
  const recall = memory ? `，昨晚帮你把${memory}` : "";
  return `${tod}${recall}。今天想从哪儿开始？`;
}

export interface PersonaCard {
  id: string;
  name: string;
  tagline: string;
  promptText: string;
  builtin: boolean;
}

export interface PersonaCardDraft {
  id?: string;
  name: string;
  tagline: string;
  promptText: string;
}

export type RelationshipStyle = "companion" | "friend" | "senior" | "mentor";
export type AppSurface = "start" | "buddy" | "workbench";
export type ThemeId = "white-copper" | "warm-copper" | "white-indigo";

/** The three palette contracts are deliberately named for user-visible
 * qualities, not implementation tokens.  Keeping this list beside the
 * persisted setting makes the future theme picker and hydration share one
 * validation boundary. */
export const THEME_OPTIONS: ReadonlyArray<{
  id: ThemeId;
  label: string;
  description: string;
}> = [
  {
    id: "white-copper",
    label: "白底铜橙",
    description: "纯白工作区，蓝墨文字与铜橙重点",
  },
  {
    id: "warm-copper",
    label: "暖纸铜橙",
    description: "暖纸底色，适合长时间阅读",
  },
  {
    id: "white-indigo",
    label: "白底蓝墨",
    description: "冷静白底与蓝墨重点",
  },
];

const THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map((option) => option.id));

export const RELATIONSHIP_STYLE_OPTIONS: ReadonlyArray<{
  id: RelationshipStyle;
  label: string;
  description: string;
  promptText: string;
}> = [
  {
    id: "companion",
    label: "搭档",
    description: "一起想清楚，也一起把事做完",
    promptText: "你与用户的关系定位是搭档：平等协作，一起想清楚，也一起把事情做完。",
  },
  {
    id: "friend",
    label: "朋友",
    description: "自然聊天，也认真帮忙",
    promptText: "你与用户的关系定位更像朋友：交流自然、有生活感，同时认真对待用户交代的事情。",
  },
  {
    id: "senior",
    label: "学长 / 学姐",
    description: "讲清经验，也尊重你的选择",
    promptText: "你与用户的关系定位更像可信的学长或学姐：解释经验、提醒盲点，但尊重用户自己的判断和选择。",
  },
  {
    id: "mentor",
    label: "导师",
    description: "重视方法、判断和长期成长",
    promptText: "你与用户的关系定位更像导师：重视方法、判断和长期成长，但不居高临下，也不替用户做决定。",
  },
];

const RELATIONSHIP_STYLE_IDS = new Set<RelationshipStyle>(
  RELATIONSHIP_STYLE_OPTIONS.map((option) => option.id),
);

/** Combine the user-selected persona card and relationship into the one
 * existing prompt layer. Keeping one resolved string means current and new
 * conversations share the same hot-update path. */
export function resolveMomoPersonaText(
  personaText: string,
  relationshipStyle: RelationshipStyle,
): string {
  const relationship = RELATIONSHIP_STYLE_OPTIONS.find((option) => option.id === relationshipStyle);
  return [personaText.trim(), relationship?.promptText ?? ""].filter(Boolean).join("\n");
}

export interface SettingsState {
  surface: AppSurface;
  mode: "buddy" | "workbench";
  themeId: ThemeId;
  persona: string;
  personaCardId: string;
  personaCards: PersonaCard[];
  relationshipStyle: RelationshipStyle;
  talkStyle: 1 | 2 | 3;
  defaultProviderId: string | null;
  defaultModelId: string | null;
  /** Ordered provider instance ids. First usable provider is the app default. */
  providerOrder: string[];
  permissionMode: PermissionMode;
  dangerousCommandCaching: boolean;
  /** 统筹开关「联网功能」. OFF masks BOTH capabilities below without erasing
   *  them — the user can switch the whole thing off for a while and get their
   *  two sub-choices back untouched when they switch it on again. */
  webEnabled: boolean;
  /** 二级开关「联网搜索 WebSearch」. Only in effect while `webEnabled`; read
   *  `webSearchActive()` (never this field) to decide what momo actually gets. */
  webSearchEnabled: boolean;
  /** 二级开关「联网抓取 WebFetch」. Same masking rule as above. */
  webFetchEnabled: boolean;
  searchKeySources: { kind: string; configured: boolean }[];
  rememberMode: boolean;
  /** Keep long Agent rounds alive while still allowing the display to sleep. */
  keepAwakeDuringTasks: boolean;
  /** Native OS notifications are only emitted while Leemo is not foreground. */
  desktopNotifications: boolean;
  /** Allow one small provider request only when local task-time parsing is ambiguous. */
  taskModelParsingEnabled: boolean;
  /** Optional once-per-day foreground refresh for the global pending overview. */
  globalOverviewAutoEnabled: boolean;
  globalOverviewAutoTime: string;
  /** Start the packaged desktop app after the user signs in to Windows. */
  launchAtLogin: boolean;
  /** Keep Leemo available from the tray after the main window is closed. */
  continueInBackground: boolean;
  /** Electron accelerator used to open the quiet quick-capture window. */
  quickCaptureShortcut: string;
  /** User-confirmed root for managed note images and copied files. Undefined
   * means no growing content has been silently assigned to a system drive. */
  captureStorageRoot?: string;
  /** Folder used for new task artifacts when the user has not chosen a notebook. */
  defaultWorkspaceId: string;
  /** What future ordinary file drops do; pasted images are always managed. */
  captureFileDropMode: "reference" | "copy";
  onboardingCompleted: boolean;
  /** Whether the one-time calm invitation on the empty buddy screen was
   * dismissed. The permanent top-bar entry remains available either way. */
  relationshipInviteDismissed: boolean;
  /** Stable conversation route for the reusable relationship ritual. */
  relationshipConversationId: string | null;
  dataDir: string;
  /** Stable built-in/custom skill ids whose enabled state differs from the
   * catalog default. Kept separate from display names so renaming a skill does
   * not silently re-enable it. */
  skillOverrides: Record<string, boolean>;

  setMode(mode: SettingsState["mode"]): void;
  setSurface(surface: AppSurface): void;
  setThemeId(themeId: ThemeId): void;
  setPersonaCard(id: string): void;
  setRelationshipStyle(style: RelationshipStyle): void;
  /** Create or edit a user-authored card. Returns its stable id, or null when
   * the draft is invalid or attempts to overwrite a built-in card. */
  upsertPersonaCard(draft: PersonaCardDraft): string | null;
  /** Built-in cards are product defaults and cannot be deleted. */
  deletePersonaCard(id: string): void;
  setTalkStyle(style: SettingsState["talkStyle"]): void;
  /** With two arguments the first is provider id and the second model id;
   * with one argument only the model changes. */
  setDefaultModel(providerOrModel: string | null, modelId?: string | null): void;
  setProviderOrder(ids: string[]): void;
  setPermissionMode(mode: PermissionMode): void;
  setDangerousCommandCaching(enabled: boolean): void;
  setWebEnabled(enabled: boolean): void;
  setWebSearchEnabled(enabled: boolean): void;
  setWebFetchEnabled(enabled: boolean): void;
  setRememberMode(enabled: boolean): void;
  setKeepAwakeDuringTasks(enabled: boolean): void;
  setDesktopNotifications(enabled: boolean): void;
  setTaskModelParsingEnabled(enabled: boolean): void;
  setGlobalOverviewAutoEnabled(enabled: boolean): void;
  setGlobalOverviewAutoTime(time: string): void;
  setLaunchAtLogin(enabled: boolean): void;
  setContinueInBackground(enabled: boolean): void;
  setQuickCaptureShortcut(shortcut: string): void;
  setCaptureStorageRoot(root: string | undefined): void;
  setDefaultWorkspaceId(id: string): void;
  setCaptureFileDropMode(mode: "reference" | "copy"): void;
  completeOnboarding(): void;
  dismissRelationshipInvite(): void;
  setRelationshipConversationId(id: string | null): void;
  setSkillOverride(id: string, enabled: boolean): void;
  clearSkillOverride(id: string): void;
  /** 轮 7 A3 —— apply a persisted settings map on startup.
   *
   *  Per-field validated, unknown keys ignored, invalid values dropped: the DB
   *  is data written by a possibly-older/newer build, so it is treated as
   *  untrusted input (same posture as an IPC payload). A dropped field keeps its
   *  default rather than failing hydration — losing one preference must never
   *  cost the user the rest. */
  hydrate(persisted: Record<string, unknown>): void;
}

/** The settings that are persisted, and the ONLY ones (轮 7 A3).
 *
 *  Deliberately excludes:
 *   • `personaCards` — the combined runtime list includes product defaults.
 *     Persisting it would freeze today's built-ins into the DB. User-authored
 *     cards are projected separately as `userPersonaCards` and merged back on
 *     hydrate, so built-in copy can still evolve across releases.
 *   • `searchKeySources` — derived from the encrypted store, re-read on demand.
 *   • `dataDir` — an environment fact, not a preference.
 *
 *  Everything here is something the user actively changed and would be annoyed
 *  to lose. `mode` is included so Leemo reopens in the shell you left it in
 *  (06 §2.1「此后每次启动记住上次模式」). */
export const PERSISTED_SETTING_KEYS = [
  "surface",
  "mode",
  "themeId",
  "personaCardId",
  "relationshipStyle",
  "talkStyle",
  "defaultProviderId",
  "defaultModelId",
  "providerOrder",
  "permissionMode",
  "dangerousCommandCaching",
  "webEnabled",
  "webSearchEnabled",
  "webFetchEnabled",
  "rememberMode",
  "keepAwakeDuringTasks",
  "desktopNotifications",
  "taskModelParsingEnabled",
  "globalOverviewAutoEnabled",
  "globalOverviewAutoTime",
  "launchAtLogin",
  "continueInBackground",
  "quickCaptureShortcut",
  "captureStorageRoot",
  "defaultWorkspaceId",
  "captureFileDropMode",
  "onboardingCompleted",
  "relationshipInviteDismissed",
  "relationshipConversationId",
  "userPersonaCards",
  "skillOverrides",
] as const;

/** Project the store state down to just the persisted keys. */
export function pickPersistedSettings(s: SettingsState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PERSISTED_SETTING_KEYS) {
    if (k === "userPersonaCards") {
      out[k] = s.personaCards
        .filter((card) => !card.builtin)
        .map((card) => ({ ...card, builtin: false }));
    } else if (k === "providerOrder") {
      out[k] = [...s.providerOrder];
    } else if (k === "skillOverrides") {
      out[k] = { ...s.skillOverrides };
    } else {
      out[k] = s[k];
    }
  }
  return out;
}

/** What momo actually gets, after the 统筹 switch masks the sub-switches.
 *
 *  These two are the ONLY things production code may send to the host — reading
 *  `webSearchEnabled` directly would hand momo a tool the user switched off at
 *  the top level. Pure functions over a state slice (not store methods) so the
 *  masking rule can be unit-tested and reused by any caller holding a snapshot. */
export interface WebCapabilityFlags {
  webEnabled: boolean;
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
}

export const webSearchActive = (s: WebCapabilityFlags): boolean =>
  s.webEnabled && s.webSearchEnabled;

export const webFetchActive = (s: WebCapabilityFlags): boolean =>
  s.webEnabled && s.webFetchEnabled;

export interface SettingsInitial {
  surface?: AppSurface;
  mode?: SettingsState["mode"];
  themeId?: ThemeId;
  persona?: string;
  personaCardId?: string;
  personaCards?: PersonaCard[];
  relationshipStyle?: RelationshipStyle;
  talkStyle?: SettingsState["talkStyle"];
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  providerOrder?: string[];
  permissionMode?: PermissionMode;
  dangerousCommandCaching?: boolean;
  webEnabled?: boolean;
  webSearchEnabled?: boolean;
  webFetchEnabled?: boolean;
  searchKeySources?: { kind: string; configured: boolean }[];
  rememberMode?: boolean;
  keepAwakeDuringTasks?: boolean;
  desktopNotifications?: boolean;
  taskModelParsingEnabled?: boolean;
  globalOverviewAutoEnabled?: boolean;
  globalOverviewAutoTime?: string;
  launchAtLogin?: boolean;
  continueInBackground?: boolean;
  quickCaptureShortcut?: string;
  captureStorageRoot?: string;
  defaultWorkspaceId?: string;
  captureFileDropMode?: "reference" | "copy";
  onboardingCompleted?: boolean;
  relationshipInviteDismissed?: boolean;
  relationshipConversationId?: string | null;
  dataDir?: string;
  skillOverrides?: Record<string, boolean>;
}

const DEFAULT_PERSONA_CARD: PersonaCard = {
  id: "momo",
  name: "momo",
  tagline: "温柔而靠谱",
  promptText: "你是 momo。",
  builtin: true,
};

const BUILTIN_PERSONA_CARDS: PersonaCard[] = [
  DEFAULT_PERSONA_CARD,
  {
    id: "momo-entp",
    name: "ENTP 灵感型",
    tagline: "好奇、灵活，善于挑战盲点",
    promptText: "你是 momo，带有 ENTP 风味：思路灵活、好奇，善于联想和挑战盲点。不要为了显得聪明而抬杠；用户任务明确时仍要忠实执行并把事情做完。",
    builtin: true,
  },
  {
    id: "momo-infj",
    name: "INFJ 洞察型",
    tagline: "细腻、耐心，关注长期方向",
    promptText: "你是 momo，带有 INFJ 风味：细腻、耐心，善于理解隐含动机和长期方向。不要过度解读，也不要替用户做决定。",
    builtin: true,
  },
  {
    id: "momo-enfp",
    name: "ENFP 活力型",
    tagline: "开放、有活力，善于发现可能性",
    promptText: "你是 momo，带有 ENFP 风味：开放、有活力，善于发现可能性并把兴趣转成下一步。不要用空泛鼓励替代真实行动。",
    builtin: true,
  },
  {
    id: "momo-entj",
    name: "ENTJ 推进型",
    tagline: "直接、清晰，帮助守住主线",
    promptText: "你是 momo，带有 ENTJ 风味：直接、清晰，重视优先级和推进。可以指出偏离主线，但不能命令、曲解或拒绝用户的正常任务。",
    builtin: true,
  },
];

const isTalkStyle = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;
const isMode = (value: unknown): value is SettingsState["mode"] => value === "buddy" || value === "workbench";
const isSurface = (value: unknown): value is AppSurface => value === "start" || isMode(value);
const isThemeId = (value: unknown): value is ThemeId => (
  typeof value === "string" && THEME_IDS.has(value as ThemeId)
);
const isRelationshipStyle = (value: unknown): value is RelationshipStyle => (
  typeof value === "string" && RELATIONSHIP_STYLE_IDS.has(value as RelationshipStyle)
);
const isPermissionMode = (value: unknown): value is PermissionMode =>
  value === "default" || value === "acceptEdits" || value === "bypassPermissions" || value === "plan";
const isCaptureFileDropMode = (value: unknown): value is "reference" | "copy" =>
  value === "reference" || value === "copy";

function cleanCaptureStorageRoot(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const root = value.trim();
  return root && !/[\u0000-\u001f\u007f]/u.test(root) ? root : undefined;
}

function cleanDefaultWorkspaceId(value: unknown): string | undefined {
  if (value === "leemo-home") return value;
  return typeof value === "string" && /^workspace-[a-f0-9]{20}$/u.test(value) ? value : undefined;
}

export const PERSONA_PROMPT_TEXT_MAX_LENGTH = 2_000;
const PERSONA_LIMITS = {
  cards: 20,
  name: 30,
  tagline: 80,
  promptText: PERSONA_PROMPT_TEXT_MAX_LENGTH,
} as const;
const SAFE_PERSONA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function cleanProviderOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= 100) break;
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function validSkillOverrideId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && !/[\u0000-\u0020]/.test(value);
}

function cleanConversationId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (!clean || clean.length > 160 || /[\u0000-\u001f\u007f]/u.test(clean)) return undefined;
  return clean;
}

function cleanGlobalShortcut(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.trim().split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return undefined;
  const normalized = parts.map((part) => part.toLowerCase());
  const modifiers = new Set(["alt", "ctrl", "control", "command", "commandorcontrol", "shift", "super", "meta"]);
  if (!normalized.slice(0, -1).every((part) => modifiers.has(part))) return undefined;
  if (new Set(normalized.slice(0, -1)).size !== normalized.length - 1) return undefined;
  const key = parts.at(-1) ?? "";
  if (!key || key.length > 24 || /[\s\u0000-\u001f\u007f+]/u.test(key) || modifiers.has(key.toLowerCase())) return undefined;
  return parts.join("+");
}

function cleanSkillOverrides(value: unknown): Record<string, boolean> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= 200) break;
    if (!validSkillOverrideId(id) || typeof enabled !== "boolean") continue;
    out[id] = enabled;
  }
  return out;
}

function cleanPersonaDraft(draft: PersonaCardDraft): Omit<PersonaCard, "builtin"> | null {
  const id = draft.id?.trim();
  const name = draft.name.trim();
  const tagline = draft.tagline.trim();
  const promptText = draft.promptText.trim();
  if (id !== undefined && !SAFE_PERSONA_ID.test(id)) return null;
  if (!name || name.length > PERSONA_LIMITS.name) return null;
  if (!tagline || tagline.length > PERSONA_LIMITS.tagline) return null;
  if (!promptText || promptText.length > PERSONA_LIMITS.promptText) return null;
  return { ...(id ? { id } : { id: "" }), name, tagline, promptText };
}

function readUserPersonaCards(value: unknown, builtinIds: Set<string>): PersonaCard[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cards: PersonaCard[] = [];
  const seen = new Set(builtinIds);
  for (const item of value) {
    if (cards.length >= PERSONA_LIMITS.cards) break;
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" || typeof record.name !== "string"
      || typeof record.tagline !== "string" || typeof record.promptText !== "string"
    ) continue;
    const clean = cleanPersonaDraft({
      id: record.id,
      name: record.name,
      tagline: record.tagline,
      promptText: record.promptText,
    });
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    cards.push({ ...clean, builtin: false });
  }
  return cards;
}

export function createSettingsStore(initial: SettingsInitial = {}): StoreApi<SettingsState> {
  const personaCards = (initial.personaCards ?? BUILTIN_PERSONA_CARDS).map((card) => ({ ...card }));
  const personaCardId = initial.personaCardId && personaCards.some((card) => card.id === initial.personaCardId)
    ? initial.personaCardId
    : personaCards[0]?.id ?? "momo";

  return createStore<SettingsState>((set, get) => ({
    surface: isSurface(initial.surface) ? initial.surface : initial.mode ?? "start",
    mode: initial.mode ?? "buddy",
    themeId: isThemeId(initial.themeId) ? initial.themeId : "white-copper",
    persona: initial.persona ?? "momo",
    personaCardId,
    personaCards,
    relationshipStyle: isRelationshipStyle(initial.relationshipStyle) ? initial.relationshipStyle : "companion",
    talkStyle: initial.talkStyle ?? 3,
    defaultProviderId: initial.defaultProviderId ?? null,
    defaultModelId: initial.defaultModelId ?? null,
    providerOrder: cleanProviderOrder(initial.providerOrder) ?? [],
    permissionMode: initial.permissionMode ?? "acceptEdits",
    dangerousCommandCaching: initial.dangerousCommandCaching ?? false,
    // 统筹开关默认关：联网是用户要主动开的能力，而两个二级开关默认开 —— 用户开
    // 了「联网功能」就该两样都能用，而不是再去点两下才发现刚才那下没生效。
    // 生效值仍然是 false（被统筹开关掩掉），与本卡之前的行为一致。
    webEnabled: initial.webEnabled ?? false,
    webSearchEnabled: initial.webSearchEnabled ?? true,
    webFetchEnabled: initial.webFetchEnabled ?? true,
    searchKeySources: (initial.searchKeySources ?? []).map((source) => ({ ...source })),
    rememberMode: initial.rememberMode ?? true,
    keepAwakeDuringTasks: initial.keepAwakeDuringTasks ?? true,
    desktopNotifications: initial.desktopNotifications ?? true,
    taskModelParsingEnabled: initial.taskModelParsingEnabled ?? true,
    globalOverviewAutoEnabled: initial.globalOverviewAutoEnabled ?? false,
    globalOverviewAutoTime: normalizeGlobalOverviewTime(initial.globalOverviewAutoTime),
    launchAtLogin: initial.launchAtLogin ?? false,
    continueInBackground: initial.continueInBackground ?? true,
    quickCaptureShortcut: cleanGlobalShortcut(initial.quickCaptureShortcut) ?? "Alt+N",
    captureStorageRoot: cleanCaptureStorageRoot(initial.captureStorageRoot),
    defaultWorkspaceId: cleanDefaultWorkspaceId(initial.defaultWorkspaceId) ?? "leemo-home",
    captureFileDropMode: isCaptureFileDropMode(initial.captureFileDropMode) ? initial.captureFileDropMode : "reference",
    onboardingCompleted: initial.onboardingCompleted ?? false,
    relationshipInviteDismissed: initial.relationshipInviteDismissed ?? false,
    relationshipConversationId: cleanConversationId(initial.relationshipConversationId) ?? null,
    dataDir: initial.dataDir ?? "",
    skillOverrides: cleanSkillOverrides(initial.skillOverrides) ?? {},

    setMode: (mode) => {
      if (isMode(mode)) set({ mode, surface: mode });
    },
    setSurface: (surface) => {
      if (!isSurface(surface)) return;
      set((state) => ({
        surface,
        mode: surface === "start" ? state.mode : surface,
      }));
    },
    setPersonaCard: (id) => {
      if (get().personaCards.some((card) => card.id === id)) set({ personaCardId: id });
    },
    setRelationshipStyle: (relationshipStyle) => {
      if (isRelationshipStyle(relationshipStyle)) set({ relationshipStyle });
    },
    upsertPersonaCard: (draft) => {
      const clean = cleanPersonaDraft(draft);
      if (!clean) return null;
      const current = get().personaCards;
      const existing = clean.id ? current.find((card) => card.id === clean.id) : undefined;
      if (existing?.builtin) return null;

      let id = clean.id;
      if (!id) {
        let sequence = 1;
        do id = `custom-${sequence++}`;
        while (current.some((card) => card.id === id));
      }
      const card: PersonaCard = { ...clean, id, builtin: false };
      const personaCards = existing
        ? current.map((candidate) => candidate.id === id ? card : candidate)
        : [...current, card];
      set({ personaCards, personaCardId: id });
      return id;
    },
    deletePersonaCard: (id) => {
      const current = get();
      const target = current.personaCards.find((card) => card.id === id);
      if (!target || target.builtin) return;
      const personaCards = current.personaCards.filter((card) => card.id !== id);
      set({
        personaCards,
        personaCardId: current.personaCardId === id
          ? personaCards.find((card) => card.builtin)?.id ?? personaCards[0]?.id ?? "momo"
          : current.personaCardId,
      });
    },
    setTalkStyle: (talkStyle) => {
      if (isTalkStyle(talkStyle)) set({ talkStyle });
    },
    setDefaultModel: (providerOrModel, modelId) => {
      if (typeof providerOrModel !== "string" && providerOrModel !== null) return;
      if (modelId === undefined) {
        set({ defaultModelId: providerOrModel });
      } else if (typeof modelId === "string" || modelId === null) {
        set({ defaultProviderId: providerOrModel, defaultModelId: modelId });
      }
    },
    setProviderOrder: (ids) => {
      const providerOrder = cleanProviderOrder(ids);
      if (!providerOrder) return;
      set({
        providerOrder,
        // Compatibility for older builds. The model half is synchronized by
        // the ordering UI, which has access to the provider's first model.
        defaultProviderId: providerOrder[0] ?? null,
        ...(providerOrder.length === 0 ? { defaultModelId: null } : {}),
      });
    },
    setPermissionMode: (permissionMode) => {
      if (isPermissionMode(permissionMode)) set({ permissionMode });
    },
    setDangerousCommandCaching: (dangerousCommandCaching) => {
      if (typeof dangerousCommandCaching === "boolean") set({ dangerousCommandCaching });
    },
    setWebEnabled: (webEnabled) => {
      // Deliberately does NOT touch the two sub-switches: masking (not
      // clobbering) is what lets the user come back to their own two choices.
      if (typeof webEnabled === "boolean") set({ webEnabled });
    },
    setWebSearchEnabled: (webSearchEnabled) => {
      if (typeof webSearchEnabled === "boolean") set({ webSearchEnabled });
    },
    setWebFetchEnabled: (webFetchEnabled) => {
      if (typeof webFetchEnabled === "boolean") set({ webFetchEnabled });
    },
    setRememberMode: (rememberMode) => {
      if (typeof rememberMode === "boolean") set({ rememberMode });
    },
    setKeepAwakeDuringTasks: (keepAwakeDuringTasks) => {
      if (typeof keepAwakeDuringTasks === "boolean") set({ keepAwakeDuringTasks });
    },
    setDesktopNotifications: (desktopNotifications) => {
      if (typeof desktopNotifications === "boolean") set({ desktopNotifications });
    },
    setTaskModelParsingEnabled: (taskModelParsingEnabled) => {
      if (typeof taskModelParsingEnabled === "boolean") set({ taskModelParsingEnabled });
    },
    setThemeId: (themeId) => {
      if (isThemeId(themeId)) set({ themeId });
    },
    setGlobalOverviewAutoEnabled: (globalOverviewAutoEnabled) => {
      if (typeof globalOverviewAutoEnabled === "boolean") set({ globalOverviewAutoEnabled });
    },
    setGlobalOverviewAutoTime: (globalOverviewAutoTime) => {
      if (isValidGlobalOverviewTime(globalOverviewAutoTime)) {
        set({ globalOverviewAutoTime: normalizeGlobalOverviewTime(globalOverviewAutoTime) });
      }
    },
    setLaunchAtLogin: (launchAtLogin) => {
      if (typeof launchAtLogin === "boolean") set({ launchAtLogin });
    },
    setContinueInBackground: (continueInBackground) => {
      if (typeof continueInBackground === "boolean") set({ continueInBackground });
    },
    setQuickCaptureShortcut: (value) => {
      const quickCaptureShortcut = cleanGlobalShortcut(value);
      if (quickCaptureShortcut) set({ quickCaptureShortcut });
    },
    setCaptureStorageRoot: (value) => {
      const captureStorageRoot = cleanCaptureStorageRoot(value);
      if (captureStorageRoot) set({ captureStorageRoot });
    },
    setDefaultWorkspaceId: (value) => {
      const defaultWorkspaceId = cleanDefaultWorkspaceId(value);
      if (defaultWorkspaceId) set({ defaultWorkspaceId });
    },
    setCaptureFileDropMode: (captureFileDropMode) => {
      if (isCaptureFileDropMode(captureFileDropMode)) set({ captureFileDropMode });
    },
    completeOnboarding: () => set({ onboardingCompleted: true }),
    dismissRelationshipInvite: () => set({ relationshipInviteDismissed: true }),
    setRelationshipConversationId: (value) => {
      const relationshipConversationId = cleanConversationId(value);
      if (relationshipConversationId !== undefined) set({ relationshipConversationId });
    },
    setSkillOverride: (id, enabled) => {
      if (!validSkillOverrideId(id) || typeof enabled !== "boolean") return;
      set((state) => ({ skillOverrides: { ...state.skillOverrides, [id]: enabled } }));
    },
    clearSkillOverride: (id) => {
      if (!validSkillOverrideId(id)) return;
      set((state) => {
        if (!(id in state.skillOverrides)) return state;
        const skillOverrides = { ...state.skillOverrides };
        delete skillOverrides[id];
        return { skillOverrides };
      });
    },

    hydrate: (persisted) => {
      if (persisted === null || typeof persisted !== "object") return;
      const patch: Partial<SettingsState> = {};
      const bool = (k: keyof SettingsState) => {
        const v = persisted[k as string];
        if (typeof v === "boolean") (patch as Record<string, unknown>)[k] = v;
      };
      const str = (k: keyof SettingsState) => {
        const v = persisted[k as string];
        // null is meaningful for the two default-model fields ("not set").
        if (typeof v === "string" || v === null) (patch as Record<string, unknown>)[k] = v;
      };

      if (isMode(persisted.mode)) patch.mode = persisted.mode;
      if (isSurface(persisted.surface)) patch.surface = persisted.surface;
      else if (isMode(persisted.mode)) patch.surface = persisted.mode;
      if (isThemeId(persisted.themeId)) patch.themeId = persisted.themeId;
      if (isTalkStyle(persisted.talkStyle)) patch.talkStyle = persisted.talkStyle;
      if (isRelationshipStyle(persisted.relationshipStyle)) patch.relationshipStyle = persisted.relationshipStyle;
      if (isPermissionMode(persisted.permissionMode)) patch.permissionMode = persisted.permissionMode;
      const currentCards = get().personaCards;
      const builtinCards = currentCards.filter((card) => card.builtin);
      const userCards = readUserPersonaCards(
        persisted.userPersonaCards,
        new Set(builtinCards.map((card) => card.id)),
      );
      const hydratedCards = userCards === undefined ? currentCards : [...builtinCards, ...userCards];
      if (userCards !== undefined) patch.personaCards = hydratedCards;
      // Only accept a card id that actually exists in THIS build's card list —
      // otherwise a card removed in a later version would leave the user with a
      // dangling id and momo silently running with an empty persona.
      if (
        typeof persisted.personaCardId === "string" &&
        hydratedCards.some((c) => c.id === persisted.personaCardId)
      ) {
        patch.personaCardId = persisted.personaCardId;
      } else if (userCards !== undefined && !hydratedCards.some((card) => card.id === get().personaCardId)) {
        patch.personaCardId = builtinCards[0]?.id ?? hydratedCards[0]?.id ?? "momo";
      }
      str("defaultProviderId");
      str("defaultModelId");
      const providerOrder = cleanProviderOrder(persisted.providerOrder);
      if (providerOrder !== undefined) patch.providerOrder = providerOrder;
      const skillOverrides = cleanSkillOverrides(persisted.skillOverrides);
      if (skillOverrides !== undefined) patch.skillOverrides = skillOverrides;
      bool("dangerousCommandCaching");
      bool("webEnabled");
      bool("webSearchEnabled");
      bool("webFetchEnabled");
      bool("rememberMode");
      bool("keepAwakeDuringTasks");
      bool("desktopNotifications");
      bool("taskModelParsingEnabled");
      bool("globalOverviewAutoEnabled");
      if (isValidGlobalOverviewTime(persisted.globalOverviewAutoTime)) {
        patch.globalOverviewAutoTime = normalizeGlobalOverviewTime(persisted.globalOverviewAutoTime);
      }
      bool("launchAtLogin");
      bool("continueInBackground");
      const quickCaptureShortcut = cleanGlobalShortcut(persisted.quickCaptureShortcut);
      if (quickCaptureShortcut) patch.quickCaptureShortcut = quickCaptureShortcut;
      const captureStorageRoot = cleanCaptureStorageRoot(persisted.captureStorageRoot);
      if (captureStorageRoot) patch.captureStorageRoot = captureStorageRoot;
      const defaultWorkspaceId = cleanDefaultWorkspaceId(persisted.defaultWorkspaceId);
      if (defaultWorkspaceId) patch.defaultWorkspaceId = defaultWorkspaceId;
      if (isCaptureFileDropMode(persisted.captureFileDropMode)) {
        patch.captureFileDropMode = persisted.captureFileDropMode;
      }
      bool("onboardingCompleted");
      bool("relationshipInviteDismissed");
      const relationshipConversationId = cleanConversationId(persisted.relationshipConversationId);
      if (relationshipConversationId !== undefined) patch.relationshipConversationId = relationshipConversationId;
      set(patch);
    },
  }));
}
