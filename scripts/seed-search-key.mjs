// 把一把搜索源 key 存进 Leemo 的加密件（轮 4 卡 H）。
//
// 为什么要起 Electron：safeStorage 只存在于 Electron 主进程（DPAPI/Keychain/
// libsecret 的封装），普通 node 脚本写不了这份文件。所以这里起一个无窗口的最小
// 主进程，走**和 main.ts 完全同一条**加解密路径，写完立刻读回来验证。
//
// 用法（PowerShell）:
//   $env:LEEMO_SEED_SOURCE="tavily"; $env:LEEMO_SEED_KEY="tvly-..."
//   npx electron scripts/seed-search-key.mjs
//
// key 只经环境变量进来，不写进仓库、不打进日志（下面只打印长度和前缀）。
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const SOURCE = process.env.LEEMO_SEED_SOURCE ?? "";
const KEY = process.env.LEEMO_SEED_KEY ?? "";

app.whenReady().then(() => {
  try {
    if (!["anysearch", "tavily", "bocha"].includes(SOURCE)) {
      throw new Error(`LEEMO_SEED_SOURCE 必须是 anysearch|tavily|bocha，收到 "${SOURCE}"`);
    }
    if (!KEY.trim()) throw new Error("LEEMO_SEED_KEY 为空");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("这台机器上 safeStorage 不可用，无法加密落盘");
    }

    const secretsPath = path.join(app.getPath("userData"), "leemo-secrets.enc");
    console.log(`加密件: ${secretsPath}`);

    // 读现有内容（首跑可能还没有这个文件）
    let config = { version: 1, providers: {} };
    if (fs.existsSync(secretsPath)) {
      const plain = safeStorage.decryptString(fs.readFileSync(secretsPath));
      config = JSON.parse(plain);
      const n = Object.keys(config.providers ?? {}).length;
      console.log(`已有配置: ${n} 个 provider 实例，searchKeys=${JSON.stringify(Object.keys(config.searchKeys ?? {}))}`);
    } else {
      console.log("加密件还不存在，将新建（provider 部分留空，不影响你已配的 —— 若你已配过，请先启动过一次 Leemo）");
    }

    // 合并这一把 key（不动 provider 部分）
    config.searchKeys = { ...(config.searchKeys ?? {}), [SOURCE]: KEY.trim() };
    fs.writeFileSync(secretsPath, safeStorage.encryptString(JSON.stringify(config)));

    // 读回来验证真能解密（写进去解不出来 = 白存）
    const back = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsPath)));
    const stored = back.searchKeys?.[SOURCE] ?? "";
    const ok = stored === KEY.trim();
    console.log(`回读验证: ${ok ? "OK" : "不一致！"} — ${SOURCE} 长度 ${stored.length}，前缀 ${stored.slice(0, 9)}…`);
    console.log(`现有搜索源: ${JSON.stringify(Object.keys(back.searchKeys ?? {}))}`);
    console.log(`provider 实例仍是 ${Object.keys(back.providers ?? {}).length} 个（没被动过）`);
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`失败: ${e.message}`);
    app.exit(1);
  }
});
