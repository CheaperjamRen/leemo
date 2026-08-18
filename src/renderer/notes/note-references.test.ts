import { describe, expect, it } from "vitest";
import type { Note } from "../../captures";
import {
  buildBacklinks,
  extractNoteReferenceIds,
  noteReferenceHref,
} from "./note-references";

function note(id: string, markdown = ""): Note {
  return {
    id,
    title: id,
    markdown,
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: null,
  };
}

describe("local note references", () => {
  it("encodes stable note ids without turning them into browser URLs", () => {
    expect(noteReferenceHref("求职/产品 故事")).toBe(
      "leemo-note://%E6%B1%82%E8%81%8C%2F%E4%BA%A7%E5%93%81%20%E6%95%85%E4%BA%8B",
    );
  });

  it("extracts unique references in first-seen order and ignores malformed targets", () => {
    const markdown = [
      "[简历](leemo-note://note-resume)",
      "[重复](leemo-note://note-resume)",
      "[中文](leemo-note://%E4%BA%A7%E5%93%81)",
      "![不是便签](leemo-note://image-like)",
      "[坏编码](leemo-note://%E0%A4%A)",
      "[网页](https://example.com)",
      "裸地址 leemo-note://bare-not-a-link",
    ].join("\n");

    expect(extractNoteReferenceIds(markdown)).toEqual(["note-resume", "产品"]);
  });

  it("rebuilds backlinks from current Markdown instead of retaining stale edges", () => {
    const initial = [
      note("source-a", "[目标](leemo-note://target) [再次](leemo-note://target)"),
      note("source-b", "[目标](leemo-note://target)"),
      note("target"),
    ];
    expect(buildBacklinks(initial).get("target")).toEqual(["source-a", "source-b"]);

    const edited = [
      { ...initial[0]!, markdown: "[另一个](leemo-note://other)" },
      initial[1]!,
      initial[2]!,
    ];
    const rebuilt = buildBacklinks(edited);
    expect(rebuilt.get("target")).toEqual(["source-b"]);
    expect(rebuilt.get("other")).toEqual(["source-a"]);
  });
});
