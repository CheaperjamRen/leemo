import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertClipboardImageDimensions,
  CLIPBOARD_CACHE_MAX_FILES,
  cleanupStaleClipboardAttachments,
  MAX_CLIPBOARD_IMAGE_BYTES,
  releaseClipboardPng,
  stageClipboardPng,
} from "../../src/main/clipboard-attachment";

const roots: string[] = [];
const png = (extra = 0): Buffer => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(extra, 7),
]);

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-clipboard-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("clipboard image attachment staging", () => {
  it("rejects implausible clipboard dimensions before PNG encoding", () => {
    expect(() => assertClipboardImageDimensions({ width: 1920, height: 1080 })).not.toThrow();
    expect(() => assertClipboardImageDimensions({ width: 0, height: 1080 })).toThrow("尺寸异常");
    expect(() => assertClipboardImageDimensions({ width: 12_001, height: 100 })).toThrow("分辨率太高");
    expect(() => assertClipboardImageDimensions({ width: 5_000, height: 4_000 })).toThrow("分辨率太高");
  });

  it("writes a real PNG asynchronously with a user-readable display name", async () => {
    const root = tempRoot();
    const attachment = await stageClipboardPng(root, png(12), {
      now: new Date(2026, 7, 2, 6, 30, 45),
      id: "abc12345-rest",
      sessionId: "current-session",
    });

    expect(attachment.name).toBe("粘贴图片-20260802-063045-abc12345.png");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.size).toBe(20);
    expect(path.isAbsolute(attachment.path)).toBe(true);
    expect(path.basename(attachment.path)).toBe(`current-session-${attachment.name}`);
    expect(fs.readFileSync(attachment.path)).toEqual(png(12));
  });

  it("rejects corrupt or oversized clipboard payloads before writing", async () => {
    const root = tempRoot();
    await expect(stageClipboardPng(root, Buffer.from("not png"))).rejects.toThrow("剪贴板里没有可用的图片");
    await expect(stageClipboardPng(root, png(MAX_CLIPBOARD_IMAGE_BYTES))).rejects.toThrow("图片太大");
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("removes stale files without deleting an old draft from the current app session", async () => {
    const root = tempRoot();
    const stale = path.join(root, "stale.png");
    const recent = path.join(root, "recent.png");
    const current = path.join(root, "current-session-still-drafted.png");
    fs.writeFileSync(stale, png());
    fs.writeFileSync(recent, png());
    fs.writeFileSync(current, png());
    fs.utimesSync(stale, new Date("2026-07-30T00:00:00Z"), new Date("2026-07-30T00:00:00Z"));
    fs.utimesSync(recent, new Date("2026-08-02T05:00:00Z"), new Date("2026-08-02T05:00:00Z"));
    fs.utimesSync(current, new Date("2026-07-30T00:00:00Z"), new Date("2026-07-30T00:00:00Z"));

    await stageClipboardPng(root, png(), {
      now: new Date(2026, 7, 2, 6, 30, 45),
      id: "newimage-rest",
      sessionId: "current-session",
    });

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(current)).toBe(true);
  });

  it("releases only a temporary image owned by the current app session", async () => {
    const root = tempRoot();
    const owned = await stageClipboardPng(root, png(), {
      id: "owned",
      sessionId: "current-session",
    });
    const other = await stageClipboardPng(root, png(), {
      id: "other",
      sessionId: "other-session",
    });
    const outside = path.join(tempRoot(), "outside.png");
    fs.writeFileSync(outside, png());

    await expect(releaseClipboardPng(root, owned.path, "current-session")).resolves.toBe(true);
    await expect(releaseClipboardPng(root, other.path, "current-session")).resolves.toBe(false);
    await expect(releaseClipboardPng(root, outside, "current-session")).resolves.toBe(false);
    expect(fs.existsSync(owned.path)).toBe(false);
    expect(fs.existsSync(other.path)).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("can clean stale files independently at startup without creating the cache directory", () => {
    const parent = tempRoot();
    const missing = path.join(parent, "not-created-yet");
    expect(cleanupStaleClipboardAttachments(missing, new Date("2026-08-02T06:30:45Z").getTime())).toBe(0);
    expect(fs.existsSync(missing)).toBe(false);

    const stale = path.join(parent, "old.png");
    const recent = path.join(parent, "recent.png");
    const unrelated = path.join(parent, "keep.txt");
    fs.writeFileSync(stale, png());
    fs.writeFileSync(recent, png());
    fs.writeFileSync(unrelated, "keep");
    fs.utimesSync(stale, new Date("2026-07-30T00:00:00Z"), new Date("2026-07-30T00:00:00Z"));
    fs.utimesSync(recent, new Date("2026-08-02T05:00:00Z"), new Date("2026-08-02T05:00:00Z"));

    expect(cleanupStaleClipboardAttachments(parent, new Date("2026-08-02T06:30:45Z").getTime())).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("treats a non-directory cache root as a best-effort cleanup miss", () => {
    const parent = tempRoot();
    const file = path.join(parent, "cache-root");
    fs.writeFileSync(file, "occupied");
    expect(cleanupStaleClipboardAttachments(file)).toBe(0);
  });

  it("bounds cache file count by pruning old sessions before staging", async () => {
    const root = tempRoot();
    const now = new Date("2026-08-02T06:30:45Z");
    for (let index = 0; index < CLIPBOARD_CACHE_MAX_FILES; index += 1) {
      const file = path.join(root, `previous-${String(index).padStart(3, "0")}.png`);
      fs.writeFileSync(file, png());
      const touched = new Date(now.getTime() - (CLIPBOARD_CACHE_MAX_FILES - index) * 1000);
      fs.utimesSync(file, touched, touched);
    }

    await stageClipboardPng(root, png(), {
      now,
      id: "bounded-rest",
      sessionId: "current-session",
    });

    const files = fs.readdirSync(root).filter((name) => name.endsWith(".png"));
    expect(files).toHaveLength(CLIPBOARD_CACHE_MAX_FILES);
    expect(files.some((name) => name.startsWith("current-session-"))).toBe(true);
    expect(files).not.toContain("previous-000.png");
  });

  it("serializes concurrent staging so both requests cannot reserve the same final slot", async () => {
    const root = tempRoot();
    const now = new Date("2026-08-02T06:30:45Z");
    for (let index = 0; index < CLIPBOARD_CACHE_MAX_FILES - 1; index += 1) {
      const file = path.join(root, `previous-${String(index).padStart(3, "0")}.png`);
      fs.writeFileSync(file, png());
      const touched = new Date(now.getTime() - (CLIPBOARD_CACHE_MAX_FILES - index) * 1000);
      fs.utimesSync(file, touched, touched);
    }

    const realWrite = fs.promises.writeFile.bind(fs.promises);
    let releaseFirst!: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let writeCalls = 0;
    const writeSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async (...args) => {
      writeCalls += 1;
      if (writeCalls === 1) await firstWriteBlocked;
      return realWrite(...args);
    });

    const first = stageClipboardPng(root, png(), { now, id: "first", sessionId: "current-session" });
    let second: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(writeSpy).toHaveBeenCalledTimes(1));
      second = stageClipboardPng(root, png(), { now, id: "second", sessionId: "current-session" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(writeSpy).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      writeSpy.mockRestore();
    }

    const files = fs.readdirSync(root).filter((name) => name.endsWith(".png"));
    expect(files).toHaveLength(CLIPBOARD_CACHE_MAX_FILES);
    expect(files.filter((name) => name.startsWith("current-session-"))).toHaveLength(2);
  });
});
