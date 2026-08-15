import { describe, expect, it } from "vitest";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";
import { collectConversationFiles } from "./workbench-files";

describe("collectConversationFiles", () => {
  it("collects attached, read, changed, and generated files without exposing unrelated workspace files", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text", id: "u1", runId: "r1", role: "user", text: "看看这些", streaming: false,
        attachments: [
          { name: "简历.pdf", size: 100, sourceKind: "local" },
          { name: "计划.md", size: 20, sourceKind: "workspace", workspaceId: "leemo-home", workspacePath: "默认工作区/计划.md" },
        ],
      },
      { kind: "tool", id: "t1", runId: "r1", toolUseId: "read", name: "Read", input: { file_path: "默认工作区/资料.md" }, status: "ok" },
      { kind: "files", id: "f1", runId: "r1", changes: [{ path: "默认工作区/结果.md", workspacePath: "默认工作区/结果.md", change: "added" }], omitted: 0 },
    ];
    const artifacts: ArtifactEntry[] = [{
      id: "artifact-1", kind: "file", path: "默认工作区/结果.md", title: "结果.md", bookId: null,
      sourceConversationId: "conv-1", sourceRunId: "r1", createdAt: 1, escaped: false,
    }, {
      id: "artifact-other", kind: "file", path: "默认工作区/别人的文件.md", title: "别人的文件.md", bookId: null,
      sourceConversationId: "conv-2", sourceRunId: "r2", createdAt: 2, escaped: false,
    }];

    const files = collectConversationFiles("conv-1", timeline, artifacts, "leemo-home");

    expect(files.map((file) => file.name)).toEqual(["简历.pdf", "计划.md", "资料.md", "结果.md"]);
    expect(files.find((file) => file.name === "简历.pdf")?.path).toBeNull();
    expect(files.find((file) => file.name === "计划.md")?.path).toBe("默认工作区/计划.md");
    expect(files.some((file) => file.name === "别人的文件.md")).toBe(false);
  });

  it("ignores failed tool reads and unsafe non-file tool inputs", () => {
    const timeline: TimelineItem[] = [
      { kind: "tool", id: "t1", runId: "r1", toolUseId: "bad", name: "Read", input: { file_path: "secret.md" }, status: "error" },
      { kind: "tool", id: "t2", runId: "r1", toolUseId: "grep", name: "Grep", input: { path: "." }, status: "ok" },
    ];
    expect(collectConversationFiles("conv-1", timeline, [], "leemo-home")).toEqual([]);
  });
});
