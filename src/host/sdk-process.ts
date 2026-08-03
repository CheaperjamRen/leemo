import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { PROCESS_TREE_STOP_RESULT_KEY } from "../bridge/pool";

/** Kill only the CLI process tree owned by one SDK round.
 *
 * Node's `child.kill()` maps to TerminateProcess on Windows and leaves Bash /
 * PowerShell grandchildren alive. `taskkill /T` follows that one PID's tree,
 * so concurrent Leemo conversations keep their own CLI and tools. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

export interface DescendantSnapshot {
  ok: boolean;
  pids: number[];
}

export interface WindowsProcessTreeOps {
  snapshotDescendants(seedPids: readonly number[]): DescendantSnapshot;
  isAlive(pid: number): boolean;
  terminate(pid: number): boolean;
}

function windowsSystemTool(...segments: string[]): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return path.join(systemRoot, "System32", ...segments);
}

/** Capture the process family before taskkill runs. `taskkill /T` can return
 * non-zero after the root exits even though a command grandchild is still
 * alive; Win32_Process retains the creator PID, so the family can still be
 * reconstructed from ParentProcessId and each known survivor checked. */
function snapshotWindowsDescendants(seedPids: readonly number[]): DescendantSnapshot {
  const seeds = [...new Set(seedPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (seeds.length === 0) return { ok: true, pids: [] };
  const seedLiteral = seeds.join(",");
  const command = [
    `$seed=@(${seedLiteral})`,
    "$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)",
    "$ids=@($seed)",
    "do {$children=@($all | Where-Object {$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId} | Select-Object -ExpandProperty ProcessId);$before=$ids.Count;$ids=@($ids+$children | Select-Object -Unique)} while($ids.Count -gt $before)",
    "$ids | Where-Object {$seed -notcontains $_}",
  ].join("; ");
  const result = spawnSync(
    windowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    },
  );
  if (result.error || result.signal !== null || result.status !== 0) return { ok: false, pids: [] };
  const pids = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0 && !seeds.includes(value));
  return { ok: true, pids: [...new Set(pids)] };
}

function runWindowsTaskkill(pid: number): boolean {
  const result = spawnSync(windowsSystemTool("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
    timeout: 5_000,
  });
  return !result.error && result.signal === null && result.status === 0;
}

const DEFAULT_WINDOWS_PROCESS_TREE_OPS: WindowsProcessTreeOps = {
  snapshotDescendants: snapshotWindowsDescendants,
  isAlive: processAlive,
  terminate: runWindowsTaskkill,
};

/** Terminate until the owned family reaches a stable empty fixed point.
 *
 * A single pre-kill snapshot has a TOCTOU hole: a known intermediate process
 * can spawn a detached child after enumeration and then exit. Retaining every
 * known PID as a future enumeration seed preserves that ancestry even after
 * the intermediate disappears. Two consecutive stable snapshots are required
 * because CIM visibility can lag process creation. Any failed snapshot or
 * bounded-loop exhaustion is fail-closed. */
export function terminateWindowsProcessTree(
  rootPid: number,
  ops: WindowsProcessTreeOps = DEFAULT_WINDOWS_PROCESS_TREE_OPS,
): boolean {
  const ownedPids = new Set<number>([rootPid]);
  let stablePasses = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const beforeSize = ownedPids.size;
    const snapshot = ops.snapshotDescendants([...ownedPids]);
    if (!snapshot.ok) {
      for (const ownedPid of ownedPids) {
        if (ops.isAlive(ownedPid)) ops.terminate(ownedPid);
      }
      return false;
    }
    for (const descendant of snapshot.pids) {
      if (Number.isSafeInteger(descendant) && descendant > 0) ownedPids.add(descendant);
    }
    for (const ownedPid of ownedPids) {
      if (ops.isAlive(ownedPid)) ops.terminate(ownedPid);
    }

    const allKnownProcessesStopped = [...ownedPids].every((ownedPid) => !ops.isAlive(ownedPid));
    const discoveredNothingNew = ownedPids.size === beforeSize;
    stablePasses = allKnownProcessesStopped && discoveredNothingNew ? stablePasses + 1 : 0;
    if (stablePasses >= 2) return true;
  }
  return false;
}

function terminateProcessTree(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;

  if (process.platform === "win32") {
    // Keep this synchronous. The pool releases the conversation for a new
    // round immediately after AbortController.abort() returns; an async
    // taskkill would let the replacement CLI resume the same transcript while
    // the old process tree is still writing it.
    return terminateWindowsProcessTree(pid);
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    // Already exited.
    return true;
  }
}

/** Build the SDK's per-query spawn hook bound to the caller's immediate abort.
 *
 * The SDK's forwarded SpawnOptions signal intentionally waits for a graceful
 * shutdown window. On Windows the CLI can exit during that window while a
 * command grandchild keeps running, after which its old PID tree can no longer
 * be found. Binding the round's original signal lets us terminate the intact
 * tree at the exact moment the user presses Stop. */
export function createManagedClaudeProcessSpawner(
  immediateAbort?: AbortSignal,
): (options: SpawnOptions) => SpawnedProcess {
  return (options) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // The SDK custom-spawn contract consumes stdin/stdout but exposes no stderr
    // callback. Leaving this pipe paused lets a verbose CLI fill the OS buffer
    // and deadlock before it can produce another protocol message on stdout.
    child.stderr.resume();
    const signal = immediateAbort ?? options.signal;
    // Managed spawns start fail-closed. The abort listener must replace this
    // with a verified result before the pool can release the conversation.
    (signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] = false;
    const stopTree = (): void => {
      const stopped = child.pid === undefined ? true : terminateProcessTree(child.pid);
      (signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] = stopped;
    };

    if (signal.aborted) stopTree();
    else signal.addEventListener("abort", stopTree, { once: true });
    return child;
  };
}
