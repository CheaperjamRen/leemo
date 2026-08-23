import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CaptureAttachmentPreview, NoteAttachment } from "../captures";

const MANAGED_DIRECTORIES = ["note-images", "inbox-attachments"] as const;

export interface StoreImageBytesInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface CaptureStorageService {
  storeImageBytes(
    storageRoot: string | undefined,
    noteId: string,
    input: StoreImageBytesInput,
  ): Promise<NoteAttachment>;
  referenceExternalFile(sourcePath: string): Promise<NoteAttachment>;
  copyExternalFile(
    storageRoot: string | undefined,
    noteId: string,
    sourcePath: string,
  ): Promise<NoteAttachment>;
  removeAttachment(
    storageRoot: string | undefined,
    attachment: NoteAttachment,
  ): Promise<void>;
  resolveAttachmentPath(
    storageRoot: string | undefined,
    attachment: NoteAttachment,
  ): Promise<string>;
  readAttachmentPreview(
    storageRoot: string | undefined,
    attachment: NoteAttachment,
  ): Promise<CaptureAttachmentPreview>;
  migrateManagedStorage(
    currentRoot: string | undefined,
    newRoot: string,
  ): Promise<string>;
  cleanupManagedStorage(storageRoot: string): Promise<void>;
}

export interface CaptureStorageOptions {
  now?: () => number;
  randomId?: () => string;
  writeFile?: typeof fsp.writeFile;
  copyFile?: typeof fsp.copyFile;
}

function requireStorageRoot(value: string | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("请先选择 Leemo 文件存储位置。");
  }
  return path.resolve(value.trim());
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return (normalized || fallback).slice(0, 180);
}

function relativeManagedPath(...segments: string[]): string {
  return path.join(...segments).split(path.sep).join("/");
}

function managedAbsolutePath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error("附件路径格式不正确。");
  const target = path.resolve(root, ...relativePath.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error("附件路径超出 Leemo 文件存储位置。");
  return target;
}

function friendlyStorageError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "ENOSPC" || code === "EDQUOT") {
    return new Error("文件存储位置空间不足，请更换位置后重试。");
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function requireExternalFile(sourcePath: string): Promise<{ absolute: string; size: number }> {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) throw new Error("请选择要添加的文件。");
  const absolute = path.resolve(sourcePath.trim());
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(absolute);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") throw new Error("这个文件不存在或已经被移动。");
    throw friendlyStorageError(error);
  }
  if (!stat.isFile()) throw new Error("请选择一个文件，而不是文件夹。");
  return { absolute, size: stat.size };
}

async function resolveExistingAttachment(
  storageRoot: string | undefined,
  attachment: NoteAttachment,
): Promise<{ absolute: string; size: number }> {
  const managedRoot = attachment.storage === "managed" ? requireStorageRoot(storageRoot) : null;
  const target = managedRoot
    ? managedAbsolutePath(managedRoot, attachment.path)
    : path.resolve(attachment.path);
  let absolute: string;
  let stat: fs.Stats;
  try {
    absolute = await fsp.realpath(target);
    stat = await fsp.stat(absolute);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") throw new Error("这个文件已经被移动或删除。");
    throw friendlyStorageError(error);
  }
  if (!stat.isFile()) throw new Error("这个附件已经不是可打开的文件。");
  if (managedRoot) {
    const canonicalRoot = await fsp.realpath(managedRoot).catch(() => managedRoot);
    const prefix = canonicalRoot.endsWith(path.sep) ? canonicalRoot : `${canonicalRoot}${path.sep}`;
    if (absolute !== canonicalRoot && !absolute.startsWith(prefix)) {
      throw new Error("附件路径超出 Leemo 文件存储位置。");
    }
  }
  return { absolute, size: stat.size };
}

function attachmentPreviewKind(attachment: NoteAttachment): CaptureAttachmentPreview["kind"] | null {
  const extension = path.extname(attachment.name || attachment.path).toLocaleLowerCase();
  if (attachment.mimeType?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension)) return "image";
  if (attachment.mimeType === "application/pdf" || extension === ".pdf") return "pdf";
  if ([".md", ".markdown", ".mdx"].includes(extension)) return "markdown";
  if ([".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".csv", ".tsv", ".xml", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".sql", ".sh", ".ps1"].includes(extension)) return "text";
  return null;
}

async function publishTemporaryFile(
  target: string,
  write: (temporaryPath: string) => Promise<void>,
): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.tmp`;
  await fsp.rm(temporaryPath, { force: true });
  try {
    await write(temporaryPath);
    await fsp.rename(temporaryPath, target);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw friendlyStorageError(error);
  }
}

export function createCaptureStorage(options: CaptureStorageOptions = {}): CaptureStorageService {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const writeFile = options.writeFile ?? fsp.writeFile;
  const copyFile = options.copyFile ?? fsp.copyFile;

  return {
    async storeImageBytes(storageRoot, noteId, input) {
      const root = requireStorageRoot(storageRoot);
      if (!input.mimeType.startsWith("image/")) throw new Error("请选择图片文件。");
      const id = randomId();
      const name = safeSegment(input.name, "图片");
      const safeNoteId = safeSegment(noteId, "note");
      const relativePath = relativeManagedPath("note-images", safeNoteId, `${id}-${name}`);
      const target = managedAbsolutePath(root, relativePath);
      const bytes = Buffer.from(input.bytes);
      await publishTemporaryFile(target, (temporaryPath) => writeFile(temporaryPath, bytes));
      return {
        id,
        kind: "image",
        storage: "managed",
        name,
        path: relativePath,
        mimeType: input.mimeType,
        size: bytes.byteLength,
        createdAt: now(),
      };
    },

    async referenceExternalFile(sourcePath) {
      const source = await requireExternalFile(sourcePath);
      return {
        id: randomId(),
        kind: "file",
        storage: "external",
        name: path.basename(source.absolute),
        path: source.absolute,
        size: source.size,
        createdAt: now(),
      };
    },

    async copyExternalFile(storageRoot, noteId, sourcePath) {
      const root = requireStorageRoot(storageRoot);
      const source = await requireExternalFile(sourcePath);
      const id = randomId();
      const name = safeSegment(path.basename(source.absolute), "文件");
      const safeNoteId = safeSegment(noteId, "note");
      const relativePath = relativeManagedPath(
        "inbox-attachments",
        "file-copies",
        safeNoteId,
        `${id}-${name}`,
      );
      const target = managedAbsolutePath(root, relativePath);
      await publishTemporaryFile(target, (temporaryPath) => copyFile(source.absolute, temporaryPath));
      return {
        id,
        kind: "file",
        storage: "managed",
        name,
        path: relativePath,
        size: source.size,
        createdAt: now(),
      };
    },

    async removeAttachment(storageRoot, attachment) {
      if (attachment.storage === "external") return;
      const root = requireStorageRoot(storageRoot);
      const target = managedAbsolutePath(root, attachment.path);
      await fsp.rm(target, { force: true }).catch((error) => {
        throw friendlyStorageError(error);
      });
    },

    async resolveAttachmentPath(storageRoot, attachment) {
      return (await resolveExistingAttachment(storageRoot, attachment)).absolute;
    },

    async readAttachmentPreview(storageRoot, attachment) {
      const kind = attachmentPreviewKind(attachment);
      if (!kind) throw new Error("此文件类型请使用默认应用打开。");
      const resolved = await resolveExistingAttachment(storageRoot, attachment);
      const maxBytes = kind === "markdown" || kind === "text" ? 4 * 1024 * 1024 : 48 * 1024 * 1024;
      if (resolved.size > maxBytes) throw new Error("文件较大，请使用默认应用打开。");
      const content = await fsp.readFile(resolved.absolute);
      if (kind === "markdown" || kind === "text") {
        return { kind, name: attachment.name, text: content.toString("utf8") };
      }
      if (kind === "pdf") return { kind, name: attachment.name, base64: content.toString("base64") };
      return {
        kind,
        name: attachment.name,
        mimeType: attachment.mimeType || "image/*",
        base64: content.toString("base64"),
      };
    },

    async migrateManagedStorage(currentRoot, newRootValue) {
      const newRoot = requireStorageRoot(newRootValue);
      const oldRoot = currentRoot?.trim() ? path.resolve(currentRoot.trim()) : undefined;
      if (!oldRoot || oldRoot === newRoot) {
        await fsp.mkdir(newRoot, { recursive: true });
        return newRoot;
      }

      const oldStat = await fsp.stat(oldRoot).catch(() => undefined);
      if (!oldStat?.isDirectory()) throw new Error("原文件存储位置不存在，未进行迁移。");
      const parent = path.dirname(newRoot);
      const temporaryRoot = path.join(parent, `.${path.basename(newRoot)}.leemo-migration-${randomId()}`);
      await fsp.mkdir(parent, { recursive: true });
      await fsp.rm(temporaryRoot, { recursive: true, force: true });
      try {
        const destinationStat = await fsp.stat(newRoot).catch(() => undefined);
        if (destinationStat) {
          if (!destinationStat.isDirectory()) throw new Error("新的文件存储位置不是文件夹。");
          if ((await fsp.readdir(newRoot)).length > 0) throw new Error("新的文件存储位置不是空文件夹。");
          await fsp.rmdir(newRoot);
        }
        await fsp.mkdir(temporaryRoot, { recursive: true });
        for (const directory of MANAGED_DIRECTORIES) {
          const source = path.join(oldRoot, directory);
          if (await fsp.stat(source).then((stat) => stat.isDirectory()).catch(() => false)) {
            await fsp.cp(source, path.join(temporaryRoot, directory), { recursive: true });
          }
        }
        await fsp.rename(temporaryRoot, newRoot);
        return newRoot;
      } catch (error) {
        await fsp.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
        throw friendlyStorageError(error);
      }
    },

    async cleanupManagedStorage(storageRoot) {
      const root = requireStorageRoot(storageRoot);
      await Promise.all(MANAGED_DIRECTORIES.map((directory) => (
        fsp.rm(path.join(root, directory), { recursive: true, force: true })
      )));
    },
  };
}
