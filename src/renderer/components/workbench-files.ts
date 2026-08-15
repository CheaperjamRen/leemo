import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";

export interface WorkbenchFileRef {
  key: string;
  name: string;
  path: string | null;
  workspaceId: string;
  kind: "markdown" | "pdf" | "html" | "other";
  source: "attachment" | "read" | "changed" | "artifact";
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  return path && !path.split("/").includes("..") ? path : null;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function fileKind(path: string): WorkbenchFileRef["kind"] {
  if (/\.(?:md|markdown)$/i.test(path)) return "markdown";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.html?$/i.test(path)) return "html";
  return "other";
}

function toolPath(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "file", "path"]) {
    const candidate = safePath(record[key]);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Build the honest "本次文件" list for an unfiled conversation. It only uses
 * display-safe timeline metadata and artifacts owned by this conversation; it
 * never falls back to the hidden default-workspace tree.
 */
export function collectConversationFiles(
  conversationId: string,
  timeline: TimelineItem[],
  artifacts: ArtifactEntry[],
  workspaceId: string,
): WorkbenchFileRef[] {
  const output: WorkbenchFileRef[] = [];
  const byPath = new Map<string, number>();
  const byAttachmentName = new Map<string, number>();

  const add = (name: string, path: string | null, source: WorkbenchFileRef["source"]): void => {
    const cleanName = name.trim() || (path ? fileName(path) : "文件");
    if (!cleanName) return;
    const normalizedPath = path ? safePath(path) : null;
    if (normalizedPath && byPath.has(normalizedPath)) return;
    if (!normalizedPath && byAttachmentName.has(cleanName)) return;
    const entry: WorkbenchFileRef = {
      key: normalizedPath ? `${workspaceId}\u0000${normalizedPath}` : `attachment\u0000${cleanName}`,
      name: cleanName,
      path: normalizedPath,
      workspaceId,
      kind: fileKind(normalizedPath ?? cleanName),
      source,
    };
    const index = output.push(entry) - 1;
    if (normalizedPath) byPath.set(normalizedPath, index);
    else byAttachmentName.set(cleanName, index);
  };

  for (const item of timeline) {
    if (item.kind === "text" && item.role === "user") {
      for (const attachment of item.attachments ?? []) {
        const path = attachment.sourceKind === "workspace" ? safePath(attachment.workspacePath) : null;
        add(attachment.name, path, "attachment");
      }
      continue;
    }
    if (item.kind === "tool" && item.status !== "error" && ["Read", "Write", "Edit", "NotebookRead"].includes(item.name)) {
      const path = toolPath(item.input);
      if (path) add(fileName(path), path, "read");
      continue;
    }
    if (item.kind === "files") {
      for (const change of item.changes) {
        const path = safePath(change.workspacePath ?? change.path);
        if (path) add(fileName(path), path, "changed");
      }
    }
  }

  for (const artifact of artifacts) {
    if (artifact.sourceConversationId !== conversationId || artifact.escaped) continue;
    const path = safePath(artifact.path);
    if (path) add(artifact.title || fileName(path), path, "artifact");
  }

  return output;
}
