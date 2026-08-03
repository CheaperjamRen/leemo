import { describe, expect, it } from "vitest";
import type { WorkspaceFileNode } from "../workspace/client";
import {
  applyFileMentionPick,
  filterWorkspaceFiles,
  parseFileMention,
} from "./file-mention";

const roots: WorkspaceFileNode[] = [
  {
    path: "课程",
    name: "课程",
    kind: "dir",
    bookId: "课程",
    children: [
      { path: "课程/高等数学讲义.pdf", name: "高等数学讲义.pdf", kind: "file", bookId: "课程" },
      { path: "课程/复习计划.md", name: "复习计划.md", kind: "file", bookId: "课程" },
    ],
  },
  { path: "默认工作区/简历.docx", name: "简历.docx", kind: "file", bookId: null },
];

describe("parseFileMention", () => {
  it("opens for a standalone @ token at the caret", () => {
    expect(parseFileMention("请看 @高数", 6)).toEqual({ start: 3, end: 6, query: "高数" });
    expect(parseFileMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("does not turn email addresses or a completed earlier token into a menu", () => {
    expect(parseFileMention("mail@test.com", 13)).toBeNull();
    expect(parseFileMention("@讲义 后面", 6)).toBeNull();
  });
});

describe("filterWorkspaceFiles", () => {
  it("flattens the real tree and ranks file-name matches before path-only matches", () => {
    expect(filterWorkspaceFiles(roots, "高数").map((file) => file.path)).toEqual([
      "课程/高等数学讲义.pdf",
    ]);
    expect(filterWorkspaceFiles(roots, "课程").map((file) => file.name)).toEqual([
      "高等数学讲义.pdf",
      "复习计划.md",
    ]);
  });

  it("returns files only and caps an empty-query menu", () => {
    expect(filterWorkspaceFiles(roots, "").every((file) => file.kind === "file")).toBe(true);
  });
});

it("removes only the active @ token after a file becomes a chip", () => {
  expect(applyFileMentionPick("请总结 @高数", { start: 4, end: 7, query: "高数" })).toEqual({
    value: "请总结 ",
    caret: 4,
  });
});
