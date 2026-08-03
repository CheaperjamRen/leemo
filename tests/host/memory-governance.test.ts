import path from "node:path";
import { describe, expect, it } from "vitest";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { createMemoryGovernance } from "../../src/host/memory-governance";
import { ensureMemoryBank } from "../../src/host/memory-bank";
import { DEFAULT_WORKSPACE_DIR } from "../../src/host/workspace";

type TestScope =
  | { type: "global" }
  | { type: "notebook"; notebookId: string }
  | { type: "workspace"; workspaceId: string };
type TestPaths = { directory: string; ledger: string; currentView: string };
type TestRecord = {
  id: string;
  scope: TestScope;
  kind: "profile" | "preference" | "state" | "goal" | "episode" | "notebook";
  topic: string;
  statement: string;
  learnedAt: number;
  validFrom?: number;
  validTo?: number;
  lastConfirmedAt?: number;
  sourceType: "explicit-user" | "native-auto" | "legacy-import" | "settings-edit";
  sourceConversationId?: string;
  sourceMessageId?: string;
  status: "current" | "uncertain" | "superseded" | "deleted";
  supersedes?: string;
  pinned: boolean;
};
type TestGovernance = {
  ensureScope(scope: TestScope): TestPaths;
  remember(input: {
    scope: TestScope;
    kind: TestRecord["kind"];
    topic: string;
    statement: string;
    sourceType: TestRecord["sourceType"];
    sourceConversationId?: string;
    sourceMessageId?: string;
    validFrom?: number;
  }): { changeId: string; action: string; label: string; record: TestRecord };
  list(scope: TestScope, options?: { includeInactive?: boolean }): {
    records: TestRecord[];
    diagnostics: string[];
  };
  history(scope: TestScope, memoryId: string): {
    records: TestRecord[];
    diagnostics: string[];
  };
  recall(input: {
    scope: TestScope;
    query?: string;
    atTime?: number;
    includeHistory?: boolean;
  }): {
    records: TestRecord[];
    text: string;
    diagnostics: string[];
  };
  update(input: {
    scope: TestScope;
    id: string;
    topic?: string;
    statement?: string;
    kind?: TestRecord["kind"];
    validFrom?: number;
    sourceConversationId?: string;
    sourceMessageId?: string;
  }): { changeId: string; action: string; label: string; record: TestRecord };
  remove(scope: TestScope, id: string): {
    changeId: string;
    action: string;
    label: string;
    record: TestRecord;
  };
  pin(scope: TestScope, id: string, pinned: boolean): {
    changeId: string;
    action: string;
    label: string;
    record: TestRecord;
  };
  undo(scope: TestScope, changeId: string): {
    ok: boolean;
    conflict?: boolean;
    changeId?: string;
    targetChangeId: string;
    action?: string;
    records?: TestRecord[];
  };
  rebuildViews(scopes: TestScope[]): { rebuilt: number; diagnostics: string[] };
  prepareNative(scope: TestScope, nativeDirectory?: string): {
    scope: TestScope;
    currentView: string;
    nativeDirectory?: string;
  };
  reconcileNative(
    baseline: { scope: TestScope; currentView: string; nativeDirectory?: string },
    source?: { conversationId?: string; messageId?: string },
  ): {
    changes: Array<{ changeId: string; action: string; label: string; record: TestRecord }>;
    diagnostics: string[];
  };
  migrateLegacyLayout(notebookIds: readonly string[]): {
    version: 1;
    alreadyCompleted: boolean;
    completed: boolean;
    imported: number;
    importedFiles: string[];
    archived: Array<{ from: string; to: string }>;
    movedArtifacts: Array<{ from: string; to: string }>;
    conflicts: string[];
    errors: string[];
    manifest: string;
  };
};

function fakeMemoryIO() {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const mkdirp = (dir: string) => {
    let cursor = dir;
    const pending: string[] = [];
    while (cursor && !dirs.has(cursor) && cursor !== path.dirname(cursor)) {
      pending.push(cursor);
      cursor = path.dirname(cursor);
    }
    for (const item of pending.reverse()) dirs.add(item);
  };
  const io = {
    exists: (target: string) => dirs.has(target) || files.has(target),
    mkdirp,
    readFile: (file: string) => {
      const value = files.get(file);
      if (value === undefined) throw new Error(`ENOENT: ${file}`);
      return value;
    },
    writeFile: (file: string, contents: string) => {
      mkdirp(path.dirname(file));
      files.set(file, contents);
    },
    appendFile: (file: string, contents: string) => {
      mkdirp(path.dirname(file));
      files.set(file, `${files.get(file) ?? ""}${contents}`);
    },
    readdir: (dir: string) => [...files.keys()]
      .filter((file) => path.dirname(file) === dir)
      .map((file) => path.basename(file)),
    rename: (from: string, to: string) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, value);
    },
    walkFiles: (dir: string) => [...files.keys()].filter((file) => {
      const relative = path.relative(dir, file);
      return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..";
    }),
    remove: (target: string) => {
      for (const file of [...files.keys()]) {
        const relative = path.relative(target, file);
        if (file === target || (relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..")) {
          files.delete(file);
        }
      }
      for (const dir of [...dirs]) {
        const relative = path.relative(target, dir);
        if (dir === target || (relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..")) {
          dirs.delete(dir);
        }
      }
    },
  };
  return { io, dirs, files };
}

const ROOT = path.resolve("C:\\fake-home\\Leemo");

function createHarness() {
  const fs = fakeMemoryIO();
  let currentTime = 1_000;
  let sequence = 0;
  const governance = createMemoryGovernance({
    workspaceRoot: ROOT,
    resolveWorkspaceRoot: (workspaceId: string) => workspaceId === "workspace-project"
      ? path.resolve("D:\\projects\\demo")
      : undefined,
    io: fs.io,
    now: () => currentTime,
    idFactory: () => `id-${++sequence}`,
  } as never) as unknown as TestGovernance;
  return {
    ...fs,
    governance,
    setNow: (value: number) => { currentTime = value; },
  };
}

describe("memory governance — fixed scope layout", () => {
  it("does not create a ledger or view for read-only queries on an unused scope", () => {
    const { governance, files, dirs } = createHarness();
    const scope = { type: "global" } as const;

    expect(governance.list(scope)).toEqual({ records: [], diagnostics: [] });
    expect(governance.history(scope, "missing-memory")).toEqual({ records: [], diagnostics: [] });
    expect(governance.recall({ scope, query: "不存在" })).toMatchObject({
      records: [],
      text: "",
      diagnostics: [],
    });
    expect(files.size).toBe(0);
    expect(dirs.size).toBe(0);
  });

  it("stores project memory under that external workspace without touching global memory", () => {
    const { governance } = createHarness();
    const scope = { type: "workspace", workspaceId: "workspace-project" } as const;
    const paths = governance.ensureScope(scope);
    governance.remember({
      scope,
      kind: "state",
      topic: "项目约定",
      statement: "这个项目使用 pnpm。",
      sourceType: "explicit-user",
    });

    expect(paths.directory).toBe(path.join(path.resolve("D:\\projects\\demo"), ".leemo", "memory"));
    expect(governance.list(scope).records).toHaveLength(1);
    expect(governance.list({ type: "global" }).records).toEqual([]);
  });

  it("creates exactly one ledger and one bounded current view for global memory", () => {
    const { governance, files } = createHarness();
    expect(governance.ensureScope).toEqual(expect.any(Function));
    if (!governance.ensureScope) return;

    const paths = governance.ensureScope({ type: "global" });

    expect(paths).toEqual({
      directory: path.join(ROOT, ".leemo", "memory", "global"),
      ledger: path.join(ROOT, ".leemo", "memory", "global", "ledger.jsonl"),
      currentView: path.join(ROOT, ".leemo", "memory", "global", "MEMORY.md"),
    });
    expect([...files.keys()].sort()).toEqual([paths.currentView, paths.ledger].sort());
    expect(files.get(paths.ledger)).toBe("");
    expect(files.get(paths.currentView)).toMatch(/^# momo memory/m);
  });

  it("uses the notebook's hidden Leemo directory without creating a third global scope", () => {
    const { governance, files } = createHarness();
    expect(governance.ensureScope).toEqual(expect.any(Function));
    if (!governance.ensureScope) return;

    const paths = governance.ensureScope({ type: "notebook", notebookId: "高等数学" });

    expect(paths.directory).toBe(path.join(ROOT, "高等数学", ".leemo", "memory"));
    expect([...files.keys()].sort()).toEqual([paths.currentView, paths.ledger].sort());
  });

  it("is idempotent and never overwrites an existing ledger", () => {
    const { governance, files } = createHarness();
    expect(governance.ensureScope).toEqual(expect.any(Function));
    if (!governance.ensureScope) return;
    const paths = governance.ensureScope({ type: "global" });
    files.set(paths.ledger, "existing-ledger-line\n");

    governance.ensureScope({ type: "global" });

    expect(files.get(paths.ledger)).toBe("existing-ledger-line\n");
  });

  it.each(["", "..", "a/b", "a\\b", "C:\\tmp", "默认工作区", "Inbox"])(
    "rejects invalid or non-notebook scope id %j",
    (notebookId) => {
      const { governance } = createHarness();
      expect(governance.ensureScope).toEqual(expect.any(Function));
      if (!governance.ensureScope) return;
      expect(() => governance.ensureScope({ type: "notebook", notebookId })).toThrow(/本子|scope/i);
    },
  );
});

describe("memory governance — append and replay", () => {
  const globalScope = { type: "global" } as const;

  it("appends an explicit fact and materializes only its useful statement", () => {
    const { governance, files } = createHarness();
    expect(governance.remember).toEqual(expect.any(Function));
    if (!governance.remember) return;

    const result = governance.remember({
      scope: globalScope,
      kind: "profile",
      topic: "用户专业",
      statement: "用户主修计算机科学。",
      sourceType: "explicit-user",
      sourceConversationId: "conversation-secret-id",
      sourceMessageId: "message-secret-id",
      validFrom: 900,
    });
    const paths = governance.ensureScope(globalScope);
    const ledgerLines = files.get(paths.ledger)!.trim().split("\n");

    expect(result).toMatchObject({
      action: "remembered",
      label: "用户主修计算机科学。",
      record: {
        kind: "profile",
        topic: "用户专业",
        statement: "用户主修计算机科学。",
        learnedAt: 1_000,
        validFrom: 900,
        lastConfirmedAt: 1_000,
        sourceType: "explicit-user",
        status: "current",
        pinned: false,
      },
    });
    expect(ledgerLines).toHaveLength(1);
    expect(JSON.parse(ledgerLines[0])).toMatchObject({ version: 1, action: "remember" });
    expect(files.get(paths.currentView)).toContain("用户主修计算机科学。");
    expect(files.get(paths.currentView)).not.toContain("conversation-secret-id");
    expect(files.get(paths.currentView)).not.toContain("message-secret-id");
    expect(files.size).toBe(2);
  });

  it("replays the append-only ledger after a process restart", () => {
    const harness = createHarness();
    expect(harness.governance.remember).toEqual(expect.any(Function));
    if (!harness.governance.remember) return;
    harness.governance.remember({
      scope: globalScope,
      kind: "preference",
      topic: "解释风格",
      statement: "解释时先说直觉，再给严谨推导。",
      sourceType: "explicit-user",
    });

    const restarted = createMemoryGovernance({
      workspaceRoot: ROOT,
      io: harness.io,
      now: () => 9_000,
      idFactory: () => "restart-id",
    } as never) as unknown as TestGovernance;
    expect(restarted.list).toEqual(expect.any(Function));
    if (!restarted.list) return;

    expect(restarted.list(globalScope)).toEqual({
      records: [expect.objectContaining({
        topic: "解释风格",
        statement: "解释时先说直觉，再给严谨推导。",
        status: "current",
      })],
      diagnostics: [],
    });
  });

  it("confirms the same fact without duplicating it", () => {
    const harness = createHarness();
    const first = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "当前学校",
      statement: "用户目前就读于海城大学。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);

    const confirmed = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: " 当前学校 ",
      statement: " 用户目前就读于海城大学。 ",
      sourceType: "explicit-user",
      sourceMessageId: "later-message",
    });
    const paths = harness.governance.ensureScope(globalScope);

    expect(confirmed).toMatchObject({
      action: "confirmed",
      record: {
        id: first.record.id,
        learnedAt: 1_000,
        lastConfirmedAt: 2_000,
        sourceMessageId: "later-message",
        status: "current",
      },
    });
    expect(harness.governance.list(globalScope, { includeInactive: true }).records).toHaveLength(1);
    expect(harness.files.get(paths.ledger)!.trim().split("\n")).toHaveLength(2);
    expect(harness.files.get(paths.currentView)!.match(/海城大学/g)).toHaveLength(1);
  });

  it("supersedes a changed fact while keeping its history off the current view", () => {
    const harness = createHarness();
    const oldFact = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "当前学校",
      statement: "用户目前就读于海城大学。",
      sourceType: "explicit-user",
    });
    harness.setNow(3_000);

    const changed = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "当前学校",
      statement: "用户已从海城大学毕业。",
      sourceType: "explicit-user",
      validFrom: 2_800,
    });
    const all = harness.governance.list(globalScope, { includeInactive: true }).records;
    const paths = harness.governance.ensureScope(globalScope);

    expect(changed).toMatchObject({
      action: "updated",
      record: {
        statement: "用户已从海城大学毕业。",
        validFrom: 2_800,
        supersedes: oldFact.record.id,
        status: "current",
      },
    });
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: oldFact.record.id,
        status: "superseded",
        validTo: 2_800,
      }),
      expect.objectContaining({
        id: changed.record.id,
        status: "current",
      }),
    ]));
    expect(harness.governance.list(globalScope).records).toHaveLength(1);
    expect(harness.files.get(paths.currentView)).toContain("用户已从海城大学毕业。");
    expect(harness.files.get(paths.currentView)).not.toContain("用户目前就读于海城大学。");
  });
});

describe("memory governance — scope and time", () => {
  const globalScope = { type: "global" } as const;
  const notebookScope = { type: "notebook", notebookId: "秋招" } as const;

  it("matches natural multi-keyword queries without requiring literal spaces or punctuation", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "当前学习工作状态",
      statement: "用户已毕业，目前在星河科技工作。",
      sourceType: "explicit-user",
    });

    expect(harness.governance.recall({
      scope: globalScope,
      query: "学习，工作 状态",
    }).records).toEqual([
      expect.objectContaining({ statement: "用户已毕业，目前在星河科技工作。", status: "current" }),
    ]);
  });

  it("keeps global and notebook facts isolated", () => {
    const { governance } = createHarness();
    governance.remember({
      scope: globalScope,
      kind: "preference",
      topic: "输出格式",
      statement: "用户全局偏好先给结论。",
      sourceType: "explicit-user",
    });
    governance.remember({
      scope: notebookScope,
      kind: "notebook",
      topic: "输出格式",
      statement: "秋招本子里的简历使用 STAR 格式。",
      sourceType: "explicit-user",
    });

    expect(governance.list(globalScope).records.map((record) => record.statement)).toEqual([
      "用户全局偏好先给结论。",
    ]);
    expect(governance.list(notebookScope).records.map((record) => record.statement)).toEqual([
      "秋招本子里的简历使用 STAR 格式。",
    ]);
  });

  it("retrieves the version that was valid at the requested time", () => {
    const harness = createHarness();
    const first = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "求职阶段",
      statement: "用户正在准备暑期实习。",
      sourceType: "explicit-user",
      validFrom: 500,
    });
    harness.setNow(3_000);
    const second = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "求职阶段",
      statement: "用户正在准备秋招。",
      sourceType: "explicit-user",
      validFrom: 2_500,
    });

    expect(harness.governance.recall({
      scope: globalScope,
      query: "求职",
      atTime: 1_500,
    }).records.map((record) => record.id)).toEqual([first.record.id]);
    expect(harness.governance.recall({
      scope: globalScope,
      query: "求职",
      atTime: 2_800,
    }).records.map((record) => record.id)).toEqual([second.record.id]);
  });

  it("returns a version chain only when history is requested", () => {
    const harness = createHarness();
    const first = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "所在城市",
      statement: "用户住在杭州。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);
    const second = harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "所在城市",
      statement: "用户住在上海。",
      sourceType: "explicit-user",
    });

    expect(harness.governance.history(globalScope, second.record.id).records.map((record) => record.id))
      .toEqual([second.record.id, first.record.id]);
    expect(harness.governance.recall({
      scope: globalScope,
      query: "城市",
    }).records.map((record) => record.id)).toEqual([second.record.id]);
    expect(harness.governance.recall({
      scope: globalScope,
      query: "城市",
      includeHistory: true,
    }).records.map((record) => record.id)).toEqual([second.record.id, first.record.id]);
  });
});

describe("memory governance — user control and audit", () => {
  const scope = { type: "global" } as const;

  it("edits by creating a new version and preserves the old version", () => {
    const harness = createHarness();
    const original = harness.governance.remember({
      scope,
      kind: "preference",
      topic: "回答风格",
      statement: "用户喜欢简洁回答。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);

    const edited = harness.governance.update({
      scope,
      id: original.record.id,
      statement: "用户喜欢先给结论，再解释必要细节。",
      sourceMessageId: "settings-edit-message",
    });
    const all = harness.governance.list(scope, { includeInactive: true }).records;

    expect(edited).toMatchObject({
      action: "updated",
      record: {
        sourceType: "settings-edit",
        status: "current",
        supersedes: original.record.id,
      },
    });
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.record.id, status: "superseded", validTo: 2_000 }),
      expect.objectContaining({ id: edited.record.id, status: "current" }),
    ]));
  });

  it("pins and tombstones without deleting audit history", () => {
    const harness = createHarness();
    const remembered = harness.governance.remember({
      scope,
      kind: "profile",
      topic: "MBTI",
      statement: "用户自我认同为 ENTP。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);
    const pinned = harness.governance.pin(scope, remembered.record.id, true);
    harness.setNow(3_000);
    const removed = harness.governance.remove(scope, remembered.record.id);

    expect(pinned).toMatchObject({ action: "pinned", record: { pinned: true } });
    expect(removed).toMatchObject({
      action: "removed",
      record: { status: "deleted", validTo: 3_000, pinned: true },
    });
    expect(harness.governance.list(scope).records).toEqual([]);
    expect(harness.governance.list(scope, { includeInactive: true }).records).toEqual([
      expect.objectContaining({ id: remembered.record.id, status: "deleted" }),
    ]);
  });

  it("undoes the latest change by appending an inverse event", () => {
    const harness = createHarness();
    const remembered = harness.governance.remember({
      scope,
      kind: "goal",
      topic: "近期目标",
      statement: "用户计划完成作品集。",
      sourceType: "explicit-user",
    });
    const removed = harness.governance.remove(scope, remembered.record.id);
    const paths = harness.governance.ensureScope(scope);
    const linesBeforeUndo = harness.files.get(paths.ledger)!.trim().split("\n").length;

    const undone = harness.governance.undo(scope, removed.changeId);

    expect(undone).toMatchObject({
      ok: true,
      action: "undone",
      targetChangeId: removed.changeId,
    });
    expect(harness.governance.list(scope).records).toEqual([
      expect.objectContaining({ id: remembered.record.id, status: "current" }),
    ]);
    expect(harness.files.get(paths.ledger)!.trim().split("\n")).toHaveLength(linesBeforeUndo + 1);
  });

  it("refuses an undo that would overwrite a later correction", () => {
    const harness = createHarness();
    const first = harness.governance.remember({
      scope,
      kind: "state",
      topic: "当前状态",
      statement: "用户在准备实习。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);
    harness.governance.remember({
      scope,
      kind: "state",
      topic: "当前状态",
      statement: "用户在准备秋招。",
      sourceType: "explicit-user",
    });

    expect(harness.governance.undo(scope, first.changeId)).toEqual({
      ok: false,
      conflict: true,
      targetChangeId: first.changeId,
    });
    expect(harness.governance.list(scope).records[0].statement).toBe("用户在准备秋招。");
  });

  it("skips corrupt JSONL rows while preserving later valid facts", () => {
    const harness = createHarness();
    const paths = harness.governance.ensureScope(scope);
    harness.files.set(paths.ledger, "not-json\n");
    harness.governance.remember({
      scope,
      kind: "profile",
      topic: "称呼",
      statement: "用户希望被称为 Rengar。",
      sourceType: "explicit-user",
    });

    const result = harness.governance.list(scope);
    expect(result.records).toEqual([
      expect.objectContaining({ statement: "用户希望被称为 Rengar。" }),
    ]);
    expect(result.diagnostics).toEqual([expect.stringMatching(/第 1 行.*无法解析/)]);
  });

  it("skips structurally invalid JSON events instead of materializing partial records", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope,
      kind: "profile",
      topic: "称呼",
      statement: "用户希望被称为 Rengar。",
      sourceType: "explicit-user",
    });
    const paths = harness.governance.ensureScope(scope);
    const validLedger = harness.files.get(paths.ledger)!;
    const malformed = JSON.stringify({
      version: 1,
      changeId: "malformed-event",
      at: 1,
      action: "remember",
      before: [],
      after: [{ id: "partial", status: "current" }],
    });
    harness.files.set(paths.ledger, `${malformed}\n${validLedger}`);

    const result = harness.governance.list(scope);
    expect(result.records).toEqual([
      expect.objectContaining({ statement: "用户希望被称为 Rengar。" }),
    ]);
    expect(result.diagnostics).toEqual([expect.stringMatching(/第 1 行.*格式不受支持/)]);
  });

  it("rebuilds a damaged current view from the append-only ledger", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope,
      kind: "preference",
      topic: "解释方式",
      statement: "用户希望先讲直觉。",
      sourceType: "explicit-user",
      sourceConversationId: "must-stay-out-of-view",
    });
    const paths = harness.governance.ensureScope(scope);
    harness.files.set(paths.currentView, "BROKEN VIEW");

    expect(harness.governance.rebuildViews([scope])).toEqual({ rebuilt: 1, diagnostics: [] });
    expect(harness.files.get(paths.currentView)).toContain("用户希望先讲直觉。");
    expect(harness.files.get(paths.currentView)).not.toContain("must-stay-out-of-view");
  });
});

describe("memory governance — privacy and context budgets", () => {
  const globalScope = { type: "global" } as const;
  const notebookScope = { type: "notebook", notebookId: "毕业设计" } as const;

  it.each([
    "API key 是 sk-live-abcdefghijklmnopqrstuvwxyz123456",
    "password=my-super-secret-password",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "我的验证码是 482913",
    "-----BEGIN PRIVATE KEY-----",
  ])("never persists sensitive memory: %s", (statement) => {
    const { governance, files } = createHarness();
    const paths = governance.ensureScope(globalScope);

    expect(() => governance.remember({
      scope: globalScope,
      kind: "profile",
      topic: "秘密",
      statement,
      sourceType: "explicit-user",
    })).toThrow(/敏感|秘密|凭据/);
    expect(files.get(paths.ledger)).toBe("");
    expect(files.get(paths.currentView)).not.toContain(statement);
  });

  it("applies the same sensitive filter to settings edits", () => {
    const harness = createHarness();
    const remembered = harness.governance.remember({
      scope: globalScope,
      kind: "preference",
      topic: "工具偏好",
      statement: "用户偏好使用本地工具。",
      sourceType: "explicit-user",
    });
    const paths = harness.governance.ensureScope(globalScope);
    const before = harness.files.get(paths.ledger);

    expect(() => harness.governance.update({
      scope: globalScope,
      id: remembered.record.id,
      statement: "password=do-not-store-this-secret",
    })).toThrow(/敏感|凭据/);
    expect(harness.files.get(paths.ledger)).toBe(before);
    expect(harness.governance.list(globalScope).records[0].statement).toBe("用户偏好使用本地工具。");
  });

  it("keeps speculative native candidates uncertain and out of the current prompt", () => {
    const { governance, files } = createHarness();
    const candidate = governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "搬家计划",
      statement: "用户可能下个月搬到上海。",
      sourceType: "native-auto",
    });
    const paths = governance.ensureScope(globalScope);

    expect(candidate).toMatchObject({ action: "candidate", record: { status: "uncertain" } });
    expect(governance.list(globalScope).records).toEqual([]);
    expect(governance.list(globalScope, { includeInactive: true }).records).toEqual([
      expect.objectContaining({ status: "uncertain" }),
    ]);
    expect(files.get(paths.currentView)).not.toContain("搬到上海");
  });

  it("orders pinned and stable facts before transient details", () => {
    const harness = createHarness();
    const episode = harness.governance.remember({
      scope: globalScope,
      kind: "episode",
      topic: "一次经历",
      statement: "用户昨天看了一场电影。",
      sourceType: "explicit-user",
    });
    harness.setNow(2_000);
    harness.governance.remember({
      scope: globalScope,
      kind: "profile",
      topic: "长期画像",
      statement: "用户是大学生。",
      sourceType: "explicit-user",
    });
    harness.setNow(3_000);
    harness.governance.pin(globalScope, episode.record.id, true);
    const paths = harness.governance.ensureScope(globalScope);
    const view = harness.files.get(paths.currentView)!;

    expect(view.indexOf("用户昨天看了一场电影。"))
      .toBeLessThan(view.indexOf("用户是大学生。"));
  });

  it("hard-caps global and notebook current views by tokens", () => {
    const harness = createHarness();
    for (let index = 0; index < 80; index += 1) {
      harness.setNow(1_000 + index);
      harness.governance.remember({
        scope: globalScope,
        kind: "preference",
        topic: `全局偏好 ${index}`,
        statement: `全局偏好第 ${index} 条：先说明结论，再解释关键原因，并避免无关铺垫。`,
        sourceType: "explicit-user",
      });
      harness.governance.remember({
        scope: notebookScope,
        kind: "notebook",
        topic: `本子决策 ${index}`,
        statement: `毕业设计第 ${index} 条决策：保留可复现证据，并记录下一步验收路径。`,
        sourceType: "explicit-user",
      });
    }

    const globalView = harness.files.get(harness.governance.ensureScope(globalScope).currentView)!;
    const notebookView = harness.files.get(harness.governance.ensureScope(notebookScope).currentView)!;
    expect(encode(globalView).length).toBeLessThanOrEqual(600);
    expect(encode(notebookView).length).toBeLessThanOrEqual(400);
  });

  it("hard-caps even one oversized statement", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope: globalScope,
      kind: "profile",
      topic: "超长画像",
      statement: "这是很长但仍需受预算约束的用户画像。".repeat(1_000),
      sourceType: "explicit-user",
    });
    const view = harness.files.get(harness.governance.ensureScope(globalScope).currentView)!;
    expect(encode(view).length).toBeLessThanOrEqual(600);
  });

  it("does not return uncertain candidates as facts in a historical time query", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope: globalScope,
      kind: "state",
      topic: "搬家",
      statement: "用户可能明年搬去上海。",
      sourceType: "native-auto",
      validFrom: 500,
    });
    expect(harness.governance.recall({
      scope: globalScope,
      query: "搬家",
      atTime: 1_000,
    }).records).toEqual([]);
  });

  it("caps on-demand historical recall independently at 600 tokens", () => {
    const harness = createHarness();
    for (let index = 0; index < 70; index += 1) {
      harness.setNow(1_000 + index * 2);
      harness.governance.remember({
        scope: globalScope,
        kind: "state",
        topic: `历史主题 ${index}`,
        statement: `历史记录 ${index}：这是只应按需加载的详细背景，不应长期占用普通对话上下文。`,
        sourceType: "explicit-user",
      });
    }

    const recalled = harness.governance.recall({
      scope: globalScope,
      query: "历史",
      includeHistory: true,
    });
    expect(encode(recalled.text).length).toBeLessThanOrEqual(600);
    expect(recalled.records.length).toBeLessThan(70);
  });
});

describe("memory governance — native auto-memory reconciliation", () => {
  const scope = { type: "global" } as const;

  it("imports only new native candidates and ignores native deletion", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope,
      kind: "profile",
      topic: "身份",
      statement: "用户是大学生。",
      sourceType: "explicit-user",
    });
    const baseline = harness.governance.prepareNative(scope);
    const paths = harness.governance.ensureScope(scope);

    // The native runtime rewrites its view: it omitted the existing fact and
    // added three candidates. Reconciliation must not treat omission as delete.
    harness.files.set(paths.currentView, [
      "# Memory",
      "",
      "## 工作习惯",
      "- 用户偏好夜间专注工作。",
      "- 用户可能明年搬去上海。",
      "- API key 是 sk-live-native-abcdefghijklmnopqrstuvwxyz",
      "",
    ].join("\n"));

    const result = harness.governance.reconcileNative(baseline, {
      conversationId: "conversation-native",
      messageId: "message-native",
    });
    const all = harness.governance.list(scope, { includeInactive: true }).records;
    const currentView = harness.files.get(paths.currentView)!;

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "remembered",
        record: expect.objectContaining({
          statement: "用户偏好夜间专注工作。",
          sourceType: "native-auto",
          sourceConversationId: "conversation-native",
          sourceMessageId: "message-native",
          status: "current",
        }),
      }),
      expect.objectContaining({
        action: "candidate",
        record: expect.objectContaining({ statement: "用户可能明年搬去上海。", status: "uncertain" }),
      }),
    ]));
    expect(all.map((record) => record.statement)).toEqual(expect.arrayContaining([
      "用户是大学生。",
      "用户偏好夜间专注工作。",
      "用户可能明年搬去上海。",
    ]));
    expect(all.some((record) => record.statement.includes("sk-live"))).toBe(false);
    expect(currentView).toContain("用户是大学生。");
    expect(currentView).toContain("用户偏好夜间专注工作。");
    expect(currentView).not.toContain("用户可能明年搬去上海。");
    expect(currentView).not.toContain("sk-live");
    expect(result.diagnostics).toEqual([expect.stringMatching(/敏感.*忽略/)]);
  });

  it("deduplicates lines already present in the baseline or ledger", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope,
      kind: "preference",
      topic: "沟通偏好",
      statement: "用户希望先给结论。",
      sourceType: "explicit-user",
    });
    const baseline = harness.governance.prepareNative(scope);
    const paths = harness.governance.ensureScope(scope);
    harness.files.set(paths.currentView, [
      baseline.currentView,
      "- 用户希望先给结论。",
      "- 用户希望先给结论。",
    ].join("\n"));

    const result = harness.governance.reconcileNative(baseline);

    expect(result.changes).toEqual([]);
    expect(harness.governance.list(scope, { includeInactive: true }).records).toHaveLength(1);
  });

  it("uses a private round directory, imports multi-file bodies, and removes the cache", () => {
    const harness = createHarness();
    harness.governance.remember({
      scope,
      kind: "profile",
      topic: "身份",
      statement: "用户是大学生。",
      sourceType: "explicit-user",
    });
    const nativeDirectory = path.resolve("C:\\private-leemo-data\\native-memory\\round-1");
    const baseline = harness.governance.prepareNative(scope, nativeDirectory);
    const nativeIndex = path.join(nativeDirectory, "MEMORY.md");
    const nativeDetail = path.join(nativeDirectory, "work-style.md");

    expect(harness.files.get(nativeIndex)).toContain("用户是大学生。");
    harness.io.writeFile(nativeIndex, [
      baseline.currentView,
      "- [工作习惯](work-style.md)",
    ].join("\n"));
    harness.io.writeFile(nativeDetail, [
      "---",
      "name: 工作习惯",
      "description: momo 自动整理的持久偏好",
      "type: user",
      "---",
      "",
      "# 工作习惯",
      "- 用户偏好夜间专注工作。",
    ].join("\n"));

    const result = harness.governance.reconcileNative(baseline, {
      conversationId: "conversation-native",
      messageId: "message-native",
    });
    const current = harness.governance.list(scope).records;
    const scopePaths = harness.governance.ensureScope(scope);

    expect(result.changes.map((change) => change.label)).toEqual(["用户偏好夜间专注工作。"]);
    expect(current.map((record) => record.statement)).toContain("用户偏好夜间专注工作。");
    expect(current.map((record) => record.statement)).not.toEqual(expect.arrayContaining([
      "name: 工作习惯",
      "description: momo 自动整理的持久偏好",
      "type: user",
      "[工作习惯](work-style.md)",
    ]));
    expect(harness.files.has(nativeIndex)).toBe(false);
    expect(harness.files.has(nativeDetail)).toBe(false);
    expect([...harness.files.keys()].sort()).toEqual([scopePaths.currentView, scopePaths.ledger].sort());
  });

  it("refuses a private native cache when it cannot guarantee cleanup", () => {
    const harness = createHarness();
    delete (harness.io as { remove?: unknown }).remove;
    expect(() => harness.governance.prepareNative(scope, "C:\\private\\round")).toThrow(/清理/);
  });
});

describe("memory governance — legacy layout migration", () => {
  const globalScope = { type: "global" } as const;

  function seedLegacyTemplates(harness: ReturnType<typeof createHarness>): void {
    ensureMemoryBank(ROOT, {
      exists: harness.io.exists,
      read: harness.io.readFile,
      write: harness.io.writeFile,
      mkdirp: harness.io.mkdirp,
    });
  }

  it("archives real empty legacy templates without inventing memories", () => {
    const harness = createHarness();
    seedLegacyTemplates(harness);

    const report = harness.governance.migrateLegacyLayout([]);

    expect(report).toMatchObject({ completed: true, imported: 0, errors: [] });
    expect(harness.governance.list(globalScope, { includeInactive: true }).records).toEqual([]);
    expect(report.archived).toHaveLength(5);
    for (const move of report.archived) {
      expect(harness.files.has(move.from)).toBe(false);
      expect(harness.files.has(move.to)).toBe(true);
    }
    expect(harness.files.has(report.manifest)).toBe(true);
  });

  it("imports only allowlisted legacy memory and moves unknown documents byte-for-byte", () => {
    const harness = createHarness();
    const researchBytes = "# AI 记忆研究\n\n这是普通研究产物，不是用户画像。\n";
    harness.io.writeFile(path.join(ROOT, "CLAUDE.md"), [
      "# momo 的记忆库",
      "## 当前状态",
      "用户正在准备秋招。",
      "## 记忆索引",
      "- memory/profile.md（用户画像）",
      "## 核心事实",
      "用户希望被称为 Rengar。",
    ].join("\n"));
    harness.io.writeFile(path.join(ROOT, "memory", "profile.md"), "# 用户画像\n\n用户是大学生。\n");
    harness.io.writeFile(path.join(ROOT, "memory", "preferences.md"), "# 偏好与雷区\n\n- 先给结论，再解释。\n");
    harness.io.writeFile(path.join(ROOT, "memory", "bookmarks.md"), "# 实时便签\n\n<2026-07-30 20:00> 正在完善 Leemo。\n");
    harness.io.writeFile(path.join(ROOT, "memory", "moments.md"), "# 重要时刻\n\n第一次完成可运行的桌面应用。\n");
    harness.io.writeFile(path.join(ROOT, "memory", "research-ai-memory.md"), researchBytes);
    harness.io.writeFile(path.join(ROOT, "秋招", "CLAUDE.md"), "# 本子约定\n\n简历要突出可验证成果。\n");

    const report = harness.governance.migrateLegacyLayout(["秋招"]);
    const global = harness.governance.list(globalScope).records;
    const notebook = harness.governance.list({ type: "notebook", notebookId: "秋招" }).records;
    const researchMove = report.movedArtifacts.find((move) => move.from.endsWith("research-ai-memory.md"));

    expect(report).toMatchObject({ completed: true, errors: [], imported: 7 });
    expect(global.map((record) => record.statement)).toEqual(expect.arrayContaining([
      "用户正在准备秋招。",
      "用户希望被称为 Rengar。",
      "用户是大学生。",
      "先给结论，再解释。",
      "<2026-07-30 20:00> 正在完善 Leemo。",
      "第一次完成可运行的桌面应用。",
    ]));
    expect(notebook.map((record) => record.statement)).toEqual(["简历要突出可验证成果。"]);
    expect([...global, ...notebook].some((record) => record.statement.includes("AI 记忆研究"))).toBe(false);
    expect(researchMove).toBeTruthy();
    expect(researchMove!.to).toBe(path.join(ROOT, DEFAULT_WORKSPACE_DIR, "research-ai-memory.md"));
    expect(harness.files.get(researchMove!.to)).toBe(researchBytes);
    expect(harness.files.has(researchMove!.from)).toBe(false);
  });

  it("uses a non-colliding artifact name instead of overwriting the default workspace", () => {
    const harness = createHarness();
    const oldArtifact = path.join(ROOT, "memory", "notes.md");
    const existing = path.join(ROOT, DEFAULT_WORKSPACE_DIR, "notes.md");
    harness.io.writeFile(oldArtifact, "旧 memory 目录里的普通文档");
    harness.io.writeFile(existing, "默认工作区里原有的文档");

    const report = harness.governance.migrateLegacyLayout([]);
    const moved = report.movedArtifacts[0];

    expect(moved.to).toBe(path.join(ROOT, DEFAULT_WORKSPACE_DIR, "notes (2).md"));
    expect(harness.files.get(existing)).toBe("默认工作区里原有的文档");
    expect(harness.files.get(moved.to)).toBe("旧 memory 目录里的普通文档");
  });

  it("is idempotent after a completed manifest", () => {
    const harness = createHarness();
    harness.io.writeFile(path.join(ROOT, "memory", "profile.md"), "# 用户画像\n\n用户是大学生。\n");
    const first = harness.governance.migrateLegacyLayout([]);
    const ledger = harness.files.get(harness.governance.ensureScope(globalScope).ledger);

    const second = harness.governance.migrateLegacyLayout([]);

    expect(first.completed).toBe(true);
    expect(second).toMatchObject({ alreadyCompleted: true, completed: true });
    expect(harness.files.get(harness.governance.ensureScope(globalScope).ledger)).toBe(ledger);
  });

  it("keeps a source file and withholds the completion manifest when archival fails", () => {
    const harness = createHarness();
    const source = path.join(ROOT, "memory", "profile.md");
    harness.io.writeFile(source, "# 用户画像\n\n用户是大学生。\n");
    const rename = harness.io.rename;
    harness.io.rename = (from, to) => {
      if (from === source) throw new Error("simulated rename failure");
      rename(from, to);
    };

    const report = harness.governance.migrateLegacyLayout([]);

    expect(report.completed).toBe(false);
    expect(report.errors).toEqual([expect.stringMatching(/profile\.md.*归档失败/)]);
    expect(harness.files.get(source)).toContain("用户是大学生");
    expect(harness.files.has(report.manifest)).toBe(false);
    expect(harness.governance.list(globalScope).records).toEqual([
      expect.objectContaining({ statement: "用户是大学生。", sourceType: "legacy-import" }),
    ]);
  });
});
