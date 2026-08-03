import type { InvokeResult } from "../bridge/ipc-client";
import type {
  WorkspaceClient,
  WorkspaceNotebook,
  WorkspaceFileNode,
  PlacedFile,
  PreviewPayload,
  MarkdownWriteResult,
  WorkspaceRootInfo,
} from "./client";

/** The exact surface the preload exposes on `window.leemoWorkspace`
 *  (see src/main/preload.ts). One multiplexed invoke + the webUtils path
 *  reader, mirroring leemoBridge / leemoPersist. */
export interface LeemoWorkspaceApi {
  invoke(op: string, payload: unknown): Promise<InvokeResult>;
  pathForFile(file: File): string;
}

/**
 * WorkspaceClient backed by Electron IPC. Errors cross as data
 * ({ ok:false, error }) — same frame shape as the other two surfaces — and are
 * re-thrown here as real Errors so callers can show the message. The messages
 * are user-facing Chinese from workspace.ts ("已经有一个叫「X」的本子了"), so
 * they are surfaced verbatim rather than replaced with a generic failure.
 */
export class IpcWorkspaceClient implements WorkspaceClient {
  constructor(private readonly api: LeemoWorkspaceApi) {}

  private async call<T>(op: string, payload?: unknown): Promise<T> {
    const res = await this.api.invoke(op, payload);
    if (!res.ok) throw new Error(res.error ?? `workspace ${op} failed`);
    return res.response as T;
  }

  listWorkspaces(): Promise<WorkspaceRootInfo[]> {
    return this.call("listWorkspaces");
  }

  pickWorkspace(): Promise<WorkspaceRootInfo | null> {
    return this.call("pickWorkspace");
  }

  touchWorkspace(id: string): Promise<WorkspaceRootInfo> {
    return this.call("touchWorkspace", { id });
  }

  forgetWorkspace(id: string): Promise<boolean> {
    return this.call("forgetWorkspace", { id });
  }

  listNotebooks(): Promise<{ root: string; notebooks: WorkspaceNotebook[] }> {
    return this.call("listNotebooks");
  }

  createNotebook(title: string): Promise<WorkspaceNotebook> {
    return this.call("createNotebook", { title });
  }

  ensureStarterNotebook(): Promise<WorkspaceNotebook> {
    return this.call("ensureStarterNotebook");
  }

  readTree(workspaceId?: string): Promise<WorkspaceFileNode[]> {
    return this.call("readTree", workspaceId === undefined ? undefined : { workspaceId });
  }

  dropFiles(sources: string[], notebookId: string | null, workspaceId?: string): Promise<PlacedFile[]> {
    return this.call("dropFiles", {
      sources,
      notebookId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  moveFile(path: string, notebookId: string | null, workspaceId?: string): Promise<PlacedFile> {
    return this.call("moveFile", {
      path,
      notebookId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  suggestNotebook(fileName: string, workspaceId?: string): Promise<string | null> {
    return this.call("suggestNotebook", {
      fileName,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  readTextFile(path: string, workspaceId?: string): Promise<string> {
    return this.call("readTextFile", {
      path,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  readPreview(path: string, workspaceId?: string): Promise<PreviewPayload> {
    return this.call("readPreview", {
      path,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  writeMarkdownFile(
    path: string,
    text: string,
    expectedText: string,
    workspaceId?: string,
  ): Promise<MarkdownWriteResult> {
    return this.call("writeMarkdownFile", {
      path,
      text,
      expectedText,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  async reveal(path?: string, workspaceId?: string): Promise<void> {
    await this.call("reveal", {
      path: path ?? "",
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  stageClipboardImage(): Promise<{
    name: string;
    path: string;
    size: number;
    mimeType: "image/png";
  }> {
    return this.call("stageClipboardImage");
  }

  async releaseClipboardImage(path: string): Promise<void> {
    await this.call("releaseClipboardImage", { path });
  }

  pathForFile(file: File): string {
    return this.api.pathForFile(file);
  }
}
