import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGE_DIMENSION = 12_000;
export const MAX_CLIPBOARD_IMAGE_PIXELS = 16_000_000;
export const CLIPBOARD_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const CLIPBOARD_CACHE_MAX_FILES = 64;
export const CLIPBOARD_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let clipboardStageTail: Promise<void> = Promise.resolve();

export interface StagedClipboardAttachment {
  name: string;
  path: string;
  size: number;
  mimeType: "image/png";
}

interface ClipboardCleanupOptions {
  protectedPrefix?: string;
  incomingBytes?: number;
}

interface CachedClipboardFile {
  name: string;
  path: string;
  mtimeMs: number;
  size: number;
  protected: boolean;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function timestamp(value: Date): string {
  return `${value.getFullYear()}${two(value.getMonth() + 1)}${two(value.getDate())}`
    + `-${two(value.getHours())}${two(value.getMinutes())}${two(value.getSeconds())}`;
}

export function assertClipboardImageDimensions(size: { width: number; height: number }): void {
  const { width, height } = size;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("剪贴板图片尺寸异常，请保存到本地后再作为附件添加。");
  }
  if (
    width > MAX_CLIPBOARD_IMAGE_DIMENSION
    || height > MAX_CLIPBOARD_IMAGE_DIMENSION
    || width * height > MAX_CLIPBOARD_IMAGE_PIXELS
  ) {
    throw new Error("剪贴板图片分辨率太高，请保存到本地后再作为附件添加。");
  }
}

export function cleanupStaleClipboardAttachments(
  root: string,
  now = Date.now(),
  options: ClipboardCleanupOptions = {},
): number {
  if (!fs.existsSync(root)) return 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // Cleanup is maintenance, never a startup dependency. A locked temp
    // directory must not prevent Leemo from opening or crash the hourly pass.
    return 0;
  }
  const cached: CachedClipboardFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) continue;
    const target = path.join(root, entry.name);
    try {
      const stat = fs.statSync(target);
      cached.push({
        name: entry.name,
        path: target,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        protected: Boolean(options.protectedPrefix && entry.name.startsWith(options.protectedPrefix)),
      });
    } catch {
      // A concurrent cleanup or antivirus scan may race us.
    }
  }

  let removed = 0;
  let remaining = cached;
  for (const file of cached) {
    if (file.protected || now - file.mtimeMs <= CLIPBOARD_ATTACHMENT_TTL_MS) continue;
    try {
      fs.rmSync(file.path, { force: true });
      removed += 1;
    } catch {
      // Cleanup is maintenance; a locked old image must not break staging.
    }
  }
  if (removed > 0) {
    remaining = cached.filter((file) => file.protected || fs.existsSync(file.path));
  }

  const incomingBytes = options.incomingBytes ?? 0;
  const reserveFile = incomingBytes > 0 ? 1 : 0;
  let totalBytes = remaining.reduce((sum, file) => sum + file.size, 0);
  let totalFiles = remaining.length;
  const pruneable = remaining
    .filter((file) => !file.protected)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  for (const file of pruneable) {
    if (
      totalFiles + reserveFile <= CLIPBOARD_CACHE_MAX_FILES
      && totalBytes + incomingBytes <= CLIPBOARD_CACHE_MAX_BYTES
    ) break;
    try {
      fs.rmSync(file.path, { force: true });
      totalFiles -= 1;
      totalBytes -= file.size;
      removed += 1;
    } catch {
      // Try the next historical file. If none can be removed, staging below
      // fails with a clear bounded-cache message instead of growing forever.
    }
  }

  if (
    incomingBytes > 0
    && (
      totalFiles + 1 > CLIPBOARD_CACHE_MAX_FILES
      || totalBytes + incomingBytes > CLIPBOARD_CACHE_MAX_BYTES
    )
  ) {
    throw new Error("未发送或待重试的截图已达到上限，请移除部分截图后再继续粘贴。");
  }
  return removed;
}

function safeFileToken(value: string, fallback: string, maxLength: number): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, maxLength);
  return cleaned || fallback;
}

async function stageExclusively<T>(operation: () => Promise<T>): Promise<T> {
  const previous = clipboardStageTail;
  let release!: () => void;
  clipboardStageTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function isOwnedClipboardPngPath(root: string, target: string, sessionId: string): boolean {
  if (!path.isAbsolute(target)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || path.isAbsolute(relative) || path.dirname(relative) !== ".") return false;
  const protectedPrefix = `${safeFileToken(sessionId, "session", 64)}-`;
  return relative.startsWith(protectedPrefix) && relative.toLowerCase().endsWith(".png");
}

export async function releaseClipboardPng(
  root: string,
  target: string,
  sessionId: string,
): Promise<boolean> {
  if (!isOwnedClipboardPngPath(root, target, sessionId)) return false;
  try {
    await fs.promises.rm(target);
    return true;
  } catch {
    return false;
  }
}

export async function stageClipboardPng(
  root: string,
  bytes: Uint8Array,
  options: { now?: Date; id?: string; sessionId?: string } = {},
): Promise<StagedClipboardAttachment> {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (data.length < PNG_SIGNATURE.length || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("剪贴板里没有可用的图片。");
  }
  if (data.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("剪贴板图片太大，请保存到本地后再作为附件添加（最大 20MB）。");
  }

  const now = options.now ?? new Date();
  const suffix = safeFileToken(options.id ?? randomUUID(), randomUUID().slice(0, 8), 8);
  const sessionId = safeFileToken(options.sessionId ?? "session", "session", 64);
  const name = `粘贴图片-${timestamp(now)}-${suffix}.png`;
  const protectedPrefix = `${sessionId}-`;
  return stageExclusively(async () => {
    await fs.promises.mkdir(root, { recursive: true });
    cleanupStaleClipboardAttachments(root, now.getTime(), {
      protectedPrefix,
      incomingBytes: data.length,
    });
    const target = path.join(root, `${protectedPrefix}${name}`);
    await fs.promises.writeFile(target, data, { flag: "wx" });
    return { name, path: target, size: data.length, mimeType: "image/png" };
  });
}
