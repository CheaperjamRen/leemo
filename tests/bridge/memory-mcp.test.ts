import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryMcp, LEEMO_MEMORY_TOOL_NAMES } from "../../src/bridge/memory-mcp";
import { createMemoryGovernance, type MemoryIO } from "../../src/host/memory-governance";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

const roots: string[] = [];

function createHarness(notebookId?: string, workspaceId?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-memory-mcp-"));
  roots.push(root);
  const io: MemoryIO = {
    exists: fs.existsSync,
    mkdirp: (target) => void fs.mkdirSync(target, { recursive: true }),
    readFile: (target) => fs.readFileSync(target, "utf8"),
    writeFile: (target, contents) => fs.writeFileSync(target, contents, "utf8"),
    appendFile: (target, contents) => fs.appendFileSync(target, contents, "utf8"),
    readdir: (target) => fs.readdirSync(target),
    rename: fs.renameSync,
    walkFiles: (target) => fs.readdirSync(target, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name)),
    remove: (target) => fs.rmSync(target, { recursive: true, force: true }),
  };
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  const governance = createMemoryGovernance({
    workspaceRoot: root,
    io,
    resolveWorkspaceRoot: (id) => id === workspaceId ? projectRoot : undefined,
  });
  const onChange = vi.fn();
  const mcp = createMemoryMcp({
    governance,
    conversationId: "conversation-private-id",
    ...(notebookId ? { notebookId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    onChange,
  });
  return { root, projectRoot, governance, mcp, onChange };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("createMemoryMcp", () => {
  it("exposes three stable Leemo tools through a real in-process SDK server", () => {
    const { mcp } = createHarness();
    expect(mcp.server).toMatchObject({ type: "sdk", name: "leemo-memory" });
    expect(LEEMO_MEMORY_TOOL_NAMES).toEqual({
      remember: "mcp__leemo-memory__remember",
      recall: "mcp__leemo-memory__recall",
      forget: "mcp__leemo-memory__forget",
    });
  });

  it("remembers a confirmed durable fact with the current message as provenance", async () => {
    const { governance, mcp, onChange } = createHarness();
    mcp.beginRound("user-message-7");
    const result = await mcp.runRemember({
      topic: "回复偏好",
      statement: "用户喜欢先给结论，再解释必要细节。",
      kind: "preference",
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toBe("记住了：用户喜欢先给结论，再解释必要细节。");
    expect(governance.list({ type: "global" }).records).toEqual([
      expect.objectContaining({
        topic: "回复偏好",
        sourceType: "explicit-user",
        sourceConversationId: "conversation-private-id",
        sourceMessageId: "user-message-7",
      }),
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(result.text).not.toMatch(/user-message|conversation|ledger|\.leemo/i);
  });

  it("defaults to the active notebook but can explicitly choose global scope", async () => {
    const { governance, mcp } = createHarness("秋招");
    await mcp.runRemember({ topic: "简历口径", statement: "简历强调可验证成果。", kind: "notebook" });
    await mcp.runRemember({ topic: "称呼", statement: "用户希望被称为 Rengar。", kind: "profile", scope: "global" });

    expect(governance.list({ type: "notebook", notebookId: "秋招" }).records).toHaveLength(1);
    expect(governance.list({ type: "global" }).records).toHaveLength(1);
  });

  it("defaults to the active project while allowing an explicit global preference", async () => {
    const { governance, mcp } = createHarness(undefined, "workspace-project");
    await mcp.runRemember({ topic: "项目约定", statement: "这个项目使用 pnpm。", kind: "state" });
    await mcp.runRemember({
      topic: "回复偏好",
      statement: "用户始终喜欢先看结论。",
      kind: "preference",
      scope: "global",
    });

    expect(governance.list({ type: "workspace", workspaceId: "workspace-project" }).records).toHaveLength(1);
    expect(governance.list({ type: "global" }).records).toHaveLength(1);
  });

  it("fails clearly when notebook scope is requested without an active notebook", async () => {
    const { governance, mcp } = createHarness();
    const result = await mcp.runRemember({
      topic: "本子约定",
      statement: "只写本子。",
      kind: "notebook",
      scope: "notebook",
    });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("当前没有打开本子");
    expect(governance.list({ type: "global" }).records).toEqual([]);
  });

  it("rejects secrets instead of persisting or echoing them as a success", async () => {
    const { governance, mcp } = createHarness();
    const result = await mcp.runRemember({
      topic: "API key",
      statement: "api_key: test-abcdefghijklmnopqrstuvwxyz",
      kind: "state",
    });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("敏感凭据");
    expect(governance.list({ type: "global" }).records).toEqual([]);
  });

  it("recalls bounded human-readable content and forgets matching current facts", async () => {
    const { governance, mcp, onChange } = createHarness();
    const first = governance.remember({
      scope: { type: "global" },
      kind: "goal",
      topic: "求职目标",
      statement: "用户当前目标是找到 AI 产品相关实习。",
      sourceType: "explicit-user",
      sourceMessageId: "private-source-id",
    });

    const recalled = await mcp.runRecall({ query: "AI 产品" });
    expect(recalled).toMatchObject({ isError: false });
    expect(recalled.text).toContain("用户当前目标是找到 AI 产品相关实习。");
    expect(recalled.text).not.toContain(first.record.id);
    expect(recalled.text).not.toContain("private-source-id");

    const forgotten = await mcp.runForget({ query: "求职目标" });
    expect(forgotten).toMatchObject({ isError: false });
    expect(forgotten.text).toBe("已忘掉：用户当前目标是找到 AI 产品相关实习。");
    expect(governance.list({ type: "global" }).records).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("never treats a blank forget query as permission to erase an entire scope", async () => {
    const { governance, mcp } = createHarness();
    governance.remember({
      scope: { type: "global" },
      kind: "preference",
      topic: "回复偏好",
      statement: "用户喜欢先给结论。",
      sourceType: "explicit-user",
    });

    const result = await mcp.runForget({ query: "   " });

    expect(result).toMatchObject({ isError: true, changes: [] });
    expect(result.text).toMatch(/说清|关键词|具体/);
    expect(governance.list({ type: "global" }).records).toHaveLength(1);
  });

  it("shares one 600-token recall budget across every recall in a round and resets next round", async () => {
    const { governance, mcp } = createHarness();
    for (let index = 0; index < 80; index += 1) {
      governance.remember({
        scope: { type: "global" },
        kind: "episode",
        topic: `经历 ${index}`,
        statement: `用户第 ${index} 条长期经历包含足够多的说明文字，用于验证反复召回不会把记忆上下文无限撑大。`,
        sourceType: "explicit-user",
      });
    }

    mcp.beginRound("u-budget-1");
    const recalled: string[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await mcp.runRecall({});
      if (result.text.startsWith("- ")) recalled.push(result.text);
    }
    expect(encode(recalled.join(""))).toHaveLength(600);
    expect((await mcp.runRecall({})).text).toContain("本轮已经回忆了足够多");

    mcp.beginRound("u-budget-2");
    expect((await mcp.runRecall({})).text).toContain("用户第");
  });
});
