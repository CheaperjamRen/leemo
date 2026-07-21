import { describe, it, expect } from "vitest";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  createApprovalBroker,
  classifyRisk,
  createAskUserMcp,
  type ApprovalTransport,
  type ApprovalPersistence,
  type ApprovalRequest,
  type ApprovalDecision,
  type WhitelistEntry,
  type AskUserTransport,
  type AskUserPayload,
  type AskUserAnswer,
} from "../../src/bridge/interact";

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
  });

  it("a write/exec tool with no dangerous pattern classifies as moderate", () => {
    expect(classifyRisk("Write", { file_path: "a.txt", content: "hi" })).toBe("moderate");
    expect(classifyRisk("Bash", { command: "ls -la" })).toBe("moderate");
  });
});

// ===========================================================================
// ApprovalBroker — three-tier semantics
// ===========================================================================

describe("ApprovalBroker — allow-once does not cache", () => {
  it("asks the host again on a second identical call (nothing cached)", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-once");
    const { persistence, list } = memoryPersistence();
    const broker = createApprovalBroker(transport, persistence);

    const r1 = await decide(broker.canUseTool, "Read", { file_path: "a.txt" });
    const r2 = await decide(broker.canUseTool, "Read", { file_path: "a.txt" });

    expect(r1.behavior).toBe("allow");
    expect(r2.behavior).toBe("allow");
    // The sharp assertion: transport was consulted BOTH times.
    expect(seen.length).toBe(2);
    expect(list.length).toBe(0);
  });
});

describe("ApprovalBroker — allow-conversation caches for this conversation", () => {
  it("second same-tool same-risk call is served from cache, transport NOT consulted", async () => {
    const { transport, seen } = scriptedApprovalTransport(() => "allow-conversation");
    const { persistence, list } = memoryPersistence();
    const broker = createApprovalBroker(transport, persistence);

    await decide(broker.canUseTool, "Read", { file_path: "a.txt" });
    // Different input, SAME tool + SAME risk → must hit the conversation cache.
    const r2 = await decide(broker.canUseTool, "Read", { file_path: "b.txt" });

    expect(r2.behavior).toBe("allow");
    // The sharp assertion: transport consulted exactly ONCE (2nd skipped transport).
    expect(seen.length).toBe(1);
    // conversation cache is in-memory only — never touches persistence.
    expect(list.length).toBe(0);
  });

  it("does NOT leak across brokers (a fresh conversation has an empty cache)", async () => {
    const { persistence } = memoryPersistence();
    const a = scriptedApprovalTransport(() => "allow-conversation");
    const brokerA = createApprovalBroker(a.transport, persistence);
    await decide(brokerA.canUseTool, "Read", { file_path: "a.txt" });
    await decide(brokerA.canUseTool, "Read", { file_path: "b.txt" });
    expect(a.seen.length).toBe(1);

    // A brand-new conversation (new broker) shares persistence but NOT the
    // conversation cache → it must ask again.
    const b = scriptedApprovalTransport(() => "allow-conversation");
    const brokerB = createApprovalBroker(b.transport, persistence);
    await decide(brokerB.canUseTool, "Read", { file_path: "a.txt" });
    expect(b.seen.length).toBe(1);
  });
});

describe("ApprovalBroker — allow-permanent persists + carries across conversations", () => {
  it("writes the whitelist via persistence and a NEW conversation is auto-allowed without asking", async () => {
    const { persistence, list } = memoryPersistence();
    const a = scriptedApprovalTransport(() => "allow-permanent");
    const brokerA = createApprovalBroker(a.transport, persistence);

    const r1 = await decide(brokerA.canUseTool, "Write", { file_path: "x.txt", content: "1" });
    expect(r1.behavior).toBe("allow");
    // The sharp assertion: persistence.addToWhitelist actually fired.
    expect(list.length).toBe(1);
    expect(list[0].toolName).toBe("Write");
    expect(list[0].risk).toBe("moderate");

    // A different conversation, same persistence. Its transport would DENY if
    // consulted — proving the auto-allow came from the permanent whitelist.
    const b = scriptedApprovalTransport(() => "deny");
    const brokerB = createApprovalBroker(b.transport, persistence);
    const r2 = await decide(brokerB.canUseTool, "Write", { file_path: "y.txt", content: "2" });
    expect(r2.behavior).toBe("allow");
    expect(b.seen.length).toBe(0); // transport never consulted
  });
});

describe("ApprovalBroker — deny", () => {
  it("maps a deny decision to a PermissionResult deny with a message", async () => {
    const { transport } = scriptedApprovalTransport(() => "deny");
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker(transport, persistence);
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
    const broker = createApprovalBroker(transport, persistence);

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

// ===========================================================================
// ApprovalBroker — concurrency (waiters don't cross)
// ===========================================================================

describe("ApprovalBroker — concurrent approvals stay isolated", () => {
  it("two canUseTool calls pending at once each resolve with THEIR OWN decision", async () => {
    const { transport, pending } = deferredApprovalTransport();
    const { persistence } = memoryPersistence();
    const broker = createApprovalBroker(transport, persistence);

    const pRead = broker.canUseTool("Read", { file_path: "a.txt" }, o());
    const pBash = broker.canUseTool("Bash", { command: "ls" }, o());
    await tick();
    expect(pending.length).toBe(2);

    const readReq = pending.find((p) => p.req.toolName === "Read")!;
    const bashReq = pending.find((p) => p.req.toolName === "Bash")!;
    expect(readReq.req.id).not.toBe(bashReq.req.id);

    // Resolve in REVERSE order: Bash allowed, Read denied.
    bashReq.resolve({ id: bashReq.req.id, decision: "allow-once" });
    readReq.resolve({ id: readReq.req.id, decision: "deny", message: "no reads" });

    const [rRead, rBash] = await Promise.all([pRead, pBash]);
    expect(rBash?.behavior).toBe("allow");
    expect(rRead?.behavior).toBe("deny");
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
    const mcp = createAskUserMcp(transport);

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
    const mcp = createAskUserMcp({ async ask() {} });
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
    const mcp = createAskUserMcp(transport);
    const res = await mcp.handle({
      questions: [{ question: "q", options: [{ label: "x" }] }],
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("host channel closed");
  });

  it("times out into an error result when the host never answers", async () => {
    const transport: AskUserTransport = { async ask() {} };
    const mcp = createAskUserMcp(transport, { timeoutMs: 15 });
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
    const mcp = createAskUserMcp(transport);
    const p = mcp.handle({ questions: [{ question: "q", options: [{ label: "x" }] }] });
    await tick();
    expect(mcp.failAsk(asks[0].id, "user dismissed the card")).toBe(true);
    const res = await p;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("user dismissed the card");
  });
});

describe("createAskUserMcp — concurrent asks stay isolated", () => {
  it("routes each answer to its own blocked call, regardless of answer order", async () => {
    const asks: AskUserPayload[] = [];
    const transport: AskUserTransport = {
      async ask(p) {
        asks.push(p);
      },
    };
    const mcp = createAskUserMcp(transport);

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
