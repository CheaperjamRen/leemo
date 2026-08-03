import { createStore, type StoreApi } from "zustand/vanilla";
import type { PermissionMode } from "../../bridge/contract";

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

export interface SettingsState {
  mode: "buddy" | "workbench";
  persona: string;
  personaCardId: string;
  personaCards: PersonaCard[];
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
  onboardingCompleted: boolean;
  dataDir: string;
  /** Stable built-in/custom skill ids whose enabled state differs from the
   * catalog default. Kept separate from display names so renaming a skill does
   * not silently re-enable it. */
  skillOverrides: Record<string, boolean>;

  setMode(mode: SettingsState["mode"]): void;
  setPersonaCard(id: string): void;
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
  completeOnboarding(): void;
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
  "mode",
  "personaCardId",
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
  "onboardingCompleted",
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
  mode?: SettingsState["mode"];
  persona?: string;
  personaCardId?: string;
  personaCards?: PersonaCard[];
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
  onboardingCompleted?: boolean;
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

const isTalkStyle = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;
const isMode = (value: unknown): value is SettingsState["mode"] => value === "buddy" || value === "workbench";
const isPermissionMode = (value: unknown): value is PermissionMode =>
  value === "default" || value === "acceptEdits" || value === "bypassPermissions" || value === "plan";

const PERSONA_LIMITS = { cards: 20, name: 30, tagline: 80, promptText: 2_000 } as const;
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
  const personaCards = (initial.personaCards ?? [DEFAULT_PERSONA_CARD]).map((card) => ({ ...card }));
  const personaCardId = initial.personaCardId && personaCards.some((card) => card.id === initial.personaCardId)
    ? initial.personaCardId
    : personaCards[0]?.id ?? "momo";

  return createStore<SettingsState>((set, get) => ({
    mode: initial.mode ?? "buddy",
    persona: initial.persona ?? "momo",
    personaCardId,
    personaCards,
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
    onboardingCompleted: initial.onboardingCompleted ?? false,
    dataDir: initial.dataDir ?? "",
    skillOverrides: cleanSkillOverrides(initial.skillOverrides) ?? {},

    setMode: (mode) => {
      if (isMode(mode)) set({ mode });
    },
    setPersonaCard: (id) => {
      if (get().personaCards.some((card) => card.id === id)) set({ personaCardId: id });
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
    completeOnboarding: () => set({ onboardingCompleted: true }),
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
      if (isTalkStyle(persisted.talkStyle)) patch.talkStyle = persisted.talkStyle;
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
      bool("onboardingCompleted");
      set(patch);
    },
  }));
}
