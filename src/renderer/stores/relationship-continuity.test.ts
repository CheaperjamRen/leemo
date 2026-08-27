import { describe, expect, it } from "vitest";
import type { TimelineItem } from "./message-model";
import {
  buildRelationshipRecoveryPrompt,
  deriveRelationshipContinuationCheckpoint,
  isContinuationOnlyMessage,
} from "./relationship-continuity";

function item(value: TimelineItem): TimelineItem {
  return value;
}

describe("relationship continuity checkpoint", () => {
  const timeline: TimelineItem[] = [
    item({
      kind: "text",
      id: "u1",
      runId: "run-96",
      role: "user",
      text: "简历是这个，然后你帮我看看我怎么讲好简历里的故事，面试会问我怎么判断 AI 生成内容是否可用。",
      streaming: false,
      attachments: [
        { name: "AI产品简历-陈鹏杰.docx", size: 1024 },
        { name: "【AB test】有效获客泛化.pdf", size: 31_771_468 },
        { name: "模型优化结果.pdf", size: 2048 },
        { name: "从B端视角看有效获客做的怎么样.pdf", size: 2048 },
      ],
    }),
    item({
      kind: "text",
      id: "m1",
      runId: "run-96",
      role: "momo",
      text: "我来帮你把这份简历的故事讲好。先把你所有材料都读一遍。",
      streaming: false,
    }),
    item({
      kind: "tool",
      id: "t1",
      runId: "run-96",
      toolUseId: "read-resume",
      name: "读取文档",
      input: {},
      status: "ok",
      summary: "已读取简历",
      outcome: "completed",
    }),
    item({
      kind: "result",
      id: "r1",
      runId: "run-96",
      isError: false,
      interrupted: false,
      finalText: "",
      pathAudit: { claimed: [] },
      outcome: "completed",
    }),
    item({ kind: "text", id: "u2", runId: "run-97", role: "user", text: "继续", streaming: false }),
    item({ kind: "error", id: "e1", runId: "run-97", message: "模型权限不足" }),
    item({
      kind: "result",
      id: "r2",
      runId: "run-97",
      isError: true,
      interrupted: false,
      finalText: "",
      pathAudit: { claimed: [] },
      outcome: "failed",
    }),
    // Older unrelated artifact remains in the same local history. It must not
    // become the continuation merely because its filename still exists.
    item({
      kind: "files",
      id: "old-files",
      runId: "run-20",
      changes: [{ path: "流程图2_网点布局优化流程.html", change: "added" }],
      omitted: 0,
    }),
  ];

  it("keeps the latest meaningful user intent across continuation-only failures", () => {
    const checkpoint = deriveRelationshipContinuationCheckpoint({
      chapterId: "buddy-current",
      timeline,
      updatedAt: 1_000,
    });

    expect(checkpoint).toMatchObject({
      chapterId: "buddy-current",
      latestUserIntent: "简历是这个，然后你帮我看看我怎么讲好简历里的故事，面试会问我怎么判断 AI 生成内容是否可用。",
      assistantCommitment: "我来帮你把这份简历的故事讲好。先把你所有材料都读一遍。",
      progress: ["已读取简历"],
      attachmentNames: [
        "AI产品简历-陈鹏杰.docx",
        "【AB test】有效获客泛化.pdf",
        "模型优化结果.pdf",
        "从B端视角看有效获客做的怎么样.pdf",
      ],
    });
    expect(JSON.stringify(checkpoint)).not.toContain("流程图");
    expect(checkpoint?.basisRunIds).toEqual(["run-96"]);
  });

  it("builds a bounded hidden recovery block after the user's short message", () => {
    const checkpoint = deriveRelationshipContinuationCheckpoint({
      chapterId: "buddy-current",
      timeline,
      updatedAt: 1_000,
    });
    const prompt = buildRelationshipRecoveryPrompt("继续", checkpoint!);

    expect(prompt.startsWith("继续\n\n[Leemo 章节续接]")).toBe(true);
    expect(prompt).toContain("面试");
    expect(prompt).toContain("先把你所有材料都读一遍");
    expect(prompt).toContain("【AB test】有效获客泛化.pdf");
    expect(prompt.endsWith("[/Leemo 章节续接]")).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(2_400);
  });

  it("recognizes only weak continuation messages", () => {
    expect(isContinuationOnlyMessage("继续")).toBe(true);
    expect(isContinuationOnlyMessage("接着来吧。" )).toBe(true);
    expect(isContinuationOnlyMessage("继续帮我准备面试故事")).toBe(false);
  });
});
