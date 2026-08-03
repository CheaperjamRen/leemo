import { describe, expect, it } from "vitest";
import {
  OFFICE_SKILL_DEFINITIONS,
  officeSkillMetadata,
  type OfficeSkillRuntimeSnapshot,
} from "../../src/host/office-skills";

const READY: OfficeSkillRuntimeSnapshot = {
  status: "ready",
  pluginPath: "C:\\Users\\Rengar\\AppData\\Roaming\\Leemo\\office-runtime\\plugin",
  revision: "abc123",
};

describe("Office Skills catalog", () => {
  it("ships exactly the four document capabilities as default-on Leemo skills", () => {
    expect(OFFICE_SKILL_DEFINITIONS.map((skill) => skill.id)).toEqual([
      "office-docx",
      "office-xlsx",
      "office-pptx",
      "office-pdf",
    ]);
    expect(OFFICE_SKILL_DEFINITIONS.every((skill) => skill.defaultEnabled)).toBe(true);
    expect(OFFICE_SKILL_DEFINITIONS.map((skill) => skill.qualifiedName)).toEqual([
      "leemo-office:docx",
      "leemo-office:xlsx",
      "leemo-office:pptx",
      "leemo-office:pdf",
    ]);
    expect(OFFICE_SKILL_DEFINITIONS.map((skill) => skill.commandName)).toEqual([
      "docx",
      "xlsx",
      "pptx",
      "pdf",
    ]);
  });

  it("reports ready skills without leaking a local plugin path to the renderer", () => {
    const catalog = officeSkillMetadata(READY);

    expect(catalog).toHaveLength(4);
    expect(catalog.every((skill) => skill.available)).toBe(true);
    expect(catalog.every((skill) => skill.source === "builtin")).toBe(true);
    expect(catalog.every((skill) => skill.trust === "leemo")).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain(READY.pluginPath);
  });

  it.each([
    [{ status: "preparing" } satisfies OfficeSkillRuntimeSnapshot, "正在准备"],
    [{ status: "error", error: "内置 Office 技能包未找到" } satisfies OfficeSkillRuntimeSnapshot, "内置 Office 技能包未找到"],
  ])("keeps the cards visible but disabled when runtime is %s", (snapshot, reason) => {
    const catalog = officeSkillMetadata(snapshot);

    expect(catalog.every((skill) => skill.available === false)).toBe(true);
    expect(catalog.every((skill) => skill.unavailableReason?.includes(reason))).toBe(true);
  });
});
