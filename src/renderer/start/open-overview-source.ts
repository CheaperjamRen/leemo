export type OverviewOpenTarget =
  | { kind: "task"; id: string }
  | { kind: "conversation"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "run"; conversationId: string; runId: string };

export interface OpenOverviewSourceDeps {
  openTask(taskId: string): void;
  openConversation(conversationId: string): void;
  openArtifact(artifactId: string): void;
  openRun(conversationId: string, runId: string): void;
  reportMissing(target: OverviewOpenTarget): void;
}

export function openOverviewSource(target: OverviewOpenTarget, deps: OpenOverviewSourceDeps): void {
  if (target.kind === "run") {
    if (!target.conversationId.trim() || !target.runId.trim()) return deps.reportMissing(target);
    deps.openRun(target.conversationId, target.runId);
    return;
  }
  if (!target.id.trim()) return deps.reportMissing(target);
  if (target.kind === "task") deps.openTask(target.id);
  else if (target.kind === "conversation") deps.openConversation(target.id);
  else deps.openArtifact(target.id);
}

export function overviewTargetFromSourceId(
  sourceId: string,
  relatedSourceIds: readonly string[] = [],
): OverviewOpenTarget | null {
  const separator = sourceId.indexOf(":");
  if (separator <= 0 || separator === sourceId.length - 1) return null;
  const kind = sourceId.slice(0, separator);
  const id = sourceId.slice(separator + 1);
  if (kind === "task" || kind === "conversation" || kind === "artifact") return { kind, id };
  if (kind === "run") {
    const conversation = relatedSourceIds.find((candidate) => candidate.startsWith("conversation:"));
    return conversation
      ? { kind: "run", conversationId: conversation.slice("conversation:".length), runId: id }
      : null;
  }
  return null;
}
