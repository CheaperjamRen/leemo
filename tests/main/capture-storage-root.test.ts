import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultCaptureStorageRoot,
  resolveCaptureStorageRoot,
} from "../../src/main/capture-storage-root";

describe("capture storage root", () => {
  it("uses a managed folder inside the visible Leemo workspace on first run", () => {
    const homeRoot = path.resolve("C:/Users/Rengar/Leemo");
    const resolved = resolveCaptureStorageRoot({}, homeRoot);

    expect(resolved).toEqual({
      root: path.join(homeRoot, ".leemo", "files"),
      usedDefault: true,
    });
    expect(defaultCaptureStorageRoot(homeRoot)).toBe(resolved.root);
  });

  it("keeps a valid user-selected absolute folder", () => {
    const selected = path.resolve("D:/Leemo Files");
    expect(resolveCaptureStorageRoot({ captureStorageRoot: `  ${selected}  ` }, "C:/Leemo"))
      .toEqual({ root: selected, usedDefault: false });
  });

  it("ignores a relative or empty persisted path", () => {
    const homeRoot = path.resolve("C:/Users/Rengar/Leemo");
    expect(resolveCaptureStorageRoot({ captureStorageRoot: "../other" }, homeRoot))
      .toEqual({ root: path.join(homeRoot, ".leemo", "files"), usedDefault: true });
    expect(resolveCaptureStorageRoot({ captureStorageRoot: "   " }, homeRoot).usedDefault).toBe(true);
  });
});
