import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createManagedClaudeProcessSpawner,
  terminateWindowsProcessTree,
  type WindowsProcessTreeOps,
} from "../../src/host/sdk-process";
import {
  PROCESS_TREE_STOP_PROMISE_KEY,
  PROCESS_TREE_STOP_RESULT_KEY,
} from "../../src/bridge/pool";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillTree(pid: number | undefined): void {
  if (!pid || !alive(pid)) return;
  if (process.platform !== "win32") {
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
    return;
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  spawnSync(path.join(systemRoot, "System32", "taskkill.exe"), [
    "/PID", String(pid), "/T", "/F",
  ], { windowsHide: true, stdio: "ignore" });
}

describe("managed Claude process spawning", () => {
  it("re-enumerates from every known PID until a late detached descendant is gone", async () => {
    const alivePids = new Set([100, 200]);
    const snapshots: number[][] = [];
    const terminated: number[] = [];
    let lateChildSpawned = false;
    const ops: WindowsProcessTreeOps = {
      async snapshotDescendants(seedPids) {
        snapshots.push([...seedPids]);
        if (snapshots.length === 1) return { ok: true, pids: [200] };
        if (alivePids.has(300)) return { ok: true, pids: [300] };
        return { ok: true, pids: [] };
      },
      isAlive: (pid) => alivePids.has(pid),
      async terminate(pid) {
        terminated.push(pid);
        alivePids.delete(pid);
        // The intermediate creates a detached child after the first snapshot,
        // then exits. Its PID must remain an ancestry seed on the next pass.
        if (pid === 200 && !lateChildSpawned) {
          lateChildSpawned = true;
          alivePids.add(300);
        }
        return true;
      },
    };

    await expect(terminateWindowsProcessTree(100, ops)).resolves.toBe(true);
    expect(alivePids).toEqual(new Set());
    expect(terminated).toContain(300);
    expect(snapshots.some((seeds) => seeds.includes(100) && seeds.includes(200))).toBe(true);
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
  });

  it("performs post-kill stable snapshots before accepting an empty process tree", async () => {
    const alivePids = new Set([100]);
    const snapshots: number[][] = [];
    const terminated: number[] = [];
    let lateChildVisible = false;
    const ops: WindowsProcessTreeOps = {
      async snapshotDescendants(seedPids) {
        snapshots.push([...seedPids]);
        return { ok: true, pids: lateChildVisible ? [200] : [] };
      },
      isAlive: (pid) => alivePids.has(pid),
      async terminate(pid) {
        terminated.push(pid);
        alivePids.delete(pid);
        if (pid === 100) {
          lateChildVisible = true;
          alivePids.add(200);
        } else if (pid === 200) {
          lateChildVisible = false;
        }
        return true;
      },
    };

    await expect(terminateWindowsProcessTree(100, ops)).resolves.toBe(true);
    expect(terminated).toContain(200);
    expect(alivePids).toEqual(new Set());
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
  });

  it("does not accept pre-kill observations when the final known process spawns a child while terminating", async () => {
    const alivePids = new Set([100, 200]);
    let childTerminateAttempts = 0;
    const terminated: number[] = [];
    const ops: WindowsProcessTreeOps = {
      async snapshotDescendants() {
        return {
          ok: true,
          pids: [
            ...(alivePids.has(200) ? [200] : []),
            ...(alivePids.has(300) ? [300] : []),
          ],
          observations: 2,
        };
      },
      isAlive: (pid) => alivePids.has(pid),
      async terminate(pid) {
        terminated.push(pid);
        if (pid === 200 && childTerminateAttempts++ === 0) return false;
        alivePids.delete(pid);
        if (pid === 200) alivePids.add(300);
        return true;
      },
    };

    await expect(terminateWindowsProcessTree(100, ops)).resolves.toBe(true);
    expect(terminated).toContain(300);
    expect(alivePids).toEqual(new Set());
  });

  it("fails closed when descendant enumeration cannot be verified", async () => {
    const alivePids = new Set([100]);
    const ops: WindowsProcessTreeOps = {
      snapshotDescendants: async () => ({ ok: false, pids: [] }),
      isAlive: (pid) => alivePids.has(pid),
      async terminate(pid) {
        alivePids.delete(pid);
        return true;
      },
    };

    await expect(terminateWindowsProcessTree(100, ops)).resolves.toBe(false);
    expect(alivePids).toEqual(new Set());
  });

  it("does not block the host event loop while Windows process enumeration is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ops: WindowsProcessTreeOps = {
      snapshotDescendants: async () => {
        await gate;
        return { ok: true, pids: [] };
      },
      isAlive: () => false,
      terminate: async () => true,
    };

    const stopping = terminateWindowsProcessTree(100, ops);
    let microtaskRan = false;
    await Promise.resolve().then(() => { microtaskRan = true; });
    expect(microtaskRan).toBe(true);
    release();
    await expect(stopping).resolves.toBe(true);
  });

  it("drains stderr so a verbose CLI cannot block before producing stdout", async () => {
    const program = [
      "const { once } = require('node:events');",
      "(async () => {",
      "  const chunk = Buffer.alloc(64 * 1024, 120);",
      "  for (let i = 0; i < 128; i += 1) {",
      "    if (!process.stderr.write(chunk)) await once(process.stderr, 'drain');",
      "  }",
      "  process.stdout.write('done\\n');",
      "})().catch((error) => { console.error(error); process.exitCode = 1; });",
    ].join("\n");
    const spawned = createManagedClaudeProcessSpawner()({
      command: process.execPath,
      args: ["-e", program],
      cwd: process.cwd(),
      env: { ...process.env },
      signal: new AbortController().signal,
    });
    const pid = (spawned as typeof spawned & { pid?: number }).pid;

    try {
      const output = await new Promise<string>((resolve, reject) => {
        let stdout = "";
        const timeout = setTimeout(() => reject(new Error("verbose child blocked on stderr")), 3_000);
        spawned.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        spawned.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        spawned.once("exit", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve(stdout);
          else reject(new Error(`verbose child exited ${String(code)}`));
        });
      });
      expect(output).toContain("done");
    } finally {
      forceKillTree(pid);
    }
  }, 7_000);

  it.skipIf(process.platform !== "win32")(
    "kills a spawned CLI and its command grandchild when the round aborts",
    async () => {
      const immediate = new AbortController();
      const forwarded = new AbortController();
      const childProgram = "setInterval(() => {}, 1000)";
      const parentProgram = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { detached: true, stdio: 'ignore', windowsHide: true });`,
        "child.unref();",
        "process.stdout.write(String(child.pid) + '\\n');",
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const spawned = createManagedClaudeProcessSpawner(immediate.signal)({
        command: process.execPath,
        args: ["-e", parentProgram],
        cwd: process.cwd(),
        env: { ...process.env },
        signal: forwarded.signal,
      });
      const parentPid = (spawned as typeof spawned & { pid?: number }).pid;
      let grandchildPid: number | undefined;

      try {
        grandchildPid = await new Promise<number>((resolve, reject) => {
          let output = "";
          const timeout = setTimeout(() => reject(new Error("test child did not report its PID")), 5_000);
          spawned.stdout.on("data", (chunk) => {
            output += chunk.toString();
            const line = output.split(/\r?\n/, 1)[0];
            if (!/^\d+$/.test(line)) return;
            clearTimeout(timeout);
            resolve(Number(line));
          });
          spawned.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
        expect(parentPid && alive(parentPid)).toBe(true);
        expect(alive(grandchildPid)).toBe(true);

        immediate.abort();
        const stopPromise = (immediate.signal as AbortSignal & {
          [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
        })[PROCESS_TREE_STOP_PROMISE_KEY];
        expect(stopPromise).toBeInstanceOf(Promise);
        await expect(stopPromise).resolves.toBe(true);
        expect(parentPid && alive(parentPid)).toBe(false);
        expect(alive(grandchildPid!)).toBe(false);
        expect(
          (immediate.signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY],
        ).toBe(true);
      } finally {
        forceKillTree(parentPid);
        forceKillTree(grandchildPid);
      }
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "still kills a recorded command descendant when the CLI root exits before abort",
    async () => {
      const immediate = new AbortController();
      const childProgram = "setInterval(() => {}, 1000)";
      const parentProgram = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { detached: true, stdio: 'ignore', windowsHide: true });`,
        "child.unref();",
        "process.stdout.write(String(child.pid) + '\\n');",
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const spawned = createManagedClaudeProcessSpawner(immediate.signal)({
        command: process.execPath,
        args: ["-e", parentProgram],
        cwd: process.cwd(),
        env: { ...process.env },
        signal: new AbortController().signal,
      });
      const parentPid = (spawned as typeof spawned & { pid?: number }).pid;
      let grandchildPid: number | undefined;

      try {
        grandchildPid = await new Promise<number>((resolve, reject) => {
          let output = "";
          const timeout = setTimeout(() => reject(new Error("test child did not report its PID")), 5_000);
          spawned.stdout.on("data", (chunk) => {
            output += chunk.toString();
            const line = output.split(/\r?\n/, 1)[0];
            if (!/^\d+$/.test(line)) return;
            clearTimeout(timeout);
            resolve(Number(line));
          });
          spawned.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
        const parentExited = new Promise<void>((resolve) => spawned.once("exit", () => resolve()));
        const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
        const parentOnlyKill = spawnSync(
          path.join(systemRoot, "System32", "taskkill.exe"),
          ["/PID", String(parentPid), "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        expect(parentOnlyKill.status).toBe(0);
        await parentExited;
        expect(alive(parentPid!)).toBe(false);
        expect(alive(grandchildPid)).toBe(true);

        immediate.abort();
        const stopPromise = (immediate.signal as AbortSignal & {
          [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
        })[PROCESS_TREE_STOP_PROMISE_KEY];
        expect(stopPromise).toBeInstanceOf(Promise);
        await expect(stopPromise).resolves.toBe(true);
        expect(alive(grandchildPid)).toBe(false);
        expect(
          (immediate.signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY],
        ).toBe(true);
      } finally {
        forceKillTree(parentPid);
        forceKillTree(grandchildPid);
      }
    },
    20_000,
  );
});
