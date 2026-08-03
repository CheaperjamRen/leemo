import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  createApprovalBroker,
  classifyRisk,
  createAskUserMcp,
  LEEMO_ASK_USER_TOOL,
  type ApprovalTransport,
  type ApprovalPersistence,
  type ApprovalRequest,
  type ApprovalDecision,
  type WhitelistEntry,
  type PermissionPolicy,
  type AskUserTransport,
  type AskUserPayload,
  type AskUserAnswer,
  type RuntimeCapabilityState,
} from "../../src/bridge/interact";
import { LEEMO_MEMORY_TOOL_NAMES } from "../../src/bridge/memory-mcp";
import { LEEMO_WEB_SEARCH_TOOL } from "../../src/bridge/web-search-mcp";
import { LEEMO_ACADEMIC_SEARCH_TOOL } from "../../src/bridge/academic-search-mcp";
import { LEEMO_DOCUMENT_TOOL_NAMES } from "../../src/bridge/document-mcp";
import { LEEMO_SKILL_ADMIN_TOOL_NAMES } from "../../src/bridge/skill-admin-mcp";
import { LEEMO_VISUALIZATION_TOOL_NAME } from "../../src/bridge/visualization-spec";

// B3 — interaction bridge: ApprovalBroker (canUseTool three-tier + danger
// downgrade + concurrency) and ask_user MCP (blocking round-trip + timeout +
// concurrency). Every fake transport/persistence is INJECTED so assertions
// inspect real round-trip behavior (did the 2nd call actually skip transport?
// did persistence actually get written?) — not a mock echoing itself. Zero
// live SDK calls; zero real keys.

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---- fakes: approval transport + persistence --------------------------------

/** Immediately answers each request with a scripted decision-kind (id echoed). */
function scriptedApprovalTransport(pick: (req: ApprovalRequest) => ApprovalDecision["decision"]) {
  const seen: ApprovalRequest[] = [];
  const transport: ApprovalTransport = {
    async request(req) {
      seen.push(req);
      return { id: req.id, decision: pick(req) };
    },
  };
  return { transport, seen };
}

/** Parks each request so the test resolves them by hand (out of order → proves
 *  waiters don't cross). */
function deferredApprovalTransport() {
  const pending: Array<{
    req: ApprovalRequest;
    resolve: (d: ApprovalDecision) => void;
    reject: (e: unknown) => void;
  }> = [];
  const transport: ApprovalTransport = {
    request(req) {
      return new Promise<ApprovalDecision>((resolve, reject) => {
        pending.push({ req, resolve, reject });
      });
    },
  };
  return { transport, pending };
}

/** In-memory persistence stand-in for the Phase-1 SQLite whitelist. */
function memoryPersistence() {
  const list: WhitelistEntry[] = [];
  const persistence: ApprovalPersistence = {
    getWhitelist() {
      return list;
    },
    addToWhitelist(entry) {
      list.push(entry);
    },
    removeFromWhitelist(entry) {
      const index = list.findIndex((candidate) => candidate.toolName === entry.toolName && candidate.risk === entry.risk);
      if (index >= 0) list.splice(index, 1);
    },
  };
  return { persistence, list };
}

/** A valid `canUseTool` options object (signal/toolUseID/requestId are required
 *  per the real d.ts signature). */
function o(): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: "tu-" + Math.random().toString(36).slice(2),
    requestId: "rq-" + Math.random().toString(36).slice(2),
  } as unknown as Parameters<CanUseTool>[2];
}

const ALL_RUNTIME_CAPABILITIES: RuntimeCapabilityState = {
  webSearchEnabled: true,
  webFetchEnabled: true,
  rememberMode: true,
  browserEnabled: true,
  computerEnabled: true,
};

function capabilityBroker(
  conversationId: string,
  transport: ApprovalTransport,
  persistence: ApprovalPersistence,
  policy: PermissionPolicy,
  capabilities: RuntimeCapabilityState,
) {
  return createApprovalBroker(conversationId, transport, persistence, policy, capabilities);
}

/** Narrow away the `| null` the CanUseTool return type allows (the broker never
 *  returns null — that's reserved for out-of-band control_response). */
async function decide(
  fn: CanUseTool,
  tool: string,
  input: Record<string, unknown>
): Promise<PermissionResult> {
  const r = await fn(tool, input, o());
  expect(r).not.toBeNull();
  return r as PermissionResult;
}

// ===========================================================================
// classifyRisk — danger seed list
// ===========================================================================

describe("classifyRisk — Bash danger seed list (non-exhaustive)", () => {
  const dangerous = [
    "rm -rf /",
    "rm -fr ~/project",
    "del /f /q C:\\temp",
    "format C:",
    "mkfs.ext4 /dev/sda1",
    "reg add HKLM\\Software\\X /v Y /d 1",
    "reg delete HKCU\\Software\\X",
    "dd if=/dev/zero of=/dev/sda",
    "diskpart",
    "fdisk /dev/sdb",
  ];
  for (const command of dangerous) {
    it(`flags dangerous: ${command}`, () => {
      expect(classifyRisk("Bash", { command })).toBe("dangerous");
    });
  }

  const ordinary = ["ls -la", "git status", "npm test", "echo done", "cat file.txt"];
  for (const command of ordinary) {
    it(`does NOT flag ordinary command as dangerous: ${command}`, () => {
      expect(classifyRisk("Bash", { command })).not.toBe("dangerous");
    });
  }

  it("read-only tools classify as safe", () => {
    expect(classifyRisk("Read", { file_path: "a.txt" })).toBe("safe");
    expect(classifyRisk("Grep", { pattern: "x" })).toBe("safe");
    expect(classifyRisk(LEEMO_SKILL_ADMIN_TOOL_NAMES.inspect, { source: "https://github.com/example/skill" })).toBe("safe");
    expect(classifyRisk(LEEMO_SKILL_ADMIN_TOOL_NAMES.scan, { source: "https://github.com/example/skill" })).toBe("safe");
  });

  it("a write/exec tool with no dangerous pattern classifies as moderate", () => {
    expect(classifyRisk("Write", { file_path: "a.txt", content: "hi" })).toBe("moderate");
    expect(classifyRisk("Bash", { command: "ls -la" })).toBe("moderate");
    expect(classifyRisk(LEEMO_SKILL_ADMIN_TOOL_NAMES.install, { source: "https://github.com/example/skill" })).toBe("moderate");
    expect(classifyRisk(LEEMO_SKILL_ADMIN_TOOL_NAMES.remove, { id: "managed:demo" })).toBe("moderate");
  });

  it("applies the same danger boundary to Claude Code's Windows PowerShell tool", () => {
    expect(classifyRisk("PowerShell", { command: "Remove-Item -Recurse -Force C:\\Users\\R\\notes" })).toBe("dangerous");
    expect(classifyRisk("PowerShell", { command: "reg delete HKCU\\Software\\X /f" })).toBe("dangerous");
    expect(classifyRisk("PowerShell", { command: "npm test" })).toBe("moderate");
  });
});

// ===========================================================================
// ApprovalBroker — built-in read-only tools are frictionless
// ===========================================================================

describe("ApprovalBroker — built-in read-only tools never repeat consent", () => {
  it("auto-allows local reads, planning, and enabled web tools with zero approval cards", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const policy: PermissionPolicy = { mode: "default", dangerousCommandCaching: false };
    const broker = capabilityBroker("conv-1", transport, persistence, policy, ALL_RUNTIME_CAPABILITIES);

    for (const [tool, input] of [
      ["Read", { file_path: "notes.md" }],
      ["Grep", { pattern: "期末" }],
      ["Glob", { pattern: "**/*.md" }],
      ["NotebookRead", { notebook_path: "analysis.ipynb" }],
      ["TodoWrite", { todos: [] }],
      ["Task", { description: "统计文件" }],
      ["TaskOutput", { task_id: "task-1" }],
      ["TaskList", {}],
      ["Skill", { skill: "费曼导师" }],
      ["Workflow", { name: "review" }],
      ["WebSearch", { query: "北京天气" }],
      ["WebFetch", { url: "https://example.com" }],
      ["mcp__playwright__browser_navigate", { url: "https://example.com" }],
      ["mcp__playwright__browser_snapshot", {}],
      ["mcp__playwright__browser_take_screenshot", {}],
    ] as const) {
      const result = await decide(broker.canUseTool, tool, input as Record<string, unknown>);
      expect(result.behavior, `${tool} should not ask twice for an already enabled capability`).toBe("allow");
    }

    expect(seen).toEqual([]);
    expect(list).toEqual([]);
  });

  it("denies disabled built-in capabilities before bypass and without an approval card", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "bypassPermissions", dangerousCommandCaching: false },
      {
        webSearchEnabled: false,
        webFetchEnabled: false,
        rememberMode: false,
        browserEnabled: false,
        computerEnabled: false,
      },
    );

    for (const [tool, input] of [
      ["WebSearch", { query: "latest news" }],
      ["WebFetch", { url: "https://example.com" }],
      [LEEMO_WEB_SEARCH_TOOL, { query: "latest news" }],
      [LEEMO_ACADEMIC_SEARCH_TOOL, { query: "retrieval" }],
      [LEEMO_MEMORY_TOOL_NAMES.recall, { query: "user preference" }],
      ["mcp__playwright__browser_snapshot", {}],
      ["mcp__playwright__browser_click", { ref: "e12" }],
      ["mcp__playwright__browser_evaluate", { expression: "document.title" }],
      ["mcp__computer__ui_snapshot", {}],
    ] as const) {
      const result = await decide(broker.canUseTool, tool, input as Record<string, unknown>);
      expect(result.behavior, `${tool} should follow its disabled capability`).toBe("deny");
    }

    expect(seen).toEqual([]);
  });

  it("auto-allows routine browser interaction after the user enables browser automation", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    for (const [tool, input] of [
      ["mcp__playwright__browser_click", { element: "查看职位详情", ref: "e12" }],
      ["mcp__playwright__browser_type", { ref: "e13", text: "Rengar" }],
      ["mcp__playwright__browser_select_option", { ref: "e14", values: ["Tokyo"] }],
    ] as const) {
      const result = await decide(broker.canUseTool, tool, input as Record<string, unknown>);
      expect(result.behavior).toBe("allow");
    }
    expect(seen).toEqual([]);
  });

  it("asks once per task for ordinary desktop operation, but confirms final actions exactly", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-computer",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    await decide(broker.canUseTool, "mcp__computer__ui_snapshot", {});
    await decide(broker.canUseTool, "mcp__computer__ui_type", {
      windowHandle: "42",
      name: "Text editor",
      text: "Leemo 电脑操作验收",
    });
    await decide(broker.canUseTool, "mcp__computer__mouse_control", {
      action: "scroll",
      direction: "down",
    });
    expect(seen).toHaveLength(1);

    const send = { windowHandle: "42", name: "发送" };
    await decide(broker.canUseTool, "mcp__computer__ui_click", send);
    await decide(broker.canUseTool, "mcp__computer__ui_click", send);
    expect(seen).toHaveLength(2);

    broker.beginTask();
    await decide(broker.canUseTool, "mcp__computer__ui_snapshot", {});
    expect(seen).toHaveLength(3);
  });

  it("keeps unsupported desktop helpers outside the first-party task grant", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-computer",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );
    for (const tool of ["clipboard", "ui_macro", "ui_batch", "file_save", "file_open"]) {
      expect(await decide(broker.canUseTool, `mcp__computer__${tool}`, {})).toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("尚未开放"),
      });
    }
    for (const programPath of ["powershell.exe", "C:\\Windows\\System32\\cmd.exe", "C:\\temp\\setup.ps1"]) {
      expect(await decide(broker.canUseTool, "mcp__computer__app", { programPath })).toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("尚未开放"),
      });
    }
    expect(seen).toEqual([]);
  });

  it("keeps save and overwrite clicks on exact desktop confirmation keys", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-computer",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    await decide(broker.canUseTool, "mcp__computer__ui_click", { windowHandle: "42", name: "保存" });
    await decide(broker.canUseTool, "mcp__computer__ui_click", { windowHandle: "42", name: "保存" });
    await decide(broker.canUseTool, "mcp__computer__ui_click", { windowHandle: "42", name: "覆盖文件" });

    expect(seen).toHaveLength(2);
  });

  it("binds app launches to exact program arguments while granting routine work in that app", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-computer",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    await decide(broker.canUseTool, "mcp__computer__app", { programPath: "notepad.exe" });
    await decide(broker.canUseTool, "mcp__computer__ui_snapshot", {});
    await decide(broker.canUseTool, "mcp__computer__app", { programPath: "calc.exe" });
    await decide(broker.canUseTool, "mcp__computer__app", { programPath: "calc.exe" });

    expect(seen).toHaveLength(2);
  });

  it("keeps destructive keyboard shortcuts exact while navigation shortcuts share the task grant", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-computer",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    await decide(broker.canUseTool, "mcp__computer__ui_snapshot", {});
    await decide(broker.canUseTool, "mcp__computer__keyboard_control", { action: "press", key: "tab", modifiers: "alt" });
    await decide(broker.canUseTool, "mcp__computer__keyboard_control", { action: "press", key: "s", modifiers: "ctrl" });
    await decide(broker.canUseTool, "mcp__computer__keyboard_control", { action: "press", key: "s", modifiers: "ctrl" });
    await decide(broker.canUseTool, "mcp__computer__keyboard_control", { action: "press", key: "delete", modifiers: "shift" });
    await decide(broker.canUseTool, "mcp__computer__keyboard_control", { action: "press", key: "f4", modifiers: "alt" });

    expect(seen).toHaveLength(4);
  });

  it("lets full access skip desktop cards only after the user has enabled screen access", async () => {
    const first = scriptedApprovalTransport(() => "deny");
    const { persistence } = memoryPersistence();
    const enabled = capabilityBroker(
      "conv-computer",
      first.transport,
      persistence,
      { mode: "bypassPermissions", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );
    expect((await decide(enabled.canUseTool, "mcp__computer__ui_snapshot", {})).behavior).toBe("allow");
    expect(first.seen).toEqual([]);
  });

  it("asks once at the actual final browser action while leaving routine navigation quiet", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    expect((await decide(broker.canUseTool, "mcp__playwright__browser_click", {
      element: "查看职位详情",
      target: "e12",
    })).behavior).toBe("allow");
    expect(seen).toHaveLength(0);

    const finalInput = { element: "提交求职申请", target: "e27" };
    expect((await decide(broker.canUseTool, "mcp__playwright__browser_click", finalInput)).behavior).toBe("allow");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      toolName: "mcp__playwright__browser_click",
      risk: "moderate",
    });

    expect((await decide(broker.canUseTool, "mcp__playwright__browser_click", finalInput)).behavior).toBe("allow");
    expect(seen).toHaveLength(1);
  });

  it("fails closed for an opaque click target and Enter-based send shortcuts", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    for (const [tool, input] of [
      ["mcp__playwright__browser_click", { target: "e27" }],
      ["mcp__playwright__browser_press_key", { key: "Control+Enter" }],
      ["mcp__playwright__browser_press_key", { key: "Meta+Enter" }],
    ] as const) {
      expect((await decide(broker.canUseTool, tool, input)).behavior).toBe("allow");
    }
    expect(seen).toHaveLength(3);
  });

  it("does not mistake ordinary labels containing action-word fragments for a final action", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    expect((await decide(broker.canUseTool, "mcp__playwright__browser_click", {
      element: "Edit postcode",
      ref: "e31",
    })).behavior).toBe("allow");
    expect(seen).toEqual([]);
  });

  it("treats type-and-submit as a final browser action but full access remains zero-friction", async () => {
    const first = memoryPersistence();
    const prompted = scriptedApprovalTransport(() => "allow-once");
    const normal = capabilityBroker(
      "conv-1",
      prompted.transport,
      first.persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );
    expect((await decide(normal.canUseTool, "mcp__playwright__browser_type", {
      element: "搜索框",
      target: "e4",
      text: "Leemo",
      submit: true,
    })).behavior).toBe("allow");
    expect(prompted.seen).toHaveLength(1);

    const second = memoryPersistence();
    const bypassed = scriptedApprovalTransport(() => "deny");
    const fullAccess = capabilityBroker(
      "conv-2",
      bypassed.transport,
      second.persistence,
      { mode: "bypassPermissions", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );
    expect((await decide(fullAccess.canUseTool, "mcp__playwright__browser_type", {
      element: "搜索框",
      target: "e4",
      text: "Leemo",
      submit: true,
    })).behavior).toBe("allow");
    expect(bypassed.seen).toHaveLength(0);
  });

  it("still asks before sensitive browser operations such as arbitrary script and file upload", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    for (const [tool, input] of [
      ["mcp__playwright__browser_evaluate", { expression: "document.cookie" }],
      ["mcp__playwright__browser_file_upload", { paths: ["resume.pdf"] }],
    ] as const) {
      expect((await decide(broker.canUseTool, tool, input as Record<string, unknown>)).behavior).toBe("allow");
    }
    expect(seen).toHaveLength(2);
  });
});

describe("ApprovalBroker — optional filesystem boundary", () => {
  const temporaryRoots: string[] = [];
  const boundary = path.resolve("C:/leemo-e2e/home/Leemo");
  const cwd = path.join(boundary, "test-book");

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function bounded(mode: PermissionPolicy["mode"] = "acceptEdits") {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const policy: PermissionPolicy = {
      mode,
      dangerousCommandCaching: false,
      filesystemBoundary: boundary,
      filesystemCwd: cwd,
    };
    return { broker: createApprovalBroker("conv-e2e", transport, persistence, policy), seen };
  }

  it.each([
    ["Read", { file_path: path.resolve("C:/Users/real/private.md") }],
    ["Write", { file_path: path.resolve("C:/Users/real/overwrite.md"), content: "no" }],
    ["Edit", { file_path: "../../outside.md", old_string: "a", new_string: "b" }],
    ["Glob", { path: path.resolve("C:/Users/real"), pattern: "**/*" }],
    ["Grep", { path: path.resolve("C:/Users/real"), pattern: "secret" }],
    ["NotebookEdit", { notebook_path: path.resolve("C:/Users/real/a.ipynb") }],
    [LEEMO_DOCUMENT_TOOL_NAMES.read, { file_path: path.resolve("C:/Users/real/private.pdf") }],
    [LEEMO_DOCUMENT_TOOL_NAMES.editWord, {
      file_path: "report.docx",
      output_path: path.resolve("C:/Users/real/report-修改版.docx"),
    }],
    [LEEMO_DOCUMENT_TOOL_NAMES.createWord, { file_path: path.resolve("C:/Users/real/report.docx") }],
    [LEEMO_DOCUMENT_TOOL_NAMES.createPresentation, { file_path: "../../outside.pptx" }],
    [LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet, { file_path: "../../outside.xlsx" }],
    [LEEMO_VISUALIZATION_TOOL_NAME, { file_path: path.resolve("C:/Users/real/chart.html") }],
  ])("denies out-of-bound %s before frictionless or accept-edits shortcuts", async (tool, input) => {
    const { broker, seen } = bounded();
    const result = await decide(broker.canUseTool, tool, input);
    expect(result).toEqual(expect.objectContaining({ behavior: "deny" }));
    expect(result).toHaveProperty("message", expect.stringMatching(/隔离工作区之外/));
    expect(seen).toEqual([]);
  });

  it("allows absolute and relative paths that resolve inside the boundary", async () => {
    const { broker, seen } = bounded();
    await expect(decide(broker.canUseTool, "Write", {
      file_path: path.join(cwd, "result.md"),
      content: "ok",
    })).resolves.toEqual({ behavior: "allow" });
    await expect(decide(broker.canUseTool, "Read", {
      file_path: "../shared.md",
    })).resolves.toEqual({ behavior: "allow" });
    expect(seen).toEqual([]);
  });

  it("cannot be bypassed by bypassPermissions", async () => {
    const { broker, seen } = bounded("bypassPermissions");
    const result = await decide(broker.canUseTool, "Write", {
      file_path: path.resolve("C:/Users/real/still-blocked.md"),
      content: "no",
    });
    expect(result.behavior).toBe("deny");
    expect(seen).toEqual([]);
  });

  it("denies a path that is lexically inside but crosses a directory junction", async () => {
    const actualBoundary = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-boundary-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-outside-"));
    temporaryRoots.push(actualBoundary, outside);
    const linked = path.join(actualBoundary, "linked-outside");
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");

    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = createApprovalBroker("conv-junction", transport, persistence, {
      mode: "acceptEdits",
      dangerousCommandCaching: false,
      filesystemBoundary: actualBoundary,
      filesystemCwd: actualBoundary,
    });

    await expect(decide(broker.canUseTool, "Read", {
      file_path: path.join(linked, "private.md"),
    })).resolves.toEqual(expect.objectContaining({ behavior: "deny" }));
    expect(seen).toEqual([]);
  });
});

// ===========================================================================
// ApprovalBroker — three-tier semantics
// ===========================================================================

describe("ApprovalBroker — allow-once does not cache", () => {
  it("asks the host again on a second identical call (nothing cached)", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const { persistence, list } = memoryPersistence();
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const r1 = await decide(broker.canUseTool, "Bash", { command: "npm test" });
    const r2 = await decide(broker.canUseTool, "Bash", { command: "npm test" });

    expect(r1.behavior).toBe("allow");
    expect(r2.behavior).toBe("allow");
    // The sharp assertion: transport was consulted BOTH times.
    expect(seen.length).toBe(2);
    expect(list.length).toBe(0);
  });
});

describe("ApprovalBroker — task-scoped continuous approval", () => {
  it("covers later moderate commands in the same task and resets before the next task", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const { persistence, list } = memoryPersistence();
    const broker = createApprovalBroker("conv-1", transport, persistence);

    await decide(broker.canUseTool, "Bash", { command: "ls" });
    const r2 = await decide(broker.canUseTool, "Bash", { command: "git status" });

    expect(r2.behavior).toBe("allow");
    expect(seen).toHaveLength(1);

    broker.beginTask();
    const r3 = await decide(broker.canUseTool, "Bash", { command: "git status" });

    expect(r3.behavior).toBe("allow");
    expect(seen).toHaveLength(2);
    // Task approval is memory-only and never becomes a permanent whitelist.
    expect(list.length).toBe(0);
  });

  it("labels each outgoing request with its broker conversationId", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker("conv-a", transport, persistence);

    await decide(broker.canUseTool, "Bash", { command: "npm test" });

    expect(seen).toHaveLength(1);
    expect(seen[0].conversationId).toBe("conv-a");
  });

  it("does NOT leak across brokers (a fresh conversation has an empty task cache)", async () => {
    const { persistence } = memoryPersistence();
    const a = scriptedApprovalTransport(() => "allow-conversation");
    const brokerA = createApprovalBroker("conv-a", a.transport, persistence);
    await decide(brokerA.canUseTool, "Bash", { command: "ls" });
    await decide(brokerA.canUseTool, "Bash", { command: "ls" });
    expect(a.seen.length).toBe(1);

    // A brand-new conversation (new broker) shares persistence but NOT the
    // conversation cache → it must ask again.
    const b = scriptedApprovalTransport(() => "allow-conversation");
    const brokerB = createApprovalBroker("conv-b", b.transport, persistence);
    await decide(brokerB.canUseTool, "Bash", { command: "npm test" });
    expect(b.seen.length).toBe(1);
  });

  it("binds third-party MCP approval to the exact target and parameters", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker("conv-mcp", transport, persistence);

    await decide(broker.canUseTool, "mcp__demo__publish", { target: "draft" });
    await decide(broker.canUseTool, "mcp__demo__publish", { target: "draft" });
    expect(seen).toHaveLength(1);

    await decide(broker.canUseTool, "mcp__demo__publish", { target: "production" });
    expect(seen).toHaveLength(2);
  });
});

describe("ApprovalBroker — allow-permanent persists + carries across conversations", () => {
  it("exposes the persistence removal hook by the exact (toolName, risk) target", () => {
    const { persistence, list } = memoryPersistence();
    const target: WhitelistEntry = { toolName: "Bash", risk: "dangerous" };
    const other: WhitelistEntry = { toolName: "Bash", risk: "moderate" };
    persistence.addToWhitelist(target);
    persistence.addToWhitelist(other);
    persistence.removeFromWhitelist(target);

    expect(list).toEqual([other]);
  });

  it("writes the whitelist via persistence and a NEW conversation is auto-allowed without asking", async () => {
    const { persistence, list } = memoryPersistence();
    const a = scriptedApprovalTransport(() => "allow-permanent");
    // 轮 7 A5: pin `default` explicitly. This test's SUBJECT is the permanent
    // whitelist round-trip; Write is merely the vehicle, and under the new
    // default (`acceptEdits`) Write no longer reaches the whitelist path at all.
    // Pinning the mode keeps the subject testable instead of quietly retargeting
    // the test at a different tool.
    const defaultMode: PermissionPolicy = { mode: "default", dangerousCommandCaching: false };
    const brokerA = createApprovalBroker("conv-a", a.transport, persistence, defaultMode);

    const r1 = await decide(brokerA.canUseTool, "Write", { file_path: "x.txt", content: "1" });
    expect(r1.behavior).toBe("allow");
    // The sharp assertion: persistence.addToWhitelist actually fired.
    expect(list.length).toBe(1);
    expect(list[0].toolName).toBe("Write");
    expect(list[0].risk).toBe("moderate");

    // A different conversation, same persistence. Its transport would DENY if
    // consulted — proving the auto-allow came from the permanent whitelist.
    const b = scriptedApprovalTransport(() => "deny");
    const brokerB = createApprovalBroker("conv-b", b.transport, persistence, defaultMode);
    const r2 = await decide(brokerB.canUseTool, "Write", { file_path: "y.txt", content: "2" });
    expect(r2.behavior).toBe("allow");
    expect(b.seen.length).toBe(0); // transport never consulted
  });

  it("never turns a shell command into a broad permanent grant", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-permanent");
    const broker = createApprovalBroker("conv-a", transport, persistence, {
      mode: "default",
      dangerousCommandCaching: true,
    });

    await decide(broker.canUseTool, "Bash", { command: "npm test" });
    await decide(broker.canUseTool, "Bash", { command: "npm test" });
    expect(list).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it("never persists a blanket grant for a third-party MCP tool", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-permanent");
    const broker = createApprovalBroker("conv-mcp", transport, persistence, {
      mode: "default",
      dangerousCommandCaching: false,
    });

    await decide(broker.canUseTool, "mcp__demo__publish", { target: "draft" });
    await decide(broker.canUseTool, "mcp__demo__publish", { target: "production" });

    expect(list).toEqual([]);
    expect(seen).toHaveLength(2);
  });
});

describe("ApprovalBroker — deny", () => {
  it("maps a deny decision to a PermissionResult deny with a message", async () => {
    const { transport } = scriptedApprovalTransport(() => "deny");
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker("conv-1", transport, persistence);
    const r = await decide(broker.canUseTool, "Bash", { command: "curl evil.example" });
    expect(r.behavior).toBe("deny");
    if (r.behavior === "deny") expect(typeof r.message).toBe("string");
  });
});

// ===========================================================================
// ApprovalBroker — danger-never-permanent (06 §2.9)
// ===========================================================================

describe("ApprovalBroker — danger downgrade (permanent is refused for dangerous tools)", () => {
  it("host returns allow-permanent for `rm -rf`, but broker refuses to persist and treats it as allow-once", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-permanent");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const r1 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    expect(r1.behavior).toBe("allow"); // allowed THIS time
    // The two sharp assertions: NOT persisted, despite the host's allow-permanent.
    expect(list.length).toBe(0);

    // And it was NOT cached anywhere → a second identical call asks again.
    const r2 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    expect(r2.behavior).toBe("allow");
    expect(seen.length).toBe(2);
    expect(list.length).toBe(0);
  });
});

// Leemo design decision (设计负责人 7/21, completing 06 §2.9): the dangerous
// tier is allow-once ONLY — no conversation cache, no permanent whitelist.
// Destructive commands are highly specific; approving one (`rm -rf /tmp/data`)
// must NEVER auto-allow another (`format C:`) that shares the tool+risk key.
describe("ApprovalBroker — dangerous tier refuses conversation caching too", () => {
  it("host returns allow-conversation for a dangerous command, but a DIFFERENT dangerous command still asks", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const r1 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    expect(r1.behavior).toBe("allow"); // allowed THIS time

    // A second, DIFFERENT dangerous command (same tool+risk key `Bash::dangerous`)
    // must NOT be served from cache — it is highly specific and separately risky.
    const r2 = await decide(broker.canUseTool, "Bash", { command: "format C:" });
    expect(r2.behavior).toBe("allow");
    // The sharp assertion: transport consulted BOTH times (nothing cached).
    expect(seen.length).toBe(2);
    // And never persisted.
    expect(list.length).toBe(0);
  });

  it("even the SAME dangerous command asks again (dangerous is strictly allow-once)", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    expect(seen.length).toBe(2);
  });

  it("an identical MODERATE command still caches", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    await decide(broker.canUseTool, "Bash", { command: "ls -la" });
    await decide(broker.canUseTool, "Bash", { command: "ls -la" });
    expect(seen.length).toBe(1); // second served from conversation cache
  });
});

// The ApprovalDecision.decision field is typed ApprovalTier, but the value
// arrives over IPC from the host — untrusted runtime data. A malformed / future
// unknown string must NOT coerce to allow (fail-closed, matching the broker's
// "don't trust the host UI" posture that danger-downgrade already embodies).
describe("ApprovalBroker — unknown decision is fail-closed (deny)", () => {
  it("a malformed decision string is denied, not allowed", async () => {
    const { persistence } = memoryPersistence();
    const transport: ApprovalTransport = {
      async request(req) {
        // Simulate a malformed/unknown decision off the wire.
        return { id: req.id, decision: "totally-bogus" as ApprovalDecision["decision"] };
      },
    };
    const broker = createApprovalBroker("conv-1", transport, persistence);
    const r = await decide(broker.canUseTool, "Bash", { command: "npm test" });
    expect(r.behavior).toBe("deny");
    if (r.behavior === "deny") expect(typeof r.message).toBe("string");
  });
});


// ===========================================================================
// ApprovalBroker — policy-driven approval (07/21 B3 revision)
//
// The default construction (no policy arg) preserves B3's safe behavior — the
// danger-downgrade / refuses-conversation-cache / fail-closed suites above all
// build the broker with NO policy and still pass, which is the "default stays
// strict" regression. These add the two NEW policy behaviors: the
// dangerousCommandCaching toggle, and bypassPermissions short-circuit.
// ===========================================================================

// dangerousCommandCaching toggle ON keeps the low-friction intent without
// creating a hidden blanket grant: an exact Shell command may be reused in this
// conversation, but Shell/dangerous is never persisted across conversations.
describe("ApprovalBroker — dangerousCommandCaching toggle ON lets dangerous cache", () => {
  it("remembers only the same dangerous shell command inside this conversation", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: true };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    const r1 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    const r2 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    const r3 = await decide(broker.canUseTool, "Bash", { command: "format C:" });
    expect(r1.behavior).toBe("allow");
    expect(r2.behavior).toBe("allow");
    expect(r3.behavior).toBe("allow");
    expect(seen.length).toBe(2);
    // conversation cache is in-memory only — never persists.
    expect(list.length).toBe(0);
  });

  it("never persists a dangerous grant, even when low-friction caching is on", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport } = scriptedApprovalTransport(() => "allow-permanent");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: true };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    const r1 = await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    expect(r1.behavior).toBe("allow");
    expect(list.length).toBe(0);
  });

  it("the DEFAULT policy (no policy arg) STILL keeps dangerous strictly allow-once (regression)", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const broker = createApprovalBroker("conv-1", transport, persistence); // default policy

    await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    await decide(broker.canUseTool, "Bash", { command: "format C:" });
    // Default = safe: dangerous never caches, so both were asked.
    expect(seen.length).toBe(2);
    expect(list.length).toBe(0);
  });
});

// bypassPermissions: the user explicitly chose zero-friction — self-responsible.
// The broker allows EVERYTHING (incl. dangerous) with NO ApprovalRequest and NO
// transport call at all (zero card). This is a hard behavior of this card.
describe("ApprovalBroker — bypassPermissions mode short-circuits (zero card)", () => {
  it("allows every tool incl. dangerous with ZERO transport calls and no persistence", async () => {
    const { persistence, list } = memoryPersistence();
    // Transport would DENY if ever consulted — proving the allow came from the
    // short-circuit, not from the host.
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const policy: PermissionPolicy = { mode: "bypassPermissions", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    const rSafe = await decide(broker.canUseTool, "Read", { file_path: "a.txt" });
    const rMod = await decide(broker.canUseTool, "Write", { file_path: "b.txt", content: "1" });
    const rDanger = await decide(broker.canUseTool, "Bash", { command: "rm -rf /" });

    expect(rSafe.behavior).toBe("allow");
    expect(rMod.behavior).toBe("allow");
    // Dangerous allowed too — bypass means the user owns the risk.
    expect(rDanger.behavior).toBe("allow");
    // The sharp assertions: transport NEVER consulted, nothing persisted.
    expect(seen.length).toBe(0);
    expect(list.length).toBe(0);
  });
});

// ===========================================================================
// 轮 7 A5 — acceptEdits actually accepts edits（用户 7/28:「写文件不问，跑命令才问」）
//
// Before 轮 7 this mode fell through to the full ask flow, so the DEFAULT mode
// prompted on every Write. Live-measured: a one-line write sat behind a card for
// 90+ seconds with the stop button gone.
// ===========================================================================

describe("ApprovalBroker — acceptEdits (轮 7 A5)", () => {
  it("auto-allows Write/Edit/NotebookEdit with ZERO transport calls", async () => {
    const { persistence, list } = memoryPersistence();
    // Transport would DENY if consulted — so an "allow" can only come from the
    // mode short-circuit, never from a fake that echoes approval.
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    for (const [tool, input] of [
      ["Write", { file_path: "a.md", content: "x" }],
      ["Edit", { file_path: "a.md", old_string: "x", new_string: "y" }],
      ["NotebookEdit", { notebook_path: "n.ipynb" }],
    ] as const) {
      const r = await decide(broker.canUseTool, tool, input as Record<string, unknown>);
      expect(r.behavior, `${tool} should not prompt`).toBe("allow");
    }
    expect(seen.length).toBe(0);
    // Auto-allow is a MODE decision, not a remembered grant: nothing persisted.
    expect(list.length).toBe(0);
  });

  it("still asks for Bash — an edit is undoable, a shell command may not be", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    const r = await decide(broker.canUseTool, "Bash", { command: "npm test" });
    expect(r.behavior).toBe("allow"); // allowed, but only because the host said so
    expect(seen.length).toBe(1); // ← the load-bearing assertion: it DID ask
  });

  it("still asks for a dangerous command, and never caches it", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    await decide(broker.canUseTool, "Bash", { command: "rm -rf /tmp/data" });
    await decide(broker.canUseTool, "Bash", { command: "format C:" });
    // Two dangerous calls ⇒ two cards. Approving one never authorises another.
    expect(seen.length).toBe(2);
  });

  it("still asks for unknown / third-party MCP tools", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const policy: PermissionPolicy = { mode: "acceptEdits", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    // A third-party MCP tool whose name merely LOOKS edit-ish must not slip
    // through the edit allow-list (it is matched exactly, not by substring).
    await decide(broker.canUseTool, "mcp__somevendor__Write", { file_path: "a" });
    expect(seen.length).toBe(1);
  });

  it("default mode keeps asking for edits (acceptEdits is not the only mode)", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const policy: PermissionPolicy = { mode: "default", dangerousCommandCaching: false };
    const broker = createApprovalBroker("conv-1", transport, persistence, policy);

    await decide(broker.canUseTool, "Write", { file_path: "a.md", content: "x" });
    expect(seen.length).toBe(1);
  });

  it("treats Leemo's exact artifact creators as edits, but not lookalike MCPs", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = createApprovalBroker("conv-docs", transport, persistence, {
      mode: "acceptEdits",
      dangerousCommandCaching: false,
    });

    for (const [toolName, file_path] of [
      [LEEMO_DOCUMENT_TOOL_NAMES.createWord, "成果.docx"],
      [LEEMO_DOCUMENT_TOOL_NAMES.editWord, "成果.docx"],
      [LEEMO_DOCUMENT_TOOL_NAMES.createPresentation, "成果.pptx"],
      [LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet, "成果.xlsx"],
      [LEEMO_VISUALIZATION_TOOL_NAME, "成果.html"],
    ] as const) {
      expect(classifyRisk(toolName, { file_path })).toBe("moderate");
      await expect(decide(broker.canUseTool, toolName, { file_path }))
        .resolves.toEqual({ behavior: "allow" });
    }
    expect(seen).toEqual([]);

    await decide(broker.canUseTool, "mcp__third-party__create_word_document", { file_path: "成果.docx" });
    await decide(broker.canUseTool, "mcp__third-party__create_visualization", { file_path: "成果.html" });
    expect(seen).toHaveLength(2);
  });
});

// ===========================================================================
// ApprovalBroker — Leemo's own in-process question tool never asks permission
// ===========================================================================

describe("ApprovalBroker — ask_user is not a permission-gated tool", () => {
  it("auto-allows momo's own question tool with ZERO transport calls", async () => {
    const { persistence, list } = memoryPersistence();
    // Transport would DENY if consulted — proving the allow is a short-circuit.
    // Before this, ask_user fell through classifyRisk's "unknown ⇒ moderate"
    // default and raised a card: momo had to ask your permission to ask you a
    // question, and the question card sat behind that prompt.
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const r = await decide(broker.canUseTool, LEEMO_ASK_USER_TOOL, {
      questions: [{ question: "先做哪个？", options: [{ label: "A" }] }],
    });

    expect(r.behavior).toBe("allow");
    expect(seen.length).toBe(0);
    // Auto-allow must not leave a whitelist entry behind — it is a property of
    // the tool, not a decision the user made and could later revoke.
    expect(list.length).toBe(0);
  });

  it("spells the qualified tool name exactly as the renderer anchors on", () => {
    // src/renderer/bridge/tool-names.ts hardcodes this same string to find the
    // ask_user tool-call item in the timeline (卡 D). The renderer cannot import
    // it from here — interact.ts pulls node-only deps and tsconfig excludes
    // src/renderer from the node program — so both sides are pinned to the
    // literal instead. Change the server/tool name and this fails first.
    expect(LEEMO_ASK_USER_TOOL).toBe("mcp__leemo-ask-user__ask_user");
  });

  it("still prompts for a THIRD-PARTY mcp tool (the exemption is not a blanket mcp__ pass)", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const r = await decide(broker.canUseTool, "mcp__github__create_issue", { title: "x" });

    expect(r.behavior).toBe("allow"); // because the host said so…
    expect(seen.length).toBe(1); // …and it WAS asked. Never auto-allow an unknown.
  });

  it("auto-allows only Leemo's three governed memory tools with zero approval cards", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    for (const toolName of Object.values(LEEMO_MEMORY_TOOL_NAMES)) {
      const result = await decide(broker.canUseTool, toolName, { query: "回复偏好" });
      expect(result.behavior).toBe("allow");
    }

    expect(seen).toEqual([]);
    expect(list).toEqual([]);
  });

  it("auto-allows Leemo's exact read-only search tools with zero approval cards", async () => {
    const { persistence, list } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = capabilityBroker(
      "conv-1",
      transport,
      persistence,
      { mode: "acceptEdits", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    for (const toolName of [LEEMO_WEB_SEARCH_TOOL, LEEMO_ACADEMIC_SEARCH_TOOL]) {
      const result = await decide(broker.canUseTool, toolName, { query: "retrieval augmented generation" });
      expect(result.behavior).toBe("allow");
    }

    expect(seen).toEqual([]);
    expect(list).toEqual([]);
  });

  it("auto-allows Leemo's document reader but does not auto-allow its creators as reads", async () => {
    const { persistence } = memoryPersistence();
    const { transport, seen } = scriptedApprovalTransport(() => "deny");
    const broker = capabilityBroker(
      "conv-docs",
      transport,
      persistence,
      { mode: "default", dangerousCommandCaching: false },
      ALL_RUNTIME_CAPABILITIES,
    );

    await expect(decide(broker.canUseTool, LEEMO_DOCUMENT_TOOL_NAMES.read, { file_path: "讲义.pdf" }))
      .resolves.toEqual({ behavior: "allow" });
    await expect(decide(broker.canUseTool, LEEMO_DOCUMENT_TOOL_NAMES.createWord, { file_path: "报告.docx" }))
      .resolves.toEqual(expect.objectContaining({ behavior: "deny" }));
    await expect(decide(broker.canUseTool, LEEMO_DOCUMENT_TOOL_NAMES.editWord, {
      file_path: "报告.docx",
      output_path: "报告-修改版.docx",
    })).resolves.toEqual(expect.objectContaining({ behavior: "deny" }));
    expect(seen).toHaveLength(2);
  });
});

// ===========================================================================
// ApprovalBroker — concurrency (waiters don't cross)
// ===========================================================================

describe("ApprovalBroker — concurrent approvals stay isolated", () => {
  it("two canUseTool calls pending at once each resolve with THEIR OWN decision", async () => {
    const { transport, pending } = deferredApprovalTransport();
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker("conv-1", transport, persistence);

    const pMcp = broker.canUseTool("mcp__github__create_issue", { title: "x" }, o());
    const pBash = broker.canUseTool("Bash", { command: "ls" }, o());
    await tick();
    expect(pending.length).toBe(2);

    const mcpReq = pending.find((p) => p.req.toolName === "mcp__github__create_issue")!;
    const bashReq = pending.find((p) => p.req.toolName === "Bash")!;
    expect(mcpReq.req.id).not.toBe(bashReq.req.id);

    // Resolve in REVERSE order: Bash allowed, third-party MCP denied.
    bashReq.resolve({ id: bashReq.req.id, decision: "allow-once" });
    mcpReq.resolve({ id: mcpReq.req.id, decision: "deny", message: "no external writes" });

    const [rMcp, rBash] = await Promise.all([pMcp, pBash]);
    expect(rBash?.behavior).toBe("allow");
    expect(rMcp?.behavior).toBe("deny");
  });
});

// ===========================================================================
// ask_user MCP — blocking round-trip
// ===========================================================================

describe("createAskUserMcp — blocking round-trip", () => {
  it("blocks until the host answers, then returns the answer to the model", async () => {
    const asks: AskUserPayload[] = [];
    const transport: AskUserTransport = {
      async ask(p) {
        asks.push(p);
      },
    };
    const mcp = createAskUserMcp("conv-1", transport);

    let settled = false;
    const p = mcp
      .handle({
        questions: [{ question: "Pick one", options: [{ label: "Apple" }, { label: "Banana" }] }],
      })
      .then((r) => {
        settled = true;
        return r;
      });

    await tick();
    // The host received exactly one structured payload...
    expect(asks.length).toBe(1);
    const id = asks[0].id;
    expect(asks[0].conversationId).toBe("conv-1");
    expect(asks[0].questions[0].question).toBe("Pick one");
    // ...and the tool is genuinely BLOCKED (promise not settled yet).
    expect(settled).toBe(false);

    // Host answers → the blocked Promise resolves and the answer reaches the tool.
    const answer: AskUserAnswer = { id, items: [{ selected: ["Apple"] }] };
    expect(mcp.provideAnswer(id, answer)).toBe(true);

    const res = await p;
    expect(settled).toBe(true);
    expect(res.isError ?? false).toBe(false);
    expect((res.content[0] as { text: string }).text).toContain("Apple");
  });

  it("exposes a real SDK MCP server instance (createSdkMcpServer)", () => {
    const mcp = createAskUserMcp("conv-1", { async ask() {} });
    // Shape from the real d.ts: McpSdkServerConfigWithInstance = {type:'sdk', name, instance}.
    expect(mcp.server.type).toBe("sdk");
    expect(mcp.server.name).toBe("leemo-ask-user");
    expect(mcp.server.instance).toBeTruthy();
  });
});

describe("createAskUserMcp — failure paths never hang", () => {
  it("transport.ask rejection yields an error result", async () => {
    const transport: AskUserTransport = {
      async ask() {
        throw new Error("host channel closed");
      },
    };
    const mcp = createAskUserMcp("conv-1", transport);
    const res = await mcp.handle({
      questions: [{ question: "q", options: [{ label: "x" }] }],
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("host channel closed");
  });

  it("times out into an error result when the host never answers", async () => {
    const transport: AskUserTransport = { async ask() {} };
    const mcp = createAskUserMcp("conv-1", transport, { timeoutMs: 15 });
    const res = await mcp.handle({
      questions: [{ question: "q", options: [{ label: "x" }] }],
    });
    expect(res.isError).toBe(true);
  });

  it("host-initiated cancellation (failAsk) yields an error result", async () => {
    const asks: AskUserPayload[] = [];
    const transport: AskUserTransport = {
      async ask(p) {
        asks.push(p);
      },
    };
    const mcp = createAskUserMcp("conv-1", transport);
    const p = mcp.handle({ questions: [{ question: "q", options: [{ label: "x" }] }] });
    await tick();
    expect(mcp.failAsk(asks[0].id, "user dismissed the card")).toBe(true);
    const res = await p;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("user dismissed the card");
  });
});

describe("createAskUserMcp — concurrent asks stay isolated", () => {
  it("labels every concurrent payload with its MCP conversationId", async () => {
    const asks: AskUserPayload[] = [];
    const transport: AskUserTransport = { async ask(payload) { asks.push(payload); } };
    const mcp = createAskUserMcp("conv-a", transport);

    const first = mcp.handle({ questions: [{ question: "q1", options: [{ label: "A" }] }] });
    const second = mcp.handle({ questions: [{ question: "q2", options: [{ label: "B" }] }] });
    await tick();

    expect(asks).toHaveLength(2);
    expect(asks.map((payload) => payload.conversationId)).toEqual(["conv-a", "conv-a"]);
    mcp.provideAnswer(asks[0].id, { id: asks[0].id, items: [{ selected: ["A"] }] });
    mcp.provideAnswer(asks[1].id, { id: asks[1].id, items: [{ selected: ["B"] }] });
    await Promise.all([first, second]);
  });

  it("routes each answer to its own blocked call, regardless of answer order", async () => {
    const asks: AskUserPayload[] = [];
    const transport: AskUserTransport = {
      async ask(p) {
        asks.push(p);
      },
    };
    const mcp = createAskUserMcp("conv-1", transport);

    const p1 = mcp.handle({ questions: [{ question: "q1", options: [{ label: "A" }] }] });
    const p2 = mcp.handle({ questions: [{ question: "q2", options: [{ label: "B" }] }] });
    await tick();
    expect(asks.length).toBe(2);
    const [a1, a2] = asks;
    expect(a1.id).not.toBe(a2.id);

    // Answer in reverse order.
    mcp.provideAnswer(a2.id, { id: a2.id, items: [{ selected: ["B"] }] });
    mcp.provideAnswer(a1.id, { id: a1.id, items: [{ selected: ["A"] }] });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect((r1.content[0] as { text: string }).text).toContain("A");
    expect((r2.content[0] as { text: string }).text).toContain("B");
  });
});
