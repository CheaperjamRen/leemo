import { describe, it, expect } from "vitest";
import {
  parseSlashQuery,
  filterSkillsByQuery,
  moveSelection,
  applySlashPick,
} from "./slash-menu";
import type { SkillInfo } from "../../bridge/contract";

const skill = (name: string, description = ""): SkillInfo => ({
  name,
  description,
  qualifiedName: `leemo:${name}`,
  dir: `/skills/${name}`,
  source: "user",
});

it("uses a hidden runtime command alias when a friendly label contains spaces", () => {
  expect(applySlashPick({
    ...skill("Excel 表格"),
    commandName: "xlsx",
  })).toBe("/xlsx ");
});

describe("parseSlashQuery — when the / menu is live", () => {
  it("opens on a bare slash with an empty query", () => {
    expect(parseSlashQuery("/")).toBe("");
  });

  it("captures the first word as the query while it is being typed", () => {
    expect(parseSlashQuery("/pd")).toBe("pd");
    expect(parseSlashQuery("/期末")).toBe("期末");
  });

  it("closes once the first word is finished (a space follows)", () => {
    // `/pdf 帮我填表` is an invocation in progress, not a menu interaction —
    // popping the list back up over the text the user is writing is noise.
    expect(parseSlashQuery("/pdf ")).toBeNull();
    expect(parseSlashQuery("/pdf 帮我填这个表")).toBeNull();
  });

  it("stays closed for text that does not start with /", () => {
    expect(parseSlashQuery("")).toBeNull();
    expect(parseSlashQuery("hello")).toBeNull();
    expect(parseSlashQuery("帮我/pdf")).toBeNull();
  });

  it("stays closed when the slash is not at the very start", () => {
    // Only a leading slash is a command; a path or date mid-message is not.
    expect(parseSlashQuery(" /pdf")).toBeNull();
    expect(parseSlashQuery("see /pdf")).toBeNull();
  });

  it("stays closed for a multi-line draft whose later line starts with /", () => {
    expect(parseSlashQuery("hi\n/pdf")).toBeNull();
  });
});

describe("filterSkillsByQuery", () => {
  const all = [skill("pdf", "填 PDF 表单"), skill("docx", "写 Word"), skill("期末速通", "考前突击")];

  it("returns everything for an empty query", () => {
    expect(filterSkillsByQuery(all, "").map((s) => s.name)).toEqual(["pdf", "docx", "期末速通"]);
  });

  it("matches on a name prefix", () => {
    expect(filterSkillsByQuery(all, "pd").map((s) => s.name)).toEqual(["pdf"]);
  });

  it("matches case-insensitively", () => {
    expect(filterSkillsByQuery(all, "PDF").map((s) => s.name)).toEqual(["pdf"]);
    expect(filterSkillsByQuery([skill("Feynman")], "fey").map((s) => s.name)).toEqual(["Feynman"]);
  });

  it("matches CJK names by substring", () => {
    expect(filterSkillsByQuery(all, "速通").map((s) => s.name)).toEqual(["期末速通"]);
  });

  it("falls back to the description so a half-remembered skill is still findable", () => {
    expect(filterSkillsByQuery(all, "突击").map((s) => s.name)).toEqual(["期末速通"]);
  });

  it("ranks name matches above description-only matches", () => {
    const list = [skill("notes", "整理 pdf 讲义"), skill("pdf", "表单")];
    expect(filterSkillsByQuery(list, "pdf").map((s) => s.name)).toEqual(["pdf", "notes"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterSkillsByQuery(all, "zzzz")).toEqual([]);
  });

  it("never offers a catalog item marked unavailable", () => {
    const unavailable = { ...skill("broken"), available: false, unavailableReason: "未就绪" };
    expect(filterSkillsByQuery([...all, unavailable], "").map((s) => s.name)).not.toContain("broken");
  });
});

describe("moveSelection — ↑↓ keyboard navigation", () => {
  it("moves down and up within range", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, -1, 3)).toBe(1);
  });

  it("wraps around both ends so the list is a loop", () => {
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
  });

  it("clamps to 0 for an empty list (nothing to select)", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
    expect(moveSelection(0, -1, 0)).toBe(0);
  });

  it("recovers from an out-of-range index after the list shrank", () => {
    // The user types another character, the filtered list gets shorter, and the
    // previously-selected index no longer exists.
    expect(moveSelection(7, 1, 2)).toBe(0);
    expect(moveSelection(7, -1, 2)).toBe(1);
  });
});

describe("applySlashPick — what lands in the textarea (铁律: BARE name only)", () => {
  it("replaces the draft with '/<bare name> '", () => {
    // 实测: a bare-name slash command works (`/zzprobe-trigger …` fired), which
    // is what lets the user keep seeing the name they installed.
    expect(applySlashPick(skill("pdf"))).toBe("/pdf ");
  });

  it("never emits the leemo: prefix the SDK uses internally", () => {
    const out = applySlashPick(skill("期末速通"));
    expect(out).toBe("/期末速通 ");
    expect(out).not.toContain("leemo:");
    expect(out).not.toContain(":");
  });

  it("leaves a trailing space so the user can type arguments straight away", () => {
    expect(applySlashPick(skill("docx")).endsWith(" ")).toBe(true);
  });
});
