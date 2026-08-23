import { createContext, useContext, useMemo, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { BridgeClient } from "./client";
import { FixtureBridgeClient } from "./fixture-client";
import { FIXTURE_NOTIFICATIONS, FIXTURE_PROVIDERS, FIXTURE_FILE_TREE, FIXTURE_MCP_SERVERS, FIXTURE_NOTEBOOKS, FIXTURE_PREVIEW_ENTRIES } from "./fixtures";
import { createConversationsStore, type ConversationsState } from "../stores/conversations";
import {
  createSettingsStore,
  resolveMomoPersonaText,
  webFetchActive,
  webSearchActive,
  type SettingsState,
} from "../stores/settings";
import { createNotificationsStore, type NotificationsState } from "../stores/notifications";
import { createApprovalsStore, type ApprovalsState } from "../stores/approvals";
import { createArtifactsStore, deriveArtifactsFromConversations, type ArtifactsState } from "../stores/artifacts";
import { createWikiEntriesStore, type WikiState } from "../stores/wiki-entries";
import { createProvidersStore, type ProvidersState } from "../stores/providers";
import { createUiStore, type UiState } from "../stores/ui";
import { createNotebooksStore, type NotebooksState } from "../stores/notebooks";
import { createFileTreeStore, type FileTreeState } from "../stores/file-tree";
import { createSkillsStore, resolveEnabledSkills, type SkillsState } from "../stores/skills";
import { createSearchSourcesStore, type SearchSourcesState } from "../stores/search-sources";
import { createPreviewContentStore, type PreviewContentState } from "../stores/preview-content";
import { createMcpServersStore, type McpServersState } from "../stores/mcp-servers";
import { createUsageSummaryStore, type UsageSummaryState } from "../stores/usage-summary";
import {
  createContextUsageStore,
  deriveContextUsageFromTimelines,
  type ContextUsageState,
} from "../stores/context-usage";
import { createMemoryStore, type MemoryState } from "../stores/memory";
import { createWorkspacesStore, HOME_WORKSPACE_ID, type WorkspacesState } from "../stores/workspaces";
import { createScheduledTasksStore, type ScheduledTasksState } from "../stores/scheduled-tasks";
import { createComposerDraftsStore, type ComposerDraftsState } from "../stores/composer-drafts";
import { orderConfiguredProviders } from "../components/model-picker";
import { wireBridgeSubscriptions } from "./wiring";
import type { PersistenceClient } from "../persistence/client";
import { MemoryLearningClient, type LearningClient } from "../learning/client";
import { createLearningStore, type LearningState } from "../stores/learning";
import { startPersistenceSync } from "../persistence/sync";
import type { WorkspaceClient } from "../workspace/client";
import type { SchedulerClient } from "../scheduler/client";
import { MemorySchedulerClient } from "../scheduler/client";
import type { CaptureClient } from "../capture/client";
import { createCapturesStore, type CapturesState } from "../stores/captures";
import type { TaskClient } from "../tasks/client";
import { createTasksStore, type TasksState } from "../stores/tasks";
import { startStore } from "../stores/start";
import {
  createGlobalPendingOverviewStore,
  type GlobalPendingOverviewState,
} from "../stores/global-pending-overview";
import { buildGlobalOverviewFactPack } from "../global-overview/facts";

export interface BridgeStores {
  conversations: ReturnType<typeof createConversationsStore>;
  settings: ReturnType<typeof createSettingsStore>;
  notifications: ReturnType<typeof createNotificationsStore>;
  approvals: ReturnType<typeof createApprovalsStore>;
  artifacts: ReturnType<typeof createArtifactsStore>;
  wikiEntries: ReturnType<typeof createWikiEntriesStore>;
  providers: ReturnType<typeof createProvidersStore>;
  ui: ReturnType<typeof createUiStore>;
  notebooks: ReturnType<typeof createNotebooksStore>;
  fileTree: ReturnType<typeof createFileTreeStore>;
  skills: ReturnType<typeof createSkillsStore>;
  searchSources: ReturnType<typeof createSearchSourcesStore>;
  previewContent: ReturnType<typeof createPreviewContentStore>;
  mcpServers: ReturnType<typeof createMcpServersStore>;
  usageSummary: ReturnType<typeof createUsageSummaryStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  contextUsage?: ReturnType<typeof createContextUsageStore>;
  memory: ReturnType<typeof createMemoryStore>;
  /** Optional only for legacy component fixtures; BridgeProvider always supplies it. */
  scheduledTasks?: ReturnType<typeof createScheduledTasksStore>;
  /** Optional only for old isolated fixtures; BridgeProvider always supplies it. */
  learning?: ReturnType<typeof createLearningStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  workspaces?: ReturnType<typeof createWorkspacesStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  composerDrafts?: ReturnType<typeof createComposerDraftsStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  captures?: ReturnType<typeof createCapturesStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  tasks?: ReturnType<typeof createTasksStore>;
  /** Optional only for old isolated component fixtures; BridgeProvider always supplies it. */
  globalPendingOverview?: ReturnType<typeof createGlobalPendingOverviewStore>;
}

const Ctx = createContext<BridgeStores | null>(null);
const WorkspaceCtx = createContext<WorkspaceClient | undefined>(undefined);
const ClientCtx = createContext<BridgeClient | undefined>(undefined);

async function refreshAndSyncSkills(stores: BridgeStores, client: BridgeClient): Promise<void> {
  await stores.skills.getState().refresh();
  const state = stores.skills.getState();
  if (state.status !== "ready") return;
  const enabledQualifiedNames = resolveEnabledSkills(state);
  if (enabledQualifiedNames === undefined) return;
  await client.invoke("bridge:syncEnabledSkills", { enabledQualifiedNames });
}

export function BridgeProvider({ client, live, persist, workspace, scheduler, learning, capture, tasks, children }: { client?: BridgeClient; live?: boolean; persist?: PersistenceClient; workspace?: WorkspaceClient; scheduler?: SchedulerClient; learning?: LearningClient; capture?: CaptureClient; tasks?: TaskClient; children: ReactNode }) {
  // A persisted workbench mode must be known before either shell renders. Apart
  // from the visible buddy→workbench flash, rendering early let a fast click
  // mutate defaults that hydration then overwrote a moment later.
  const [persistenceReady, setPersistenceReady] = useState(persist === undefined);
  // Browser dev has no injected transport. Its fixture must be ONE shared
  // client: conversations invoke on it and wiring subscribes to that exact
  // instance. Creating a fallback independently in both places sent to A while
  // listening to B, leaving every demo turn permanently "running".
  const fixtureClient = useMemo(() => new FixtureBridgeClient(), []);
  const activeClient = client ?? fixtureClient;
  const fallbackScheduler = useMemo(() => new MemorySchedulerClient(), []);
  const activeScheduler = scheduler ?? fallbackScheduler;
  const fallbackLearning = useMemo(() => new MemoryLearningClient(), []);
  const activeLearning = learning ?? fallbackLearning;

  const stores = useMemo<BridgeStores>(() => {
    const c = activeClient;
    const settings = createSettingsStore();
    const providers = live
      ? createProvidersStore(c, {})
      : createProvidersStore(c, { list: FIXTURE_PROVIDERS, configuredIds: FIXTURE_PROVIDERS.map(p => p.id) });
    const resolveDefaults = live
      ? () => {
          const list = providers.getState().list;
          const { providerOrder, defaultProviderId, defaultModelId } = settings.getState();
          const first = orderConfiguredProviders(list, providerOrder, {
            providerId: defaultProviderId,
            modelId: defaultModelId,
          })[0];
          return first
            ? { providerId: first.id, modelId: first.models[0] }
            : { providerId: "deepseek", modelId: "deepseek-v4-flash" };
        }
      : () => ({
          providerId: FIXTURE_PROVIDERS[0].id,
          modelId: FIXTURE_PROVIDERS[0].models[0],
        });

    // momo's prompt layers ③④⑤⑦ come from settings, resolved per create so a
    // mode/card/slider change lands on the next conversation. The card BODY is
    // sent (not its id): the host has no card registry to resolve an id with.
    const resolvePersonaContext = () => {
      const s = settings.getState();
      const card = s.personaCards.find((c) => c.id === s.personaCardId);
      return {
        mode: s.mode,
        personaText: resolveMomoPersonaText(card?.promptText ?? "", s.relationshipStyle),
        talkStyle: s.talkStyle,
        // 轮 4 卡 H2: 真读设置页的开关（此前钉死 false，于是层⑦ 恒说"不能搜"、
        // host 也永不发搜索工具 —— 联网能力在界面上根本到不了）。
        // 开关为真时 host 起本地搜索 shim 并放行 CC 内置 WebSearch；shim 起不来
        // 才退回自建 MCP。两条路互斥，见 chooseSearchWiring。
        //
        // 轮 4「三层开关」: 送**生效值**（统筹开关已掩过），不是设置页那两个原始
        // 字段 —— 三层结构是界面的事，host 只该收到"这轮能不能搜/能不能抓"。
        webSearchEnabled: webSearchActive(s),
        webFetchEnabled: webFetchActive(s),
        // 轮 7 A4: 此前这两个字段**从来没送过** —— 设置页的「权限策略」整组是死
        // 控件：用户开启完全访问想让 momo 别再弹卡，什么也不会发生（host 侧
        // r.permissionMode 恒 undefined ⇒ broker 永远用默认策略）。
        permissionMode: s.permissionMode,
        dangerousCommandCaching: s.dangerousCommandCaching,
        rememberMode: s.rememberMode,
      };
    };

    const skills = createSkillsStore(c, {
      get: (id) => settings.getState().skillOverrides[id],
      set: (id, enabled) => settings.getState().setSkillOverride(id, enabled),
      restore: (id, previous) => {
        if (previous === undefined) settings.getState().clearSkillOverride(id);
        else settings.getState().setSkillOverride(id, previous);
      },
    });
    // Hydration can take a moment on a cold Electron start. Keep one shared
    // promise so the first create/re-claim waits for the catalog exactly once,
    // while the settings adapter above reads the already-restored preferences
    // when the promise is consumed.
    let skillsReadyPromise: Promise<void> | undefined;
    const ensureSkillsReady = () => {
      if (skills.getState().status === "ready") return Promise.resolve();
      skillsReadyPromise ??= skills.getState().refresh();
      return skillsReadyPromise;
    };
    // 轮 4 卡 H2: 搜索源 key 的配置面。不在这里 refresh —— 设置页打开时才拉，
    // 免得每次起 app 都去解一次加密件。
    const searchSources = createSearchSourcesStore(c);
    const mcpServers = createMcpServersStore(c, live ? [] : FIXTURE_MCP_SERVERS);
    const usageSummary = createUsageSummaryStore(c);
    const contextUsage = createContextUsageStore();
    const memory = createMemoryStore(c);

    // Resolved per create (like persona) so switching a skill off lands on the
    // NEXT conversation. resolveEnabledSkills owns the undefined-vs-[] call:
    // undefined = "no Leemo skills installed, leave CLI defaults alone",
    // [] = "installed but all switched off" (sdk.d.ts:1877 — these differ).
    const resolveEnabledSkillNames = () => resolveEnabledSkills(skills.getState());

    const workspaces = createWorkspacesStore(workspace);
    const composerDrafts = createComposerDraftsStore();
    const captures = createCapturesStore(capture);
    const taskStore = createTasksStore(tasks);
    const notebooks = createNotebooksStore(workspace, workspace ? [] : FIXTURE_NOTEBOOKS);
    const fileTree = createFileTreeStore(workspace, workspace ? [] : FIXTURE_FILE_TREE, {
      resolveWorkspaceId: () => workspaces.getState().activeId,
    });

    const conversations = createConversationsStore(c, {
      resolveConversationDefaults: resolveDefaults,
      resolvePersonaContext,
      resolveEnabledSkills: resolveEnabledSkillNames,
      ensureSkillsReady,
      // 轮 3 卡 G: whichever 本子 the user is working in becomes the new
      // conversation's bookId, which the host turns into prompt layer ⑨
      // (<notebook>/CLAUDE.md, 06 §7.4 中期层). Resolved per create — same rule
      // as persona/skills — so switching notebooks affects the NEXT conversation.
      resolveActiveNotebook: () => {
        const selected = workspaces.getState();
        const kind = selected.list.find((entry) => entry.id === selected.activeId)?.kind ?? "home";
        return kind === "home" ? notebooks.getState().activeId : null;
      },
      resolveActiveWorkspaceId: () => workspaces.getState().activeId,
      // Lifecycle commands (pin/archive/move/delete) are deliberate user
      // actions and must finish in portable storage before the UI claims they
      // succeeded. Normal streaming still uses the debounced synchronizer.
      ...(persist ? { persistence: persist } : {}),
      onConversationMoved: (conversationId) => {
        composerDrafts.getState().relocateConversation(conversationId);
      },
      onConversationDeleted: (conversationId) => {
        composerDrafts.getState().detachConversation(conversationId);
        contextUsage.setState((state) => {
          if (!state.byConversation[conversationId]) return state;
          const byConversation = { ...state.byConversation };
          delete byConversation[conversationId];
          return { byConversation };
        });
      },
    });
    const approvals = createApprovalsStore(c, {});
    const artifacts = createArtifactsStore();
    const wikiEntries = createWikiEntriesStore(c, { resolveConversationDefaults: resolveDefaults });
    const notifications = createNotificationsStore(live ? [] : FIXTURE_NOTIFICATIONS);
    const globalPendingOverview = createGlobalPendingOverviewStore(c, {
      getProviderSelection: () => {
        const settingsState = settings.getState();
        const first = orderConfiguredProviders(providers.getState().configured, settingsState.providerOrder, {
          providerId: settingsState.defaultProviderId,
          modelId: settingsState.defaultModelId,
        })[0];
        return first ? { providerId: first.id, modelId: first.models[0] } : null;
      },
      getFactPack: () => {
        const conversationState = conversations.getState();
        const workspaceState = workspaces.getState();
        const pending = approvals.getState().pendingByConversation;
        return buildGlobalOverviewFactPack({
          tasks: taskStore.getState().tasks,
          conversations: conversationState.byId,
          timelines: conversationState.timelines,
          runIds: conversationState.runIds,
          pendingConversationIds: new Set(Object.entries(pending).flatMap(([id, value]) => value ? [id] : [])),
          artifacts: artifacts.getState().entries,
          workspaceLabels: Object.fromEntries(workspaceState.list.map((entry) => [entry.id, entry.name])),
        });
      },
      getAutoSettings: () => ({
        enabled: settings.getState().globalOverviewAutoEnabled,
        localTime: settings.getState().globalOverviewAutoTime,
      }),
      ...(persist ? { persistence: persist } : {}),
    });
    const scheduledTasks = createScheduledTasksStore(activeScheduler, {
      conversations,
      workspaces,
      notifications,
    });
    const learningStore = createLearningStore(activeLearning);

    // Hoisted out of the return literal so the settings subscription below can
    // report「下轮起生效」into it (轮 7 A3).
    const ui = createUiStore();

    // 轮 7 A3 —— 设置改了，正在进行的对话下一轮就吃到新值。
    //
    // 此前 persona/联网/权限只在 createConversation 时过线，于是用户打开「联网
    // 功能」再在同一个对话里问，momo 回「这轮对话里我的网络访问是关的」，而屏幕
    // 上的开关是开着的。实测过：新开对话就能搜。界面完全没提示过这个区别。
    //
    // 比较的是"送出去的那份 context"而不是整个 state：settings 的任何一次 set
    // 都会产生新 state 对象（包括 refresh searchKeySources 这种与 momo 无关的），
    // 按引用比会在每次都广播一遍。
    let lastSent = JSON.stringify(resolvePersonaContext());
    settings.subscribe(() => {
      const next = JSON.stringify(resolvePersonaContext());
      if (next === lastSent) return;
      lastSent = next;
      void conversations.getState().broadcastContext().then((reached) => {
        // 用户批准的语义：**下一轮起生效**，并且界面要明说。只在真有对话被更新时
        // 才报数字 —— 说"下轮起生效"而其实没有任何活对话，会让用户去找一个不存在
        // 的东西。
        ui.getState().noteContextApplied(reached.length);
      });
    });

    return {
      conversations,
      settings,
      // Fixture notifications are useful in the isolated browser demo, but in
      // Electron they read as real completed work. A live user starts from
      // truth: notifications arrive only from actual bridge events.
      notifications,
      approvals,
      artifacts,
      wikiEntries,
      providers,
      ui,
      // 轮 3 卡 G: 本子/文件树 read the real ~/Leemo when a workspace client is
      // present (Electron). In browser dev there is no filesystem at all, so the
      // tree falls back to the fixture rather than showing a permanent error.
      notebooks,
      fileTree,
      skills,
      searchSources,
      mcpServers,
      usageSummary,
      contextUsage,
      memory,
      scheduledTasks,
      learning: learningStore,
      workspaces,
      composerDrafts,
      captures,
      tasks: taskStore,
      globalPendingOverview,
      // 轮 4「预览区通电」: 预览内容按 path 缓存。没有 workspace（浏览器 dev）时
      // 它会把每次 load 记成"这个环境读不了文件"，而不是留一个空白面板。
      previewContent: createPreviewContentStore(workspace, {
        resolveWorkspaceId: () => workspaces.getState().activeId,
        initialEntries: workspace ? undefined : FIXTURE_PREVIEW_ENTRIES,
      }),
    };
  }, [activeClient, activeLearning, activeScheduler, capture, live, tasks, workspace]);

  // The root owns the active palette so every surface (Start, Workbench,
  // Buddy, overlays) switches together.  Hydration updates the same store,
  // therefore the persisted theme is applied before the first meaningful
  // interaction without making individual pages own theme state.
  const themeId = useStore(stores.settings, (state) => state.themeId);
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  useEffect(() => {
    const captures = stores.captures;
    if (!captures) return;
    void captures.getState().refresh();
    if (!capture) return;
    return capture.onChanged((change) => {
      if (change.entity === "note") void captures.getState().refresh();
    });
  }, [capture, stores]);

  useEffect(() => {
    const taskStore = stores.tasks;
    if (!taskStore) return;
    void taskStore.getState().refresh();
    if (!tasks?.onChanged) return;
    return tasks.onChanged(() => {
      void taskStore.getState().refresh();
    });
  }, [stores, tasks]);

  useEffect(() => {
    const desktop = window.leemoDesktop;
    if (!desktop?.onNavigate) return;
    return desktop.onNavigate((target) => {
      if (target.kind === "conversation" && typeof target.conversationId === "string") {
        stores.conversations.getState().openTab(target.conversationId);
        stores.conversations.getState().switchActive(target.conversationId);
        stores.ui.getState().setView("chat");
        return;
      }
      if (target.kind === "task" && typeof target.taskId === "string") {
        startStore.getState().open("tasks", { taskId: target.taskId });
        stores.settings.getState().setSurface("start");
      }
    });
  }, [stores]);

  useEffect(() => {
    const guardDirtyPreviewDrafts = (event: BeforeUnloadEvent) => {
      const hasDirtyDraft = Object.values(stores.previewContent.getState().drafts)
        .some((draft) => draft.status !== "clean");
      if (!hasDirtyDraft) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardDirtyPreviewDrafts);
    return () => window.removeEventListener("beforeunload", guardDirtyPreviewDrafts);
  }, [stores]);

  // 轮 3 卡 G: load the real notebooks + file tree once at startup. Notebooks
  // must be known before the first conversation, since the active 本子 becomes
  // its bookId (and prompt layer ⑨).
  useEffect(() => {
    if (!workspace) return;
    void (async () => {
      await stores.workspaces?.getState().refresh();
      await Promise.all([
        stores.notebooks.getState().refresh(),
        stores.fileTree.getState().refresh(),
      ]);
    })();
  }, [workspace, stores]);

  useEffect(() => {
    if (live && client) {
      void stores.providers.getState().refresh();
      void stores.mcpServers.getState().refresh();
      void stores.memory.getState().refresh([{ type: "global" }]);
    }
  }, [live, client, stores]);

  useEffect(() => {
    if (persist || !persistenceReady || !live || !client) return;
    // Skill switches live in persisted settings. Reading the catalog before
    // hydration would briefly expose defaults in the slash menu and could send
    // a first turn with the wrong allow-list.
    void refreshAndSyncSkills(stores, client).catch((error: unknown) => {
      console.error("[leemo:skills] startup sync failed", error);
    });
  }, [persist, persistenceReady, live, client, stores]);

  useEffect(() => {
    const unsubscribe = wireBridgeSubscriptions(activeClient, {
      conversations: stores.conversations,
      approvals: stores.approvals,
      wikiEntries: stores.wikiEntries,
      // 轮 4「成果页通电」: 这两个是 registerArtifact 的唯一调用路径 —— 在此之前
      // 成果页的 store 有 registerArtifact 却没人调，页面永远是空的。
      artifacts: stores.artifacts,
      notebooks: stores.notebooks,
      workspaces: stores.workspaces,
      previewContent: stores.previewContent,
      fileTree: stores.fileTree,
      notifications: stores.notifications,
      contextUsage: stores.contextUsage,
    });
    return unsubscribe;
  }, [activeClient, stores]);

  // Persistence (Electron only): restore SQLite → stores on mount, then keep
  // them in sync. Hydration runs BEFORE sync starts so restored data is not
  // written straight back. No-op when persist is absent (browser dev/fixture).
  useEffect(() => {
    if (!persist) {
      setPersistenceReady(true);
      return;
    }
    let stopped = false;
    let stop: (() => void) | null = null;
    setPersistenceReady(false);
    stores.artifacts.getState().beginHydration();
    void (async () => {
      try {
        const snap = await persist.loadAll();
        if (stopped) return;
        // Artifact ownership depends on the real notebook directories and the
        // workspace root. Wait for that filesystem projection before deriving
        // from persisted tool records, otherwise every absolute path is
        // incorrectly restored as "工作区外" during a startup race.
        await Promise.all([
          stores.notebooks.getState().refresh(),
          stores.workspaces?.getState().refresh(),
        ]);
        if (stopped) return;
        stores.conversations.getState().hydrate(snap.conversations);
        stores.contextUsage?.setState(
          deriveContextUsageFromTimelines(stores.conversations.getState().timelines),
        );
        stores.conversations.getState().activateWorkspace(
          stores.workspaces?.getState().activeId ?? HOME_WORKSPACE_ID,
        );
        stores.wikiEntries.getState().hydrate(snap.wikiEntries);
        const notebookState = stores.notebooks.getState();
        const workspaceState = stores.workspaces?.getState();
        stores.artifacts.getState().hydrate(deriveArtifactsFromConversations(snap.conversations, {
          books: notebookState.list,
          ...(notebookState.root ? { workspaceRoot: notebookState.root } : {}),
          resolveWorkspaceRoot: (workspaceId) => {
            const effectiveId = workspaceId ?? HOME_WORKSPACE_ID;
            if (effectiveId === HOME_WORKSPACE_ID) return notebookState.root || undefined;
            return workspaceState?.list.find((entry) => entry.id === effectiveId)?.displayPath;
          },
        }));
        // 轮 7 A3: 设置也要复原。必须在 startPersistenceSync 之前 —— sync 会把
        // 「当前状态」当作基线，反过来就会用默认值把用户存的设置覆盖回去。
        if (snap.settings) {
          stores.settings.getState().hydrate(snap.settings);
          stores.ui.getState().hydrateWorkbenchUi(
            snap.settings.workbenchUi,
            stores.conversations.getState().byId,
          );
        }
        if (snap.globalPendingOverview) {
          stores.globalPendingOverview?.getState().hydrate(snap.globalPendingOverview);
        }
        // The persisted scope is a UI preference, but it must also drive the
        // real workspace/notebook stores before the first shell render. Without
        // this bridge, a restart could show a highlighted notebook while new
        // messages still landed in the old global folder.
        const restoredScope = stores.ui.getState().activeScopeKey;
        if (restoredScope === "global") {
          stores.workspaces?.setState({ activeId: HOME_WORKSPACE_ID });
          stores.notebooks.getState().setActive(null);
          stores.conversations.getState().activateScope(HOME_WORKSPACE_ID, null);
        } else if (restoredScope.startsWith("notebook:")) {
          const notebookId = restoredScope.slice("notebook:".length);
          const exists = stores.notebooks.getState().list.some((entry) => entry.id === notebookId);
          if (exists) {
            stores.workspaces?.setState({ activeId: HOME_WORKSPACE_ID });
            stores.notebooks.getState().setActive(notebookId);
            stores.conversations.getState().activateScope(HOME_WORKSPACE_ID, notebookId);
            await stores.fileTree.getState().refresh();
          } else {
            stores.ui.getState().activateWorkbenchScope("global");
            stores.notebooks.getState().setActive(null);
            stores.workspaces?.setState({ activeId: HOME_WORKSPACE_ID });
            stores.conversations.getState().activateScope(HOME_WORKSPACE_ID, null);
          }
        } else if (restoredScope.startsWith("workspace:")) {
          const workspaceId = restoredScope.slice("workspace:".length);
          const exists = stores.workspaces?.getState().list.some((entry) => entry.id === workspaceId && entry.available);
          if (exists) {
            stores.workspaces?.setState({ activeId: workspaceId });
            stores.notebooks.getState().setActive(null);
            stores.conversations.getState().activateScope(workspaceId, null);
            await stores.fileTree.getState().refresh();
          } else {
            stores.ui.getState().activateWorkbenchScope("global");
            stores.notebooks.getState().setActive(null);
            stores.workspaces?.setState({ activeId: HOME_WORKSPACE_ID });
            stores.conversations.getState().activateScope(HOME_WORKSPACE_ID, null);
          }
        }
        // The settings UI is the source of truth for Skill switches. Restore
        // that truth into the host before revealing the app, otherwise a
        // restart shows the saved switches while the runtime silently uses the
        // built-in defaults until the next toggle or conversation.
        if (live && client) {
          try {
            await refreshAndSyncSkills(stores, client);
          } catch (error: unknown) {
            // A transient host failure must not lock the user out of Leemo.
            // The next toggle or conversation still retries with the same
            // resolved allow-list.
            console.error("[leemo:skills] startup sync failed", error);
          }
        }
      } catch (e) {
        console.error("[leemo:persist] hydrate failed", e);
        stores.artifacts.getState().failHydration(e instanceof Error ? e.message : String(e));
      }
      if (stopped) return;
      setPersistenceReady(true);
      stop = startPersistenceSync(
        {
          conversations: stores.conversations,
          wikiEntries: stores.wikiEntries,
          settings: stores.settings,
          ui: stores.ui,
          ...(stores.workspaces ? { workspaces: stores.workspaces } : {}),
        },
        persist,
      );
    })();
    return () => {
      stopped = true;
      stop?.();
    };
  }, [persist, stores, live, client]);

  // Start after chat hydration so a task can safely reuse its dedicated
  // conversation instead of creating a duplicate during startup.
  useEffect(() => {
    if (!persistenceReady) return;
    void stores.learning?.getState().refresh();
    return stores.scheduledTasks?.getState().start();
  }, [persistenceReady, stores]);

  useEffect(() => {
    if (!persistenceReady || !stores.globalPendingOverview) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void stores.globalPendingOverview!.getState().maybeAutoRefresh();
    };
    const checkWhenProviderReady = () => {
      if (stores.providers.getState().status === "ready") check();
    };
    checkWhenProviderReady();
    const stopProvider = stores.providers.subscribe((state, previous) => {
      if (state.status === "ready" && previous.status !== "ready") check();
    });
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopProvider();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [persistenceReady, stores]);

  return (
    <ClientCtx.Provider value={activeClient}>
      <Ctx.Provider value={stores}>
        <WorkspaceCtx.Provider value={workspace}>
          {persistenceReady ? children : (
            <div
              data-testid="app-bootstrap"
              role="status"
              aria-label="正在恢复 Leemo"
              className="flex h-screen w-screen items-center justify-center bg-[var(--leemo-bg)]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 animate-pulse rounded-full bg-[var(--leemo-accent)]"
              />
            </div>
          )}
        </WorkspaceCtx.Provider>
      </Ctx.Provider>
    </ClientCtx.Provider>
  );
}

function useStores(): BridgeStores {
  const s = useContext(Ctx);
  if (!s) throw new Error("BridgeProvider missing");
  return s;
}

export const useConversations = <T,>(sel: (s: ConversationsState) => T): T =>
  useStore(useStores().conversations, sel);
export const useSettings = <T,>(sel: (s: SettingsState) => T): T =>
  useStore(useStores().settings, sel);
export const useNotifications = <T,>(sel: (s: NotificationsState) => T): T =>
  useStore(useStores().notifications, sel);
export const useApprovals = <T,>(sel: (s: ApprovalsState) => T): T =>
  useStore(useStores().approvals, sel);
export const useArtifacts = <T,>(sel: (s: ArtifactsState) => T): T =>
  useStore(useStores().artifacts, sel);
export const useWikiEntries = <T,>(sel: (s: WikiState) => T): T =>
  useStore(useStores().wikiEntries, sel);
export const useProviders = <T,>(sel: (s: ProvidersState) => T): T =>
  useStore(useStores().providers, sel);
export const useUi = <T,>(sel: (s: UiState) => T): T =>
  useStore(useStores().ui, sel);
export const useNotebooks = <T,>(sel: (s: NotebooksState) => T): T =>
  useStore(useStores().notebooks, sel);
export const useFileTree = <T,>(sel: (s: FileTreeState) => T): T =>
  useStore(useStores().fileTree, sel);
export const useSkills = <T,>(sel: (s: SkillsState) => T): T =>
  useStore(useStores().skills, sel);
export const useSearchSources = <T,>(sel: (s: SearchSourcesState) => T): T =>
  useStore(useStores().searchSources, sel);
export const usePreviewContent = <T,>(sel: (s: PreviewContentState) => T): T =>
  useStore(useStores().previewContent, sel);
export const useMcpServers = <T,>(sel: (s: McpServersState) => T): T =>
  useStore(useStores().mcpServers, sel);
export const useUsageSummary = <T,>(sel: (s: UsageSummaryState) => T): T =>
  useStore(useStores().usageSummary, sel);
const FALLBACK_CONTEXT_USAGE = createContextUsageStore();
export const useContextUsage = <T,>(sel: (s: ContextUsageState) => T): T =>
  useStore(useStores().contextUsage ?? FALLBACK_CONTEXT_USAGE, sel);
export const useMemory = <T,>(sel: (s: MemoryState) => T): T =>
  useStore(useStores().memory, sel);
export const useScheduledTasks = <T,>(sel: (s: ScheduledTasksState) => T): T =>
  useStore(useStores().scheduledTasks!, sel);
export const useLearning = <T,>(sel: (s: LearningState) => T): T =>
  useStore(useStores().learning!, sel);
const FALLBACK_WORKSPACES = createWorkspacesStore();
export const useWorkspaces = <T,>(sel: (s: WorkspacesState) => T): T =>
  useStore(useStores().workspaces ?? FALLBACK_WORKSPACES, sel);
const FALLBACK_COMPOSER_DRAFTS = createComposerDraftsStore();
export const useComposerDrafts = <T,>(sel: (s: ComposerDraftsState) => T): T =>
  useStore(useStores().composerDrafts ?? FALLBACK_COMPOSER_DRAFTS, sel);
const FALLBACK_CAPTURES = createCapturesStore();
export const useCaptures = <T,>(sel: (s: CapturesState) => T): T =>
  useStore(useStores().captures ?? FALLBACK_CAPTURES, sel);
const FALLBACK_TASKS = createTasksStore();
export const useTasks = <T,>(sel: (s: TasksState) => T): T =>
  useStore(useStores().tasks ?? FALLBACK_TASKS, sel);
const FALLBACK_GLOBAL_PENDING_OVERVIEW = createGlobalPendingOverviewStore(new FixtureBridgeClient(), {
  getProviderSelection: () => null,
  getFactPack: () => ({ generatedAt: 0, facts: [] }),
  getAutoSettings: () => ({ enabled: false, localTime: "09:00" }),
});
export const useGlobalPendingOverview = <T,>(sel: (s: GlobalPendingOverviewState) => T): T =>
  useStore(useStores().globalPendingOverview ?? FALLBACK_GLOBAL_PENDING_OVERVIEW, sel);

/** The Workspace client itself (轮 3 卡 G), not a store: `pathForFile` and
 *  `reveal` are one-shot capabilities with no state to subscribe to. Undefined
 *  in browser dev — callers must treat "no filesystem" as a normal case. */
export const useWorkspace = (): WorkspaceClient | undefined => useContext(WorkspaceCtx);
export const useBridgeClient = (): BridgeClient | undefined => useContext(ClientCtx);

export const BridgeContext = Ctx;
/** Exported so component tests can supply a fake WorkspaceClient without going
 *  through BridgeProvider (which builds real stores). */
export const WorkspaceContext = WorkspaceCtx;
export const BridgeClientContext = ClientCtx;
