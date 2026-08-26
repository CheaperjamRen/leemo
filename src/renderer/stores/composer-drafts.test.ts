import { describe, expect, it } from "vitest";
import {
  conversationComposerScope,
  createComposerDraftsStore,
  hydrateComposerDrafts,
  resolveComposerScope,
  serializeComposerDrafts,
  workspaceComposerScope,
} from "./composer-drafts";

describe("composer drafts", () => {
  it("keeps empty-workspace drafts independent while sharing the same scope across shells", () => {
    const store = createComposerDraftsStore();
    const home = workspaceComposerScope("leemo-home");
    const project = workspaceComposerScope("workspace-project");

    store.getState().setText(home, "home draft");
    store.getState().setText(project, "project draft");

    expect(store.getState().drafts[home]?.text).toBe("home draft");
    expect(store.getState().drafts[project]?.text).toBe("project draft");
    expect(workspaceComposerScope("leemo-home")).toBe(home);
  });

  it("keeps unsent drafts independent between managed books in the same workspace", () => {
    const store = createComposerDraftsStore();
    const calculus = workspaceComposerScope("leemo-home", "高等数学");
    const career = workspaceComposerScope("leemo-home", "秋招");

    store.getState().setText(calculus, "整理微积分笔记");
    store.getState().setText(career, "修改产品简历");

    expect(calculus).not.toBe(career);
    expect(store.getState().drafts[calculus]?.text).toBe("整理微积分笔记");
    expect(store.getState().drafts[career]?.text).toBe("修改产品简历");
    expect(resolveComposerScope(store.getState().drafts, null, "leemo-home", "高等数学"))
      .toBe(calculus);
  });

  it("keeps a failed first-turn draft attached to the conversation created for it", () => {
    const store = createComposerDraftsStore();
    const scope = workspaceComposerScope("leemo-home");
    store.getState().setText(scope, "do not lose me");
    store.getState().assignConversation(scope, "conversation-1");

    expect(resolveComposerScope(store.getState().drafts, "conversation-1", "leemo-home")).toBe(scope);
    expect(resolveComposerScope(store.getState().drafts, "conversation-2", "leemo-home"))
      .toBe(conversationComposerScope("conversation-2"));
  });

  it("keeps deleted-conversation text in its original book but releases the dead id", () => {
    const store = createComposerDraftsStore();
    const source = workspaceComposerScope("leemo-home", "高等数学");
    store.getState().setText(source, "不要丢掉这段未发送内容");
    store.getState().assignConversation(source, "deleted-conversation");

    store.getState().detachConversation("deleted-conversation");

    expect(store.getState().drafts[source]).toMatchObject({
      text: "不要丢掉这段未发送内容",
      assignedConversationId: null,
    });
  });

  it("moves an assigned draft out of its old book scope with its conversation", () => {
    const store = createComposerDraftsStore();
    const source = workspaceComposerScope("leemo-home", "高等数学");
    const conversationScope = conversationComposerScope("moved-conversation");
    store.getState().setText(source, "跟着对话去求职本子");
    store.getState().assignConversation(source, "moved-conversation");

    store.getState().relocateConversation("moved-conversation");

    expect(store.getState().drafts[source]).toBeUndefined();
    expect(store.getState().drafts[conversationScope]).toMatchObject({
      text: "跟着对话去求职本子",
      assignedConversationId: "moved-conversation",
    });
  });

  it("持久化文本和安全引用，重启时清理运行态与临时粘贴图并给出提示", () => {
    const scope = workspaceComposerScope("leemo-home");
    const persisted = serializeComposerDrafts({
      [scope]: {
        text: "这句重启后还要在",
        attachments: [
          { id: "file-1", name: "岗位.md", path: "C:\\隔离\\岗位.md", size: 12, mimeType: "text/markdown" },
          { id: "paste-1", name: "粘贴图片.png", path: "C:\\Temp\\paste.png", size: 24, mimeType: "image/png", temporary: true },
        ],
        workspaceFiles: [{ id: "workspace-1", name: "简历.md", workspaceId: "leemo-home", workspacePath: "求职/简历.md" }],
        submitPending: true,
        retryPending: true,
        submitError: "旧错误",
        pendingStageCount: 1,
        allowSubagents: false,
        planMode: true,
        assignedConversationId: "chapter-2",
      },
    });

    expect(persisted[scope]).toMatchObject({
      text: "这句重启后还要在",
      attachments: [{ id: "file-1", path: "C:\\隔离\\岗位.md" }],
      workspaceFiles: [{ id: "workspace-1", workspacePath: "求职/简历.md" }],
      lostTemporaryAttachmentCount: 2,
      allowSubagents: false,
      planMode: true,
      assignedConversationId: "chapter-2",
    });
    expect(persisted[scope]).not.toHaveProperty("submitPending");
    expect(persisted[scope]).not.toHaveProperty("submitError");

    const restored = hydrateComposerDrafts(persisted, new Set(["chapter-2"]));
    expect(restored[scope]).toMatchObject({
      text: "这句重启后还要在",
      attachments: [{ id: "file-1", path: "C:\\隔离\\岗位.md" }],
      workspaceFiles: [{ id: "workspace-1", workspacePath: "求职/简历.md" }],
      submitPending: false,
      retryPending: false,
      pendingStageCount: 0,
      submitError: "有 2 张未发送的粘贴图片在重启后不可恢复，请重新粘贴或从文件添加。",
      assignedConversationId: "chapter-2",
    });
  });

  it("丢弃纯空草稿并解除不存在章节的关联，但保留用户文本", () => {
    const restored = hydrateComposerDrafts({
      empty: { text: "", attachments: [], workspaceFiles: [], assignedConversationId: null },
      orphan: { text: "不要丢", attachments: [], workspaceFiles: [], assignedConversationId: "missing" },
    }, new Set());

    expect(restored.empty).toBeUndefined();
    expect(restored.orphan).toMatchObject({ text: "不要丢", assignedConversationId: null });
  });
});
