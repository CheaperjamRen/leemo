import { createStore, type StoreApi } from "zustand/vanilla";
import type { TimelineItem } from "./message-model";
import { DEFAULT_WORKSPACE_DIR } from "../../bridge/contract";
import {
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES,
  LEEMO_VISUALIZATION_TOOL_NAME,
} from "../bridge/tool-names";
import { HOME_WORKSPACE_ID } from "./workspaces";
import { defaultWordEditOutputPath } from "../../bridge/document-paths";
import { ensureVisualizationHtmlExtension } from "../../bridge/visualization-spec";

/**
 * Canonical tool name for B2's artifact derivation. Batch 0d's visualization
 * card must consume this exported seam (rather than introducing another alias
 * or importing fixture data); a later integration pass can relocate the
 * canonical definition without changing the store contract.
 */
export { LEEMO_DOCUMENT_CREATE_TOOL_NAMES, LEEMO_VISUALIZATION_TOOL_NAME };

const FILE_ARTIFACT_TOOL_NAMES = new Set<string>([
  "Write",
  "Edit",
  ...Object.values(LEEMO_DOCUMENT_CREATE_TOOL_NAMES),
]);
const ROOT_ROUTED_FILE_ARTIFACT_TOOL_NAMES = new Set<string>([
  "Write",
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord,
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createPresentation,
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createSpreadsheet,
  LEEMO_VISUALIZATION_TOOL_NAME,
]);

export interface ArtifactEntry {
  id: string;
  kind: "file" | "visualization";
  path: string;
  title: string;
  bookId: string | null;
  sourceConversationId: string;
  sourceRunId: string;
  createdAt: number;
  escaped: boolean;
  /** Missing on legacy records means the Leemo home workspace. */
  workspaceId?: string;
}

export interface ArtifactsState {
  entries: ArtifactEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  beginHydration: () => void;
  hydrate: (entries: ArtifactEntry[]) => void;
  failHydration: (message: string) => void;
  registerArtifact: (entry: ArtifactEntry) => void;
  removeArtifact: (id: string) => void;
}

interface ArtifactContext {
  conversationId: string;
  runId: string;
  /** Only `id` is read (bookForPath matches a path's first segment against it),
   *  so this deliberately does NOT require the full Notebook shape — the
   *  artifact deriver should not care where notebook metadata comes from. */
  books: { id: string }[];
  now: number;
  workspaceRoot?: string;
  workspaceId?: string;
  /** undefined keeps legacy records conservative; null explicitly means the
   * home root and therefore the physical 默认工作区 fallback. */
  bookId?: string | null;
}

export interface ArtifactConversationSource {
  meta: { id: string; lastActivityAt: number; workspaceId?: string; bookId?: string | null };
  timeline: TimelineItem[];
}

export interface ArtifactRebuildContext {
  books: { id: string }[];
  workspaceRoot?: string;
  resolveWorkspaceRoot?: (workspaceId?: string) => string | undefined;
}

function objectInput(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

type AbsoluteKind = "posix" | "drive" | "unc";
interface ParsedAbsolutePath {
  kind: AbsoluteKind;
  drive?: string;
  segments: string[];
  identity: string;
  escaped: boolean;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") ||
    (path.length >= 3 && /^[A-Za-z]:/.test(path) && (path[2] === "/" || path[2] === "\\")) ||
    path.startsWith("\\\\");
}

function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeSegments(path: string, floor = 0): { segments: string[]; escaped: boolean; leadingParents: number } {
  const segments: string[] = [];
  let escaped = false;
  let leadingParents = 0;
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > floor) segments.pop();
      else if (segments.length < floor) {
        // A UNC server/share prefix is an absolute root and cannot be escaped.
        continue;
      } else {
        escaped = true;
        leadingParents += 1;
      }
      continue;
    }
    segments.push(segment);
  }
  return { segments, escaped, leadingParents };
}

function relativeNormalizedPath(result: ReturnType<typeof normalizeSegments>): string {
  return [...Array(result.leadingParents).fill(".."), ...result.segments].join("/");
}

function parseAbsolutePath(rawPath: string): ParsedAbsolutePath | null {
  const slashed = normalizeSlashes(rawPath);
  if (slashed.startsWith("//")) {
    const result = normalizeSegments(slashed.slice(2), 2);
    return {
      kind: "unc",
      segments: result.segments,
      identity: `//${result.segments.join("/")}`,
      escaped: result.escaped,
    };
  }

  const drive = /^[A-Za-z]:\//.test(slashed) ? { 1: slashed[0], 2: slashed.slice(3) } : null;
  if (drive) {
    const result = normalizeSegments(drive[2]);
    return {
      kind: "drive",
      drive: drive[1],
      segments: result.segments,
      identity: `${drive[1]}:/${result.segments.join("/")}`,
      escaped: result.escaped,
    };
  }

  if (slashed.startsWith("/")) {
    const result = normalizeSegments(slashed.slice(1));
    return {
      kind: "posix",
      segments: result.segments,
      identity: `/${result.segments.join("/")}`,
      escaped: result.escaped,
    };
  }
  return null;
}

function pathSegmentsEqual(a: ParsedAbsolutePath, b: ParsedAbsolutePath): boolean {
  if (a.kind !== b.kind || a.segments.length < b.segments.length) return false;
  const insensitive = a.kind === "drive" || a.kind === "unc";
  const normalize = (value: string) => insensitive ? value.toLowerCase() : value;
  if (a.kind === "drive" && a.drive?.toLowerCase() !== b.drive?.toLowerCase()) return false;
  return b.segments.every((segment, index) => normalize(a.segments[index]) === normalize(segment));
}

function normalizeAbsolutePath(rawPath: string, workspaceRoot?: string): { path: string; escaped: boolean } {
  const candidate = parseAbsolutePath(rawPath);
  if (!candidate) return { path: "", escaped: true };

  const trimmedRoot = typeof workspaceRoot === "string" && workspaceRoot.trim()
    ? workspaceRoot.trim().replace(/[\\/]+$/, "")
    : null;
  const root = trimmedRoot ? parseAbsolutePath(trimmedRoot) : null;
  if (root && !candidate.escaped && pathSegmentsEqual(candidate, root)) {
    const relative = candidate.segments.slice(root.segments.length).join("/");
    return relative ? { path: relative, escaped: false } : { path: ".", escaped: false };
  }
  return { path: candidate.identity, escaped: true };
}

function normalizeArtifactPath(rawPath: string, workspaceRoot?: string): { path: string; escaped: boolean } {
  const trimmed = rawPath.trim();
  if (!isAbsolutePath(trimmed)) {
    const relative = normalizeSegments(normalizeSlashes(trimmed).replace(/^\.\//, ""));
    return { path: relativeNormalizedPath(relative), escaped: relative.escaped };
  }
  return normalizeAbsolutePath(trimmed, workspaceRoot);
}

function titleOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function bookForPath(path: string, books: { id: string }[]): string | null {
  const firstSegment = path.split("/").filter(Boolean)[0];
  return books.find((book) => book.id === firstSegment)?.id ?? null;
}

function pathFromInput(input: unknown, toolName: string, visualization: boolean): string | null {
  const record = objectInput(input);
  if (!record) return null;
  if (toolName === LEEMO_DOCUMENT_CREATE_TOOL_NAMES.editWord) {
    if (typeof record.output_path === "string" && record.output_path.trim()) return record.output_path;
    return typeof record.file_path === "string" && record.file_path.trim()
      ? defaultWordEditOutputPath(record.file_path)
      : null;
  }
  if (!visualization) return typeof record.file_path === "string" && record.file_path.trim() ? record.file_path : null;
  for (const key of ["file", "file_path", "path"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return ensureVisualizationHtmlExtension(value);
  }
  return null;
}

function projectPathIntoConversation(
  rawPath: string,
  normalized: { path: string; escaped: boolean },
  toolName: string,
  ctx: ArtifactContext,
): { path: string; escaped: boolean } {
  if (normalized.escaped || ctx.bookId === undefined) return normalized;
  const workspaceId = ctx.workspaceId ?? HOME_WORKSPACE_ID;
  if (workspaceId !== HOME_WORKSPACE_ID) return normalized;
  // Explicit absolute paths already name their real location. Only relative
  // paths are subject to the host's notebook/default-workspace routing.
  if (isAbsolutePath(rawPath.trim())) return normalized;

  if (ctx.bookId) {
    return { ...normalized, path: `${ctx.bookId}/${normalized.path}` };
  }

  if (!ROOT_ROUTED_FILE_ARTIFACT_TOOL_NAMES.has(toolName)) return normalized;
  const firstSegment = normalized.path.split("/").filter(Boolean)[0];
  if (
    normalized.path === DEFAULT_WORKSPACE_DIR
    || normalized.path.startsWith(`${DEFAULT_WORKSPACE_DIR}/`)
    || ctx.books.some((book) => book.id.toLocaleLowerCase() === firstSegment?.toLocaleLowerCase())
  ) return normalized;
  return { ...normalized, path: `${DEFAULT_WORKSPACE_DIR}/${normalized.path}` };
}

export function deriveArtifact(
  item: Extract<TimelineItem, { kind: "tool" }>,
  ctx: ArtifactContext,
): ArtifactEntry | null {
  if (item.status !== "ok") return null;
  const isVisualization = item.name === LEEMO_VISUALIZATION_TOOL_NAME;
  if (!FILE_ARTIFACT_TOOL_NAMES.has(item.name) && !isVisualization) return null;

  const rawPath = pathFromInput(item.input, item.name, isVisualization);
  if (!rawPath) return null;
  const normalized = projectPathIntoConversation(
    rawPath,
    normalizeArtifactPath(rawPath, ctx.workspaceRoot),
    item.name,
    ctx,
  );
  const title = titleOf(normalized.path);
  if (!normalized.path || !title) return null;

  return {
    id: `${ctx.conversationId}:${item.toolUseId}`,
    kind: isVisualization ? "visualization" : "file",
    path: normalized.path,
    title,
    bookId: normalized.escaped ? null : bookForPath(normalized.path, ctx.books),
    sourceConversationId: ctx.conversationId,
    sourceRunId: ctx.runId,
    createdAt: ctx.now,
    escaped: normalized.escaped,
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
  };
}

function workspaceKey(entry: ArtifactEntry): string {
  return entry.workspaceId ?? HOME_WORKSPACE_ID;
}

function samePath(a: ArtifactEntry, b: ArtifactEntry): boolean {
  return workspaceKey(a) === workspaceKey(b)
    && a.bookId === b.bookId
    && a.path === b.path
    && a.escaped === b.escaped;
}

function upsertArtifactEntries(entries: ArtifactEntry[], entry: ArtifactEntry): ArtifactEntry[] {
  return [entry, ...entries.filter((existing) => existing.id !== entry.id && !samePath(existing, entry))];
}

function normalizeArtifactEntries(entries: ArtifactEntry[]): ArtifactEntry[] {
  const newestFirst = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.createdAt - left.entry.createdAt || right.index - left.index);
  const normalized: ArtifactEntry[] = [];
  for (const { entry } of newestFirst) {
    if (normalized.some((existing) => existing.id === entry.id || samePath(existing, entry))) continue;
    normalized.push(entry);
  }
  return normalized;
}

function toolsFromTimeline(timeline: TimelineItem[]): { item: Extract<TimelineItem, { kind: "tool" }>; order: number }[] {
  const tools: { item: Extract<TimelineItem, { kind: "tool" }>; order: number }[] = [];
  let order = 0;
  for (const timelineItem of timeline) {
    if (timelineItem.kind === "tool") {
      tools.push({ item: timelineItem, order: order++ });
      continue;
    }
    if (timelineItem.kind !== "activity") continue;
    for (const child of timelineItem.tools) {
      tools.push({
        item: {
          kind: "tool",
          id: `${timelineItem.id}:${child.toolUseId}`,
          runId: timelineItem.runId,
          toolUseId: child.toolUseId,
          name: child.name,
          input: child.input,
          status: child.status,
          ...(child.summary !== undefined ? { summary: child.summary } : {}),
        },
        order: order++,
      });
    }
  }
  return tools;
}

export function findArtifactTool(
  timeline: TimelineItem[],
  toolUseId: string,
): Extract<TimelineItem, { kind: "tool" }> | null {
  return toolsFromTimeline(timeline).find(({ item }) => item.toolUseId === toolUseId)?.item ?? null;
}

export function deriveArtifactsFromConversations(
  conversations: ArtifactConversationSource[],
  context: ArtifactRebuildContext,
): ArtifactEntry[] {
  const candidates: { entry: ArtifactEntry; conversationOrder: number; toolOrder: number }[] = [];

  conversations.forEach((conversation, conversationOrder) => {
    const workspaceId = conversation.meta.workspaceId;
    const workspaceRoot = context.resolveWorkspaceRoot?.(workspaceId) ?? context.workspaceRoot;
    const workspaceBooks = workspaceId && workspaceId !== HOME_WORKSPACE_ID ? [] : context.books;
    const finishedAtByRun = new Map<string, number>();
    for (const item of conversation.timeline) {
      if (item.kind === "result" && typeof item.createdAt === "number" && Number.isFinite(item.createdAt)) {
        finishedAtByRun.set(item.runId, item.createdAt);
      }
    }

    for (const { item, order: toolOrder } of toolsFromTimeline(conversation.timeline)) {
      const createdAt = finishedAtByRun.get(item.runId) ?? conversation.meta.lastActivityAt;
      const entry = deriveArtifact(item, {
        conversationId: conversation.meta.id,
        runId: item.runId,
        books: workspaceBooks,
        now: createdAt,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(conversation.meta.bookId !== undefined ? { bookId: conversation.meta.bookId } : {}),
      });
      if (entry) candidates.push({ entry, conversationOrder, toolOrder });
    }
  });

  candidates.sort((left, right) =>
    right.entry.createdAt - left.entry.createdAt
      || left.conversationOrder - right.conversationOrder
      || right.toolOrder - left.toolOrder,
  );

  const entries: ArtifactEntry[] = [];
  for (const { entry } of candidates) {
    if (entries.some((existing) => existing.id === entry.id || samePath(existing, entry))) continue;
    entries.push(entry);
  }
  return entries;
}

export function createArtifactsStore(initial: ArtifactEntry[] = []): StoreApi<ArtifactsState> {
  return createStore<ArtifactsState>((set) => ({
    entries: normalizeArtifactEntries(initial),
    status: "ready",
    error: null,
    beginHydration: () => set({ status: "loading", error: null }),
    hydrate: (entries) => set({ entries: normalizeArtifactEntries(entries), status: "ready", error: null }),
    failHydration: (message) => set({ status: "error", error: message }),
    registerArtifact: (entry) => set((state) => ({
      entries: upsertArtifactEntries(state.entries, entry),
    })),
    removeArtifact: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
  }));
}
