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
