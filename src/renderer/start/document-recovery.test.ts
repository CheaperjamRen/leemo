import { beforeEach, describe, expect, it } from "vitest";
import {
  latestNewDocumentRecovery,
  readDocumentRecovery,
  removeDocumentRecovery,
  writeDocumentRecovery,
} from "./document-recovery";

describe("document recovery buffer", () => {
  beforeEach(() => localStorage.clear());

  it("persists one draft immediately and removes only the matching successful save", () => {
    writeDocumentRecovery({
      key: "note:alpha",
      noteId: "alpha",
      baseRevision: 3,
      title: "求职主线",
      markdown: "先写下自己的判断",
      updatedAt: 100,
    });
    writeDocumentRecovery({
      key: "note:beta",
      noteId: "beta",
      baseRevision: 1,
      title: "资料",
      markdown: "另一份草稿",
      updatedAt: 200,
    });

    expect(readDocumentRecovery("note:alpha")).toMatchObject({
      noteId: "alpha",
      baseRevision: 3,
      markdown: "先写下自己的判断",
    });
    removeDocumentRecovery("note:alpha");
    expect(readDocumentRecovery("note:alpha")).toBeNull();
    expect(readDocumentRecovery("note:beta")).toMatchObject({ noteId: "beta" });
  });

  it("restores the newest unsaved new document and ignores corrupt storage", () => {
    writeDocumentRecovery({
      key: "new:older",
      noteId: null,
      baseRevision: null,
      title: "旧草稿",
      markdown: "旧内容",
      updatedAt: 100,
    });
    writeDocumentRecovery({
      key: "new:newer",
      noteId: null,
      baseRevision: null,
      title: "新草稿",
      markdown: "新内容",
      updatedAt: 200,
    });
    expect(latestNewDocumentRecovery()).toMatchObject({ key: "new:newer", title: "新草稿" });

    localStorage.setItem("leemo:document-recovery:v1", "not json");
    expect(latestNewDocumentRecovery()).toBeNull();
    expect(readDocumentRecovery("new:newer")).toBeNull();
  });
});
