import { describe, expect, it } from "vitest";
import {
  applyUserWorkOverviewCorrection,
  applyWorkOverviewPatch,
  migrateLegacyWorkOverview,
  normalizeWorkOverviewPatch,
  type WorkOverviewSnapshot,
} from "../../src/bridge/work-overview";

const previous: WorkOverviewSnapshot = {
  revision: 1,
  scopeConversationId: "conv-1",
  sourceRunId: "run-1",
  sourceToolUseId: "overview-1",
  updatedAt: 100,
  updateReason: "objective-set",
  basisEventIds: ["run-1", "overview-1"],
  actor: "momo",
  objective: "完成工作台连续性验收",
  objectiveSource: "semantic",
  successCriteria: ["恢复后能读到当前状态"],
  currentPhase: "实现中",
  currentFocus: "概览契约",
  nextKnown: ["补齐契约测试"],
  blockers: ["等待契约定稿"],
  decisions: [{ evidenceId: "decision-a", text: "保留真实本地文件夹", basisEventIds: ["tool-a"] }],
  completedHighlights: [{ evidenceId: "tool-a", text: "已验证基础桥接", basisEventIds: ["tool-a"] }],
  fieldAuthority: { objective: "momo", successCriteria: "momo" },
};

const metadata = {
  scopeConversationId: "conv-1",
  sourceRunId: "run-2",
  toolUseId: "overview-2",
  updatedAt: 200,
  actor: "momo" as const,
};

describe("work overview semantic checkpoints", () => {
  it("merges scalar and overwrite-list fields while appending evidence by id", () => {
    const next = applyWorkOverviewPatch(previous, {
      updateReason: "phase-changed",
      currentPhase: "验收中",
      nextKnown: ["打包并重启验收"],
      completedHighlights: [
        { evidenceId: "tool-a", text: "重复证据不会重复追加", basisEventIds: ["tool-a"] },
        { evidenceId: "artifact-b", text: "已生成验收产物", basisEventIds: ["artifact-b"] },
      ],
    }, metadata);

    expect(next.revision).toBe(2);
    expect(next.objective).toBe(previous.objective);
    expect(next.currentPhase).toBe("验收中");
    expect(next.nextKnown).toEqual(["打包并重启验收"]);
    expect(next.completedHighlights.map((item) => item.evidenceId)).toEqual(["tool-a", "artifact-b"]);
    expect(next.basisEventIds).toEqual(["run-2", "overview-2"]);
  });

  it("uses empty arrays and clearFields as the only clear operations", () => {
    const next = applyWorkOverviewPatch(previous, {
      updateReason: "recovered",
      basisEventIds: ["tool-result-2"],
      blockers: [],
      clearFields: ["currentFocus"],
    }, metadata);

    expect(next.blockers).toEqual([]);
    expect(next.currentFocus).toBeUndefined();
    expect(next.objective).toBe(previous.objective);
    expect(next.basisEventIds).toEqual(["run-2", "overview-2", "tool-result-2"]);
  });

  it("normalizes bounded semantic patches and rejects malformed or empty changes", () => {
    const normalized = normalizeWorkOverviewPatch({
      objective: "  完成连续性验收  ",
      successCriteria: [" 可以恢复当前状态 "],
      currentPhase: " 验收中 ",
      currentFocus: " 只检查核心路径 ",
      nextKnown: [" 打包验收 "],
      blockers: [" 等待重启 "],
      decisions: [{ evidenceId: "decision-1", text: "保留来源", basisEventIds: ["event-1"] }],
      completedHighlights: [{ evidenceId: "completed-1", text: "桥接已通过", basisEventIds: ["event-2"] }],
      updateReason: "phase-changed",
      basisEventIds: ["event-3"],
    });

    expect(normalized).toEqual({
      ok: true,
      value: {
        objective: "完成连续性验收",
        successCriteria: ["可以恢复当前状态"],
        currentPhase: "验收中",
        currentFocus: "只检查核心路径",
        nextKnown: ["打包验收"],
        blockers: ["等待重启"],
        decisions: [{ evidenceId: "decision-1", text: "保留来源", basisEventIds: ["event-1"] }],
        completedHighlights: [{ evidenceId: "completed-1", text: "桥接已通过", basisEventIds: ["event-2"] }],
        updateReason: "phase-changed",
        basisEventIds: ["event-3"],
      },
    });

    expect(normalizeWorkOverviewPatch({ objective: "x".repeat(161), updateReason: "objective-set" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ currentPhase: "x".repeat(121), updateReason: "phase-changed" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ currentFocus: "x".repeat(121), updateReason: "phase-changed" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ nextKnown: Array.from({ length: 6 }, () => "下一步"), updateReason: "phase-changed" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ blockers: ["x".repeat(121)], updateReason: "blocked" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ objective: "x".repeat(801), updateReason: "objective-set" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({
      successCriteria: Array.from({ length: 5 }, () => "x".repeat(120)),
      nextKnown: Array.from({ length: 2 }, () => "x".repeat(120)),
      updateReason: "phase-changed",
    }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({
      decisions: Array.from({ length: 6 }, (_, index) => ({
        evidenceId: `decision-${index}`,
        text: "有来源的决定",
        basisEventIds: ["event-1"],
      })),
      updateReason: "run-completed",
    }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ objective: "   ", updateReason: "objective-set" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ objective: 4, updateReason: "objective-set" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ objective: "有效", updateReason: "unknown" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ clearFields: ["objective", "objective"], updateReason: "objective-changed" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ updateReason: "manual-refresh", basisEventIds: ["event-1"] }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ decisions: [{ evidenceId: "", text: "没有来源", basisEventIds: ["event-1"] }], updateReason: "run-completed" }).ok).toBe(false);
    expect(normalizeWorkOverviewPatch({ completedHighlights: [{ evidenceId: "done", text: "没有来源", basisEventIds: [] }], updateReason: "run-completed" }).ok).toBe(false);
  });

  it("keeps user-owned stable fields when applying a model patch", () => {
    const userOwned: WorkOverviewSnapshot = {
      ...previous,
      fieldAuthority: { objective: "user", successCriteria: "user" },
    };

    const next = applyWorkOverviewPatch(userOwned, {
      objective: "模型不应覆盖",
      successCriteria: ["模型不应覆盖"],
      currentFocus: "模型可以更新当前重点",
      updateReason: "manual-refresh",
    }, metadata);

    expect(next.objective).toBe(previous.objective);
    expect(next.successCriteria).toEqual(previous.successCriteria);
    expect(next.currentFocus).toBe("模型可以更新当前重点");
  });

  it("does not let callers bypass patch normalization before applying a snapshot", () => {
    expect(() => applyWorkOverviewPatch(previous, {
      currentFocus: "伪造的未验证更新",
      updateReason: "unknown",
    } as never, metadata)).toThrow("更新原因无效");
    expect(() => applyWorkOverviewPatch(previous, {
      decisions: [{ evidenceId: "missing-source", text: "没有真实来源", basisEventIds: [] }],
      updateReason: "run-completed",
    } as never, metadata)).toThrow("至少一个真实来源");
  });

  it("records a local user correction without inventing run or tool provenance", () => {
    const next = applyUserWorkOverviewCorrection(previous, {
      objective: "用户确认的验收目标",
      successCriteria: ["用户确认恢复状态", "用户确认显示下一步"],
    }, {
      correctionId: "local-correction-1",
      scopeConversationId: "conv-1",
      updatedAt: 300,
    });

    expect(next).toMatchObject({
      revision: 2,
      scopeConversationId: "conv-1",
      sourceRunId: "",
      sourceToolUseId: "",
      updatedAt: 300,
      updateReason: "user-correction",
      actor: "user",
      objective: "用户确认的验收目标",
      successCriteria: ["用户确认恢复状态", "用户确认显示下一步"],
      fieldAuthority: { objective: "user", successCriteria: "user" },
    });
    expect(next.basisEventIds).toEqual(["local-correction-1"]);
  });

  it("keeps user authority after a local clear so model patches cannot restore stable fields", () => {
    const cleared = applyUserWorkOverviewCorrection(previous, {
      clearFields: ["objective", "successCriteria"],
    }, {
      correctionId: "local-correction-clear",
      scopeConversationId: "conv-1",
      updatedAt: 301,
    });

    const next = applyWorkOverviewPatch(cleared, {
      objective: "模型不能恢复用户清空的目标",
      successCriteria: ["模型不能恢复用户清空的标准"],
      updateReason: "manual-refresh",
    }, metadata);

    expect(cleared.objective).toBeUndefined();
    expect(cleared.successCriteria).toEqual([]);
    expect(cleared.fieldAuthority).toEqual({ objective: "user", successCriteria: "user" });
    expect(next.objective).toBeUndefined();
    expect(next.successCriteria).toEqual([]);
  });

  it("migrates legacy data without presenting its title as a verified objective", () => {
    const migrated = migrateLegacyWorkOverview({
      theme: "旧会话标题",
      summary: "此前正在整理连续性体验",
      currentPosition: "进入验收阶段",
      nextStep: "重启应用后检查",
      focus: "保留用户控制权",
    }, {
      scopeConversationId: "conv-legacy",
      updatedAt: 400,
    });

    expect(migrated).toMatchObject({
      revision: 1,
      scopeConversationId: "conv-legacy",
      sourceRunId: "",
      sourceToolUseId: "",
      updatedAt: 400,
      updateReason: "legacy-migration",
      actor: "legacy",
      objective: "旧会话标题",
      objectiveSource: "legacy-title",
      currentPhase: "进入验收阶段",
      currentFocus: "保留用户控制权",
      nextKnown: ["重启应用后检查"],
      decisions: [],
      completedHighlights: [],
    });
    expect(migrated?.fieldAuthority.objective).toBe("legacy");
    expect(migrated?.successCriteria).toEqual([]);
  });

  it("omits legacy values that exceed v2 checkpoint bounds", () => {
    expect(migrateLegacyWorkOverview({
      theme: "x".repeat(161),
      summary: "x".repeat(121),
      currentPosition: "x".repeat(121),
      nextStep: "x".repeat(121),
      focus: "x".repeat(121),
    }, {
      scopeConversationId: "conv-legacy",
      updatedAt: 400,
    })).toBeNull();
  });
});
