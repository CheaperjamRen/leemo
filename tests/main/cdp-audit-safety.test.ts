import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "..", "..");

function script(name: string): string {
  return fs.readFileSync(path.join(root, "scripts", name), "utf8");
}

describe("CDP visual audit safety", () => {
  it("enters the current workbench surface through its accessible mode action", async () => {
    const moduleUrl = pathToFileURL(path.join(root, "scripts", "verify-memory-workspace.mjs")).href;
    const { ensureWorkbench } = await import(moduleUrl) as {
      ensureWorkbench: (page: unknown) => Promise<void>;
    };
    let visible = false;
    const page = {
      getByTestId(name: string) {
        expect(name).toBe("workbench-shell");
        return {
          isVisible: async () => visible,
          waitFor: async () => {
            if (!visible) throw new Error("workbench did not become visible");
          },
        };
      },
      getByRole(role: string, options: { name: string; exact: boolean }) {
        expect(role).toBe("button");
        if (options.name !== "切换到工作台" || !options.exact) {
          throw new Error(`unknown workbench action: ${options.name}`);
        }
        return { click: async () => { visible = true; } };
      },
    };

    await ensureWorkbench(page);
    expect(visible).toBe(true);
  });

  it("waits for a real conversation row instead of removed status copy", async () => {
    const moduleUrl = pathToFileURL(path.join(root, "scripts", "verify-memory-workspace.mjs")).href;
    const { newConversation } = await import(moduleUrl) as {
      newConversation: (page: unknown) => Promise<void>;
    };
    let rows = 1;
    let composerReady = false;
    const page = {
      locator(selector: string) {
        if (selector === "[data-conversation-id]") {
          return {
            count: async () => rows,
            nth: (index: number) => ({
              waitFor: async () => {
                if (index >= rows) throw new Error("new conversation row was not attached");
              },
            }),
          };
        }
        if (selector === 'textarea[aria-label="输入消息"]') {
          return {
            waitFor: async () => {
              if (!composerReady) throw new Error("composer is not ready");
            },
            inputValue: async () => "",
          };
        }
        throw new Error(`unknown locator: ${selector}`);
      },
      getByRole(role: string, options: { name: string; exact: boolean }) {
        expect(role).toBe("button");
        expect(options).toEqual({ name: "新建对话", exact: true });
        return {
          click: async () => {
            rows += 1;
            composerReady = true;
          },
        };
      },
    };

    await newConversation(page);
    expect(rows).toBe(2);
  });

  it("accepts visible final content without restoring a completed text badge", async () => {
    const moduleUrl = pathToFileURL(path.join(root, "scripts", "verify-memory-workspace.mjs")).href;
    const { runVisiblePrompt } = await import(moduleUrl) as {
      runVisiblePrompt: (page: unknown, prompt: string, marker: string, timeout?: number) => Promise<void>;
    };
    let submitted = false;
    const page = {
      locator(selector: string) {
        expect(selector).toBe('textarea[aria-label="输入消息"]');
        return { fill: async (value: string) => { submitted = value === "检查结果"; } };
      },
      getByRole(role: string, options: { name: string; exact: boolean }) {
        expect(role).toBe("button");
        if (options.name === "发送") {
          return {
            click: async () => { submitted = submitted && true; },
            waitFor: async () => {
              if (!submitted) throw new Error("send action did not return");
            },
          };
        }
        if (options.name === "允许一次") return { count: async () => 0 };
        throw new Error(`unknown action: ${options.name}`);
      },
      getByText(text: string) {
        if (text === "FINAL_OK") return { last: () => ({ isVisible: async () => submitted }) };
        if (text === "任务没有完成") return { isVisible: async () => false };
        throw new Error(`unknown text: ${text}`);
      },
      getByTestId(name: string) {
        throw new Error(`removed status badge queried: ${name}`);
      },
    };

    await runVisiblePrompt(page, "检查结果", "FINAL_OK", 1_000);
    expect(submitted).toBe(true);
  });

  it.each([
    "verify-settings-layout.mjs",
    "cdp-scroll-viewport.mjs",
    "ux-audit.mjs",
  ])("always clears device metrics after %s", (name) => {
    expect(script(name)).toMatch(
      /finally\s*\{[\s\S]*?Emulation\.clearDeviceMetricsOverride/,
    );
  });

  it("does not expose a persistent viewport override command", () => {
    const source = script("ux-audit.mjs");
    expect(source).not.toMatch(/cmd\s*===\s*["']size["']/);
    expect(source).toContain("--viewport=");
  });

  it("clears completed CDP request timers so audits can exit immediately", () => {
    expect(script("ux-audit.mjs")).toMatch(/clearTimeout\(waiter\.timer\)/);
  });

  it("verifies memory through visible conversations without seeding product files", () => {
    const source = script("cdp-momo-verify.mjs");
    expect(source).toContain("请长期记住这件事");
    expect(source).toContain("新建对话");
    expect(source).toContain("data-memory-receipt");
    expect(source).not.toMatch(/writeFileSync\([^,]*CLAUDE\.md/);
    expect(source).not.toContain("QINGSE-7413");
  });

  it.each([
    "verify-memory-workspace.mjs",
    "verify-memory-restart.mjs",
  ])("keeps the r10 memory journey inside an isolated app root in %s", (name) => {
    const source = script(name);
    expect(source).toContain("--leemo-e2e-root=");
    expect(source).toContain("127.0.0.1");
    expect(source).not.toMatch(/USERPROFILE[^\n]+["']Leemo["']/);
    expect(source).not.toMatch(/writeFileSync\([^,]*(?:MEMORY|ledger|CLAUDE)/i);
  });
});
