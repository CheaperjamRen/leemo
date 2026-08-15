import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AttachFileInput,
  AttachImageBytesInput,
  CommitQuickDraftInput,
  SaveQuickDraftInput,
} from "../captures";
import type { CreateTaskInput } from "../tasks";

type IpcResult = { ok: boolean; response?: unknown; error?: string };

const invoke = (op: string, payload?: unknown): Promise<IpcResult> =>
  ipcRenderer.invoke("leemo:capture", { op, payload });

/** Deliberately narrower than the regular renderer preload. This window can
 * resume one draft, save it, create one task, commit it, attach its just-created note,
 * hide itself, and observe invalidation; it cannot list/delete notes or reach chat,
 * settings, or credentials. */
contextBridge.exposeInMainWorld("leemoQuickCapture", {
  getQuickDraft(): Promise<IpcResult> {
    return invoke("getQuickDraft");
  },

  saveQuickDraft(payload: SaveQuickDraftInput): Promise<IpcResult> {
    return invoke("saveQuickDraft", payload);
  },

  commitQuickDraft(payload: CommitQuickDraftInput): Promise<IpcResult> {
    return invoke("commitQuickDraft", payload);
  },

  createTask(payload: CreateTaskInput): Promise<IpcResult> {
    return ipcRenderer.invoke("leemo:tasks", { op: "createTask", payload });
  },

  attachImageBytes(payload: AttachImageBytesInput): Promise<IpcResult> {
    return invoke("attachImageBytes", payload);
  },

  attachDroppedFile(payload: AttachFileInput): Promise<IpcResult> {
    return invoke("attachDroppedFile", payload);
  },

  pathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

  hide(): void {
    ipcRenderer.send("leemo:quick-capture:hide");
  },

  onChanged(cb: (payload: unknown) => void): () => void {
    const listener = (_event: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on("leemo:capture:changed", listener);
    return () => ipcRenderer.removeListener("leemo:capture:changed", listener);
  },
});
