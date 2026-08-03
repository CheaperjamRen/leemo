import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const executable = path.resolve(process.argv[2] || "dist-package/win-unpacked/Leemo.exe");
if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-public-startup-"));
const child = spawn(executable, [`--user-data-dir=${tempRoot}`], {
  cwd: tempRoot,
  stdio: "ignore",
  windowsHide: true,
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 6_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Packaged Leemo exited early with code ${code}`));
    });
  });
  console.log(JSON.stringify({ status: "ready", executable }, null, 2));
} finally {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const relative = path.relative(os.tmpdir(), tempRoot);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
