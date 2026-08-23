import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureStorage } from "../../src/main/capture-storage";

const roots: string[] = [];

function temporaryRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `leemo-${label}-`));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("capture storage", () => {
  it("stores managed images and file copies under the selected root while external files remain references", async () => {
    const root = temporaryRoot("capture-storage");
    const sourceRoot = temporaryRoot("capture-source");
    const source = path.join(sourceRoot, "材料.pdf");
    fs.writeFileSync(source, "source");
    const storage = createCaptureStorage({ randomId: () => "attachment-1", now: () => 100 });

    const image = await storage.storeImageBytes(root, "note-1", {
      name: "截图.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(image).toMatchObject({
      kind: "image",
      storage: "managed",
      path: "note-images/note-1/attachment-1-截图.png",
      size: 3,
    });
    expect(fs.readFileSync(path.join(root, image.path))).toEqual(Buffer.from([1, 2, 3]));

    const external = await storage.referenceExternalFile(source);
    expect(external).toMatchObject({ kind: "file", storage: "external", path: path.resolve(source) });

    const copy = await storage.copyExternalFile(root, "note-1", source);
    expect(copy).toMatchObject({
      kind: "file",
      storage: "managed",
      path: "inbox-attachments/file-copies/note-1/attachment-1-材料.pdf",
    });
    expect(fs.readFileSync(path.join(root, copy.path), "utf8")).toBe("source");
    expect(fs.readFileSync(source, "utf8")).toBe("source");

    await storage.removeAttachment(root, external);
    expect(fs.existsSync(source)).toBe(true);
    await storage.removeAttachment(root, copy);
    expect(fs.existsSync(path.join(root, copy.path))).toBe(false);
  });

  it("requires an explicit storage root, rejects missing sources, and explains full disks", async () => {
    const storage = createCaptureStorage();
    await expect(storage.storeImageBytes(undefined, "note-1", {
      name: "截图.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    })).rejects.toThrow(/选择.*存储位置/);
    await expect(storage.referenceExternalFile("E:\\missing-leemo-file.pdf")).rejects.toThrow(/不存在|找不到/);

    const fullDisk = createCaptureStorage({
      writeFile: async () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
    });
    await expect(fullDisk.storeImageBytes(temporaryRoot("full-disk"), "note-1", {
      name: "截图.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    })).rejects.toThrow(/空间不足/);
  });

  it("resolves only real attachment files and returns bounded preview payloads", async () => {
    const root = temporaryRoot("attachment-preview");
    const sourceRoot = temporaryRoot("attachment-preview-source");
    const markdownPath = path.join(sourceRoot, "思考.md");
    fs.writeFileSync(markdownPath, "# 自己先想\n\n再决定何时调用 momo。", "utf8");
    const storage = createCaptureStorage({ randomId: () => "attachment-preview", now: () => 100 });
    const external = await storage.referenceExternalFile(markdownPath);
    const managed = await storage.copyExternalFile(root, "note-1", markdownPath);

    await expect((storage as any).resolveAttachmentPath(root, external)).resolves.toBe(fs.realpathSync(markdownPath));
    await expect((storage as any).resolveAttachmentPath(root, managed)).resolves.toBe(fs.realpathSync(path.join(root, managed.path)));
    await expect((storage as any).readAttachmentPreview(root, external)).resolves.toEqual({
      kind: "markdown",
      name: "思考.md",
      text: "# 自己先想\n\n再决定何时调用 momo。",
    });

    const escaped = { ...managed, path: "../思考.md" };
    await expect((storage as any).resolveAttachmentPath(root, escaped)).rejects.toThrow(/超出|路径/);
    fs.rmSync(markdownPath);
    await expect((storage as any).resolveAttachmentPath(root, external)).rejects.toThrow(/移动|删除|不存在/);
  });

  it("copies managed storage through a temporary directory and keeps the old root", async () => {
    const oldRoot = temporaryRoot("old-storage");
    const parent = temporaryRoot("new-storage-parent");
    const newRoot = path.join(parent, "Leemo 文件");
    fs.mkdirSync(path.join(oldRoot, "note-images", "note-1"), { recursive: true });
    fs.writeFileSync(path.join(oldRoot, "note-images", "note-1", "image.png"), "image");

    const migrated = await createCaptureStorage({ randomId: () => "migration-1" })
      .migrateManagedStorage(oldRoot, newRoot);

    expect(migrated).toBe(path.resolve(newRoot));
    expect(fs.readFileSync(path.join(newRoot, "note-images", "note-1", "image.png"), "utf8")).toBe("image");
    expect(fs.readFileSync(path.join(oldRoot, "note-images", "note-1", "image.png"), "utf8")).toBe("image");
  });
});
