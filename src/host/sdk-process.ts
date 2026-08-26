import { spawn } from "node:child_process";
import path from "node:path";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import {
  PROCESS_TREE_STOP_PROMISE_KEY,
  PROCESS_TREE_STOP_RESULT_KEY,
} from "../bridge/pool";

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
  /** Independent process-table observations represented by this result. The
   * Windows implementation samples twice inside one PowerShell process so the
   * second stability check does not pay another shell startup. */
  observations?: number;
}

export interface WindowsProcessTreeOps {
  snapshotDescendants(seedPids: readonly number[]): Promise<DescendantSnapshot>;
  isAlive(pid: number): boolean;
  terminate(pid: number): Promise<boolean>;
}

function windowsSystemTool(...segments: string[]): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return path.join(systemRoot, "System32", ...segments);
}

function runHiddenProcess(
  executable: string,
  args: string[],
  captureStdout: boolean,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "ignore"],
    });
    let stdout = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout });
    };
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.once("error", () => finish(false));
    child.once("exit", (code, signal) => finish(code === 0 && signal === null));
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish(false);
    }, timeoutMs);
  });
}

/** Capture the process family before taskkill runs. `taskkill /T` can return
 * non-zero after the root exits even though a command grandchild is still
 * alive; Win32_Process retains the creator PID, so the family can still be
 * reconstructed from ParentProcessId and each known survivor checked. The
 * command is asynchronous so main-process IPC stays responsive. */
async function snapshotWindowsDescendants(seedPids: readonly number[]): Promise<DescendantSnapshot> {
  const seeds = [...new Set(seedPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (seeds.length === 0) return { ok: true, pids: [] };
  const seedLiteral = seeds.join(",");
  const command = [
    `$seed=@(${seedLiteral})`,
    "$first=@(Get-CimInstance Win32_Process -ErrorAction Stop)",
    "Start-Sleep -Milliseconds 75",
    "$second=@(Get-CimInstance Win32_Process -ErrorAction Stop)",
    "$all=@($first+$second | Sort-Object ProcessId -Unique)",
    "$ids=@($seed)",
    "do {$children=@($all | Where-Object {$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId} | Select-Object -ExpandProperty ProcessId);$before=$ids.Count;$ids=@($ids+$children | Select-Object -Unique)} while($ids.Count -gt $before)",
    "$ids | Where-Object {$seed -notcontains $_}",
  ].join("; ");
  const result = await runHiddenProcess(
    windowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", command],
    true,
  );
  if (!result.ok) return { ok: false, pids: [] };
  const pids = result.stdout
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0 && !seeds.includes(value));
  return { ok: true, pids: [...new Set(pids)], observations: 2 };
}

async function runWindowsTaskkill(pid: number): Promise<boolean> {
  const result = await runHiddenProcess(
    windowsSystemTool("taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    false,
  );
  return result.ok;
}

/** Production Windows fast path: keep pre-kill discovery, taskkill, and two
 * post-kill process-table observations inside one hidden PowerShell process.
 * PowerShell startup dominated Stop latency when each observation spawned a
 * separate shell; this preserves the verification contract without freezing
 * main-process IPC or making the user wait through three startups. */
async function terminateWindowsProcessTreeVerified(rootPid: number): Promise<boolean> {
  const command = [
    "$ErrorActionPreference='Stop'",
    `$rootPid=${rootPid}`,
    "$owned=[System.Collections.Generic.HashSet[int]]::new()",
    "[void]$owned.Add($rootPid)",
    "function Add-Family($table,$ids){do{$added=$false;foreach($proc in $table){$parent=[int]$proc.ParentProcessId;$child=[int]$proc.ProcessId;if($ids.Contains($parent)-and -not $ids.Contains($child)){[void]$ids.Add($child);$added=$true}}}while($added)}",
    "$initial=@(Get-CimInstance Win32_Process -ErrorAction Stop)",
    "Add-Family $initial $owned",
    "$taskkill=Join-Path $env:SystemRoot 'System32\\taskkill.exe'",
    "foreach($ownedPid in @($owned)){if(Get-Process -Id $ownedPid -ErrorAction SilentlyContinue){& $taskkill /PID $ownedPid /T /F 2>$null | Out-Null}}",
    "$verified=$false",
    "for($attempt=0;$attempt -lt 6;$attempt++){Start-Sleep -Milliseconds 60;$first=@(Get-CimInstance Win32_Process -ErrorAction Stop);$beforeFirst=$owned.Count;Add-Family $first $owned;$discoveredFirst=$owned.Count -gt $beforeFirst;$killed=$false;foreach($ownedPid in @($owned)){if(Get-Process -Id $ownedPid -ErrorAction SilentlyContinue){$killed=$true;& $taskkill /PID $ownedPid /T /F 2>$null | Out-Null}};Start-Sleep -Milliseconds 60;$second=@(Get-CimInstance Win32_Process -ErrorAction Stop);$beforeSecond=$owned.Count;Add-Family $second $owned;$discoveredSecond=$owned.Count -gt $beforeSecond;$alive=@(foreach($ownedPid in $owned){if(Get-Process -Id $ownedPid -ErrorAction SilentlyContinue){$ownedPid}});if(-not $discoveredFirst -and -not $killed -and -not $discoveredSecond -and $alive.Count -eq 0){$verified=$true;break}}",
    "if($verified){Write-Output 'LEEMO_STOP_OK';exit 0}else{exit 1}",
  ].join("; ");
  const result = await runHiddenProcess(
    windowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", command],
    true,
    8_000,
  );
  return result.ok && result.stdout.includes("LEEMO_STOP_OK");
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
 * the intermediate disappears. One stable pass after the latest discovery is
 * sufficient because taskkill /T performs its own live descendant traversal.
 * Any failed snapshot or bounded-loop exhaustion is fail-closed. */
export async function terminateWindowsProcessTree(
  rootPid: number,
  ops: WindowsProcessTreeOps = DEFAULT_WINDOWS_PROCESS_TREE_OPS,
): Promise<boolean> {
  const ownedPids = new Set<number>([rootPid]);
  let stableEmptyPasses = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const beforeSize = ownedPids.size;
    let terminatedAny = false;
    // On the common active-round path, start taskkill /T at the same time as
    // the ancestry snapshot. The snapshot still preserves any child whose
    // parent exits during cleanup, while IPC no longer waits for two serial
    // system commands before Stop can settle.
    const snapshotPromise = ops.snapshotDescendants([...ownedPids]);
    const rootStopPromise = attempt === 0 && ops.isAlive(rootPid)
      ? ops.terminate(rootPid)
      : Promise.resolve(true);
    const [snapshot] = await Promise.all([snapshotPromise, rootStopPromise]);
    if (!snapshot.ok) {
      for (const ownedPid of ownedPids) {
        if (ops.isAlive(ownedPid)) await ops.terminate(ownedPid);
      }
      return false;
    }
    for (const descendant of snapshot.pids) {
      if (Number.isSafeInteger(descendant) && descendant > 0) ownedPids.add(descendant);
    }
    for (const ownedPid of ownedPids) {
      if (ops.isAlive(ownedPid)) {
        terminatedAny = true;
        await ops.terminate(ownedPid);
      }
    }

    const allKnownProcessesStopped = [...ownedPids].every((ownedPid) => !ops.isAlive(ownedPid));
    const discoveredNothingNew = ownedPids.size === beforeSize;
    // Attempt zero's snapshot overlaps root termination for responsiveness, so
    // it can only collect candidates. A child may appear after that snapshot.
    // Require two later stable empty observations before releasing the round.
    if (attempt > 0 && allKnownProcessesStopped && discoveredNothingNew && !terminatedAny) {
      stableEmptyPasses += Math.max(1, snapshot.observations ?? 1);
      if (stableEmptyPasses >= 2) return true;
    } else {
      stableEmptyPasses = 0;
    }
  }
  return false;
}

async function terminateProcessTree(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;

  if (process.platform === "win32") {
    return terminateWindowsProcessTreeVerified(pid);
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
    const stopState = signal as AbortSignal & {
      [PROCESS_TREE_STOP_RESULT_KEY]?: boolean;
      [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
    };
    // Managed spawns start fail-closed. The abort listener must replace this
    // with a verified result before the pool can release the conversation.
    stopState[PROCESS_TREE_STOP_RESULT_KEY] = false;
    const stopTree = (): void => {
      const pending = (child.pid === undefined
        ? Promise.resolve(true)
        : terminateProcessTree(child.pid))
        .catch(() => false)
        .then((stopped) => {
          stopState[PROCESS_TREE_STOP_RESULT_KEY] = stopped;
          return stopped;
        });
      stopState[PROCESS_TREE_STOP_PROMISE_KEY] = pending;
    };

    if (signal.aborted) stopTree();
    else signal.addEventListener("abort", stopTree, { once: true });
    return child;
  };
}
