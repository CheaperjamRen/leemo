import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  BridgeInvokeMap,
  CommunitySkillView,
  SkillInfo,
  SkillMutationItem,
  SkillSourceInspectionView,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";

export interface SkillPreferenceAdapter {
  get(id: string): boolean | undefined;
  set(id: string, enabled: boolean): void;
  restore(id: string, previous: boolean | undefined): void;
}

export interface SkillsState {
  list: SkillInfo[];
  community: CommunitySkillView[];
  /** Stable ids whose switch is off. Legacy custom skills without an id use
   * their bare name until the host returns a stable id. */
  disabled: string[];
  status: "loading" | "ready" | "error";
  error?: string;
  adminStatus: "idle" | "picking" | "inspecting" | "installing" | "scanning" | "removing";
  adminError?: string;
  inspectedSource?: string;
  inspection?: SkillSourceInspectionView;
  scanResult?: SkillMutationItem;
  receipt?: string;
  refresh(): Promise<void>;
  /** Flip one skill by stable id (bare name remains accepted for old callers). */
  toggle(idOrName: string): void;
  openDir(): Promise<void>;
  pickSource(kind: "archive" | "folder"): Promise<string | undefined>;
  inspectSource(source: string, securityScan?: boolean): Promise<SkillSourceInspectionView | undefined>;
  installSource(request: BridgeInvokeMap["bridge:installSkill"]["request"]): Promise<boolean>;
  installCommunity(id: string): Promise<boolean>;
  scanInstalled(id: string): Promise<boolean>;
  removeSkill(id: string): Promise<boolean>;
  clearAdminFeedback(): void;
}

function skillKey(skill: SkillInfo): string {
  return skill.id ?? skill.name;
}

function findSkill(list: SkillInfo[], idOrName: string): SkillInfo | undefined {
  return list.find((skill) => skillKey(skill) === idOrName || skill.name === idOrName);
}

/** Enabled skills as SDK-qualified names. Unavailable skills never reach the
 * host, even if a stale preference says they were enabled. */
export function selectEnabledQualifiedNames(
  state: Pick<SkillsState, "list" | "disabled">,
): string[] {
  return state.list
    .filter((skill) => skill.available !== false && !state.disabled.includes(skillKey(skill)))
    .map((skill) => skill.qualifiedName);
}

/** `undefined` means no catalog has been loaded yet; an empty array means the
 * loaded catalog is intentionally all off. The host applies the same distinction
 * and closes both plugin paths when the latter is sent. */
export function resolveEnabledSkills(
  state: Pick<SkillsState, "list" | "disabled">,
): string[] | undefined {
  if (state.list.length === 0) return undefined;
  return selectEnabledQualifiedNames(state);
}

export function createSkillsStore(
  client: BridgeClient,
  preferences?: SkillPreferenceAdapter,
): StoreApi<SkillsState> {
  const toggleVersions = new Map<string, number>();
  let preparationPoll: ReturnType<typeof setTimeout> | undefined;

  return createStore<SkillsState>((set, get) => {
    const applyList = (list: SkillInfo[]): void => {
      set((state) => {
        const disabled = preferences
          ? list
            .filter((skill) => (preferences.get(skillKey(skill)) ?? skill.defaultEnabled ?? true) === false)
            .map(skillKey)
          : state.disabled.filter((id) => list.some((skill) => skillKey(skill) === id));
        return {
          list: list.map((skill) => ({ ...skill })),
          status: "ready",
          error: undefined,
          disabled,
        };
      });
    };

    const schedulePreparationRefresh = (list: SkillInfo[]): void => {
      if (preparationPoll !== undefined) clearTimeout(preparationPoll);
      preparationPoll = undefined;
      const preparing = list.some((skill) => (
        skill.available === false
        && skill.unavailableReason?.includes("正在准备")
      ));
      if (!preparing) return;
      preparationPoll = setTimeout(() => {
        preparationPoll = undefined;
        void (async () => {
          try {
            await reloadAll();
            // A conversation created while the page was open may already be
            // alive. Make the newly ready adapter visible on its next turn too.
            await syncCurrentList();
          } catch {
            // The page keeps its last honest state. A manual refresh or the
            // next app start will retry without turning a background nicety
            // into a blocking error surface.
          }
        })();
      }, 1_500);
    };

    const reloadList = async (): Promise<void> => {
      const list = await client.invoke("bridge:listSkills", undefined);
      applyList(list);
      schedulePreparationRefresh(list);
    };

    const reloadAll = async (): Promise<void> => {
      const [list, community] = await Promise.all([
        client.invoke("bridge:listSkills", undefined),
        client.invoke("bridge:listCommunitySkills", undefined),
      ]);
      applyList(list);
      set({ community: (community ?? []).map((entry) => ({ ...entry })) });
      schedulePreparationRefresh(list);
    };

    const syncCurrentList = async (): Promise<void> => {
      await client.invoke("bridge:syncEnabledSkills", {
        enabledQualifiedNames: resolveEnabledSkills(get()) ?? [],
      });
    };

    const messageOf = (error: unknown, fallback: string): string => (
      error instanceof Error && error.message.trim() ? error.message : fallback
    );

    return {
      list: [],
      community: [],
      disabled: [],
      status: "loading",
      adminStatus: "idle",

      refresh: async () => {
        try {
          await reloadAll();
        } catch (error: unknown) {
          set({
            status: "error",
            error: messageOf(error, "技能目录读取失败。"),
          });
        }
      },

      toggle: (idOrName) => {
        const skill = findSkill(get().list, idOrName);
        if (!skill || skill.available === false) return;
        const id = skillKey(skill);
        const previousOverride = preferences?.get(id);
        const currentlyDisabled = get().disabled.includes(id);
        const nextDisabled = !currentlyDisabled;
        const version = (toggleVersions.get(id) ?? 0) + 1;
        toggleVersions.set(id, version);

        set((state) => ({
          disabled: nextDisabled
            ? [...state.disabled, id]
            : state.disabled.filter((candidate) => candidate !== id),
          error: undefined,
        }));
        preferences?.set(id, !nextDisabled);

        void (async () => {
          try {
            await syncCurrentList();
          } catch (error: unknown) {
            // A stale failed request must not undo a newer click on the same row.
            if (toggleVersions.get(id) !== version) return;
            set((state) => ({
              disabled: nextDisabled
                ? state.disabled.filter((candidate) => candidate !== id)
                : [...state.disabled, id],
              error: messageOf(error, "技能开关没有生效。"),
            }));
            preferences?.restore(id, previousOverride);
          }
        })();
      },

      openDir: async () => {
        try {
          await client.invoke("bridge:openSkillsDir", undefined);
        } catch {
          // The directory action is best-effort; keep the page usable if the OS
          // opener is unavailable (browser dev and locked-down desktops).
        }
      },

      pickSource: async (kind) => {
        set({ adminStatus: "picking", adminError: undefined, receipt: undefined });
        try {
          const result = await client.invoke("bridge:pickSkillSource", { kind });
          set({ adminStatus: "idle" });
          return result.path;
        } catch (error: unknown) {
          set({ adminStatus: "idle", adminError: messageOf(error, "没有打开本地 Skill。") });
          return undefined;
        }
      },

      inspectSource: async (source, securityScan = false) => {
        const clean = source.trim();
        if (!clean) {
          set({ adminError: "请粘贴 Skill 链接，或选择一个 ZIP / 文件夹。" });
          return undefined;
        }
        set({
          adminStatus: "inspecting",
          adminError: undefined,
          receipt: undefined,
          inspection: undefined,
          inspectedSource: clean,
        });
        try {
          const inspection = await client.invoke("bridge:inspectSkillSource", { source: clean, securityScan });
          set({ adminStatus: "idle", inspection });
          return inspection;
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            inspection: undefined,
            adminError: messageOf(error, securityScan ? "这个 Skill 没有完成安全扫描。" : "无法读取这个 Skill 来源。"),
          });
          return undefined;
        }
      },

      installSource: async (request) => {
        set({ adminStatus: "installing", adminError: undefined, receipt: undefined });
        let outcome: Awaited<ReturnType<BridgeClient["invoke"]>>;
        try {
          outcome = await client.invoke("bridge:installSkill", request);
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            adminError: messageOf(error, "这个 Skill 没有安装，现有技能未改动。"),
          });
          return false;
        }

        const installed = outcome as BridgeInvokeMap["bridge:installSkill"]["response"];
        try {
          await reloadAll();
          await syncCurrentList();
          set({
            adminStatus: "idle",
            adminError: undefined,
            receipt: installed.receipt,
            inspection: undefined,
            inspectedSource: undefined,
          });
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            receipt: installed.receipt,
            adminError: `Skill 已安装，但页面刷新失败：${messageOf(error, "请重新打开技能页。")}`,
          });
        }
        return true;
      },

      installCommunity: async (id) => {
        set({ adminStatus: "installing", adminError: undefined, receipt: undefined, scanResult: undefined });
        let installed: BridgeInvokeMap["bridge:installCommunitySkill"]["response"];
        try {
          installed = await client.invoke("bridge:installCommunitySkill", { id });
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            adminError: messageOf(error, "这个社区 Skill 没有安装，现有技能未改动。"),
          });
          return false;
        }
        try {
          await reloadAll();
          await syncCurrentList();
          set({ adminStatus: "idle", receipt: installed.receipt, adminError: undefined });
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            receipt: installed.receipt,
            adminError: `Skill 已安装，但页面刷新失败：${messageOf(error, "请重新打开技能页。")}`,
          });
        }
        return true;
      },

      scanInstalled: async (id) => {
        set({ adminStatus: "scanning", adminError: undefined, receipt: undefined, scanResult: undefined });
        try {
          const scanResult = await client.invoke("bridge:scanInstalledSkill", { id });
          set((state) => ({
            adminStatus: "idle",
            scanResult,
            list: state.list.map((skill) => (
              skill.id === scanResult.id || skill.name === scanResult.name
                ? {
                    ...skill,
                    scanStatus: scanResult.scanStatus,
                    securityFindings: scanResult.securityFindings?.map((finding) => ({ ...finding })),
                  }
                : skill
            )),
          }));
          return true;
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            adminError: messageOf(error, "这个 Skill 没有完成安全扫描。"),
          });
          return false;
        }
      },

      removeSkill: async (id) => {
        const skill = findSkill(get().list, id);
        set({ adminStatus: "removing", adminError: undefined, receipt: undefined });
        try {
          await client.invoke("bridge:removeSkill", { id });
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            adminError: messageOf(error, "这个 Skill 没有卸载，文件未改动。"),
          });
          return false;
        }
        try {
          await reloadAll();
          await syncCurrentList();
          set({ adminStatus: "idle", receipt: `已卸载 ${skill?.name ?? "Skill"}` });
        } catch (error: unknown) {
          set({
            adminStatus: "idle",
            receipt: `已卸载 ${skill?.name ?? "Skill"}`,
            adminError: `Skill 已卸载，但页面刷新失败：${messageOf(error, "请重新打开技能页。")}`,
          });
        }
        return true;
      },

      clearAdminFeedback: () => set({
        adminError: undefined,
        receipt: undefined,
        inspection: undefined,
        inspectedSource: undefined,
        scanResult: undefined,
      }),
    };
  });
}
