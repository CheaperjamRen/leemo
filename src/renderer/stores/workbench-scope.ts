import { HOME_WORKSPACE_ID } from "./workspaces";

/** A stable identity for one user-visible workbench scope. */
export type ScopeKey =
  | "global"
  | `notebook:${string}`
  | `workspace:${string}`;

export type ScopeSurfacePreference = "conversation" | "split" | "file";
export type ScopeFileKind = "markdown" | "pdf" | "html" | "other";

export interface ScopeFileTab {
  workspaceId: string;
  path: string;
  title: string;
  kind: ScopeFileKind;
}

export interface ScopeSession {
  openConversationIds: string[];
  activeConversationId: string | null;
  fileTabs: ScopeFileTab[];
  activeFileKey: string | null;
  surfacePreference: ScopeSurfacePreference;
  splitRatio: number;
}

/** The selection shape used by the current workspace/notebook stores. The
 * discriminated form is also accepted so callers that do not have a workspace
 * object can name a scope directly. */
export interface ScopeSelection {
  kind?: "global" | "notebook" | "workspace";
  id?: string | null;
  workspaceId?: string | null;
  notebookId?: string | null;
  /** Alias used by ConversationMeta. */
  bookId?: string | null;
}

export interface ScopeConversationRef {
  id: string;
  workspaceId?: string | null;
  bookId?: string | null;
}

export type ScopeSessions = Partial<Record<ScopeKey, ScopeSession>>;

export const DEFAULT_SPLIT_RATIO = 0.42;
export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;
export const MAX_OPEN_CONVERSATIONS = 5;

const FILE_KINDS: readonly ScopeFileKind[] = ["markdown", "pdf", "html", "other"];
const MAX_FILE_TABS = 50;

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function scopeKeyFromParts(workspaceId: unknown, notebookId: unknown): ScopeKey {
  const notebook = cleanId(notebookId);
  if (notebook) return `notebook:${notebook}`;

  const workspace = cleanId(workspaceId);
  if (workspace && workspace !== HOME_WORKSPACE_ID) return `workspace:${workspace}`;
  return "global";
}

/**
 * Convert either a store selection (`workspaceId` + `notebookId`) or a direct
 * discriminated selection into the stable key used by persisted UI state.
 * Invalid/incomplete selections deliberately fall back to global: restoring
 * one bad preference must never prevent the rest of the app from opening.
 */
export function scopeKeyForSelection(selection: ScopeSelection | null | undefined): ScopeKey {
  if (!selection || typeof selection !== "object") return "global";

  if (selection.kind === "global") return "global";
  if (selection.kind === "notebook") {
    return scopeKeyFromParts(undefined, selection.notebookId ?? selection.id);
  }
  if (selection.kind === "workspace") {
    const workspace = cleanId(selection.workspaceId ?? selection.id);
    return workspace && workspace !== HOME_WORKSPACE_ID ? `workspace:${workspace}` : "global";
  }

  return scopeKeyFromParts(selection.workspaceId, selection.notebookId ?? selection.bookId);
}

/** Derive the same key from persisted conversation ownership fields. */
export function scopeKeyForConversation(
  conversation: Pick<ScopeConversationRef, "workspaceId" | "bookId"> | null | undefined,
): ScopeKey {
  if (!conversation) return "global";
  return scopeKeyFromParts(conversation.workspaceId, conversation.bookId);
}

/** Stable key shared by file tabs and preview drafts. */
export function fileTabKey(tab: Pick<ScopeFileTab, "workspaceId" | "path">): string {
  return `${tab.workspaceId}\u0000${tab.path}`;
}

function parseScopeKey(value: string): ScopeKey | null {
  if (value === "global") return "global";
  if (value.startsWith("notebook:")) {
    const id = cleanId(value.slice("notebook:".length));
    return id ? `notebook:${id}` : null;
  }
  if (value.startsWith("workspace:")) {
    const id = cleanId(value.slice("workspace:".length));
    return id ? `workspace:${id}` : null;
  }
  return null;
}

function clampSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

function validSurface(value: unknown): ScopeSurfacePreference {
  return value === "split" || value === "file" ? value : "conversation";
}

function validFileTab(value: unknown): ScopeFileTab | null {
  const item = record(value);
  if (!item) return null;
  const workspaceId = cleanId(item.workspaceId);
  const path = cleanId(item.path);
  const title = cleanId(item.title);
  const kind = item.kind;
  // Paths in a workbench session are workspace-relative. Do not restore an
  // absolute path from an older/corrupt settings payload into the UI.
  if (
    !workspaceId
    || !path
    || !title
    || path.startsWith("/")
    || path.startsWith("\\")
    || /^[A-Za-z]:[\\/]/.test(path)
    || !FILE_KINDS.includes(kind as ScopeFileKind)
  ) return null;
  return {
    workspaceId,
    path,
    title: title.slice(0, 240),
    kind: kind as ScopeFileKind,
  };
}

function conversationScopeIndex(
  conversations: Iterable<ScopeConversationRef> | Readonly<Record<string, ScopeConversationRef>> | null | undefined,
): Map<string, ScopeKey> | null {
  if (conversations === null || conversations === undefined) return null;
  const index = new Map<string, ScopeKey>();
  const entries = typeof (conversations as Iterable<ScopeConversationRef>)[Symbol.iterator] === "function"
    ? Array.from(conversations as Iterable<ScopeConversationRef>).map((item) => [item.id, item] as const)
    : Object.entries(conversations as Readonly<Record<string, ScopeConversationRef>>);
  for (const [fallbackId, item] of entries) {
    if (!item || typeof item !== "object") continue;
    const id = cleanId(item.id) ?? cleanId(fallbackId);
    if (!id) continue;
    index.set(id, scopeKeyForConversation(item));
  }
  return index;
}

function cleanConversationIds(value: unknown, scope: ScopeKey, index: Map<string, ScopeKey> | null): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const id = cleanId(candidate);
    if (!id || seen.has(id)) continue;
    if (index && index.get(id) !== scope) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_OPEN_CONVERSATIONS) break;
  }
  return out;
}

function cleanFileTabs(value: unknown): ScopeFileTab[] {
  if (!Array.isArray(value)) return [];
  const out: ScopeFileTab[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const tab = validFileTab(candidate);
    if (!tab) continue;
    const key = fileTabKey(tab);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tab);
    if (out.length >= MAX_FILE_TABS) break;
  }
  return out;
}

function sanitizeSession(
  value: unknown,
  scope: ScopeKey,
  index: Map<string, ScopeKey> | null,
): ScopeSession | null {
  const item = record(value);
  if (!item) return null;
  const openConversationIds = cleanConversationIds(item.openConversationIds, scope, index);
  const activeConversationId = typeof item.activeConversationId === "string"
    && openConversationIds.includes(item.activeConversationId)
    ? item.activeConversationId
    : null;
  const fileTabs = cleanFileTabs(item.fileTabs);
  const activeFileKey = typeof item.activeFileKey === "string"
    && fileTabs.some((tab) => fileTabKey(tab) === item.activeFileKey)
    ? item.activeFileKey
    : null;
  return {
    openConversationIds,
    activeConversationId,
    fileTabs,
    activeFileKey,
    surfacePreference: validSurface(item.surfacePreference),
    splitRatio: clampSplitRatio(item.splitRatio),
  };
}

/**
 * Validate persisted scope sessions defensively. This is intentionally a
 * pure projection: malformed entries are discarded independently, unknown
 * fields are ignored, and no exception escapes hydration.
 */
export function sanitizeScopeSessions(
  value: unknown,
  conversations?: Iterable<ScopeConversationRef> | Readonly<Record<string, ScopeConversationRef>> | null,
): ScopeSessions {
  const source = record(value);
  if (!source) return {};
  const index = conversationScopeIndex(conversations);
  const out: ScopeSessions = {};
  for (const [rawKey, rawSession] of Object.entries(source)) {
    const scope = parseScopeKey(rawKey);
    if (!scope) continue;
    const session = sanitizeSession(rawSession, scope, index);
    if (session) out[scope] = session;
  }
  return out;
}
