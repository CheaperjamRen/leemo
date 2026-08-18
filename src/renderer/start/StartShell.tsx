import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import TopBar from "../components/TopBar";
import {
  useApprovals,
  useArtifacts,
  useConversations,
  useGlobalPendingOverview,
  useSettings,
  useTasks,
  useUi,
  useWorkspaces,
} from "../bridge/context";
import { createStartStore } from "../stores/start";
import { buildGlobalOverviewFactPack } from "../global-overview/facts";
import { deriveGlobalOverviewDisplayItems } from "../stores/global-pending-overview";
import StartSidebar from "./StartSidebar";
import StartHome from "./StartHome";
import StartTasksView from "./StartTasksView";
import StartNotesView from "./StartNotesView";
import GlobalPendingOverviewPage from "./GlobalPendingOverviewPage";
import { openOverviewSource, overviewTargetFromSourceId, type OverviewOpenTarget } from "./open-overview-source";
import type { StartDestination } from "./start-navigation";
import "./StartShell.css";

function previewKind(path: string, kind: "file" | "visualization") {
  if (kind === "visualization" || /\.html?$/i.test(path)) return "html" as const;
  if (/\.pdf$/i.test(path)) return "pdf" as const;
  if (/\.md$/i.test(path)) return "markdown" as const;
  return "other" as const;
}

export default function StartShell() {
  const startStore = useMemo(() => createStartStore(), []);
  const destination = useStore(startStore, (state) => state.destination);
  const selectedTaskId = useStore(startStore, (state) => state.selectedTaskId);
  const selectedNoteId = useStore(startStore, (state) => state.selectedNoteId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => (
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 1023px)").matches
  ));
  const [sourceError, setSourceError] = useState<string | null>(null);
  const setSurface = useSettings((state) => state.setSurface);
  const conversations = useConversations((state) => state.byId);
  const timelines = useConversations((state) => state.timelines);
  const runIds = useConversations((state) => state.runIds);
  const openTab = useConversations((state) => state.openTab);
  const switchActive = useConversations((state) => state.switchActive);
  const pending = useApprovals((state) => state.pendingByConversation);
  const artifacts = useArtifacts((state) => state.entries);
  const tasks = useTasks((state) => state.tasks);
  const workspaces = useWorkspaces((state) => state.list);
  const setView = useUi((state) => state.setView);
  const openPreview = useUi((state) => state.openPreview);
  const snapshot = useGlobalPendingOverview((state) => state.persisted.snapshot);
  const overrides = useGlobalPendingOverview((state) => state.persisted.overrides);
  const setPriority = useGlobalPendingOverview((state) => state.setPriority);
  const ignore = useGlobalPendingOverview((state) => state.ignore);
  const end = useGlobalPendingOverview((state) => state.end);
  const restore = useGlobalPendingOverview((state) => state.restore);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);

  const facts = useMemo(() => buildGlobalOverviewFactPack({
    tasks,
    conversations,
    timelines,
    runIds,
    pendingConversationIds: new Set(Object.entries(pending).flatMap(([id, value]) => value ? [id] : [])),
    artifacts,
    workspaceLabels: Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }).facts, [artifacts, conversations, pending, runIds, tasks, timelines, workspaces]);
  const overviewItems = useMemo(() => deriveGlobalOverviewDisplayItems(snapshot, facts, overrides), [facts, overrides, snapshot]);
  const sourceLabels = useMemo(() => Object.fromEntries(facts.map((fact) => [
    fact.id,
    `${fact.kind === "task" ? "待办" : fact.kind === "conversation" ? "会话" : fact.kind === "run" ? "任务过程" : "成果"}：${fact.label}`,
  ])), [facts]);

  const reportMissing = (target: OverviewOpenTarget) => {
    setSourceError(`没有找到来源：${target.kind === "run" ? target.runId : target.id}`);
  };
  const openSourceId = (sourceId: string, related: readonly string[]) => {
    setSourceError(null);
    const target = overviewTargetFromSourceId(sourceId, related);
    if (!target) {
      setSourceError(`无法识别来源：${sourceId}`);
      return;
    }
    openOverviewSource(target, {
      openTask: (id) => {
        if (!tasks.some((task) => task.id === id)) return reportMissing({ kind: "task", id });
        startStore.getState().open("tasks", { taskId: id });
      },
      openConversation: (id) => {
        if (!conversations[id]) return reportMissing({ kind: "conversation", id });
        openTab(id);
        switchActive(id);
        setView("chat");
        setSurface("workbench");
      },
      openArtifact: (id) => {
        const artifact = artifacts.find((entry) => entry.id === id);
        if (!artifact || artifact.escaped) return reportMissing({ kind: "artifact", id });
        setView("chat");
        openPreview(artifact.path, artifact.title, previewKind(artifact.path, artifact.kind));
        setSurface("workbench");
      },
      openRun: (conversationId, runId) => {
        if (!conversations[conversationId]) return reportMissing({ kind: "run", conversationId, runId });
        openTab(conversationId);
        switchActive(conversationId);
        setView("chat");
        setSurface("workbench");
      },
      reportMissing,
    });
  };

  const toggleNavigation = () => {
    if (narrow) setMobileSidebarOpen((value) => !value);
    else setSidebarCollapsed((value) => !value);
  };
  const openDestination = (next: StartDestination) => {
    startStore.getState().open(next);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="leemo-start-shell" data-shell="start">
      <TopBar
        onOpenHistory={toggleNavigation}
        navigationControl={narrow ? mobileSidebarOpen ? "sidebar-expanded" : "sidebar-collapsed" : sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}
      />
      <div className={`leemo-start-shell__body${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
        {mobileSidebarOpen && <button type="button" className="leemo-start-sidebar-backdrop" aria-label="关闭开始导航" onClick={() => setMobileSidebarOpen(false)} />}
        <StartSidebar
          destination={destination}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          onOpen={openDestination}
        />
        <main className="leemo-start-main">
          {sourceError && <div className="leemo-start-source-error" role="status">{sourceError}</div>}
          {destination === "home" && <StartHome
            onOpen={openDestination}
            onOpenTask={(taskId) => startStore.getState().open("tasks", { taskId })}
            onOpenNote={(noteId, next) => startStore.getState().open(next, { noteId })}
          />}
          {destination === "overview" && (
            <GlobalPendingOverviewPage
              items={overviewItems}
              uncertainSourceIds={snapshot?.uncertainSourceIds ?? []}
              onBack={() => openDestination("home")}
              onOpenSource={openSourceId}
              onSetPriority={(id, value) => { void setPriority(id, value); }}
              onIgnore={(id) => { void ignore(id); }}
              onEnd={(id) => { void end(id); }}
              onRestore={(id) => { void restore(id); }}
              sourceLabels={sourceLabels}
            />
          )}
          {destination === "tasks" && <StartTasksView selectedTaskId={selectedTaskId} />}
          {destination !== "home" && destination !== "overview" && destination !== "tasks" && (
            <StartNotesView destination={destination} selectedNoteId={selectedNoteId} />
          )}
        </main>
      </div>
    </div>
  );
}
