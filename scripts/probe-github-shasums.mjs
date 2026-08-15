// 轮 5 打包探针：electron-builder 卡在哪一个请求上。
//
// 读 app-builder-lib/out/util/electronGet.js 得到的事实：electron 的 zip 命中缓存
// 之后，@electron/get 还会去下 `SHASUMS256.txt` 校验完整性，而 downloadOptions 里
// `timeout: { request: 10*60*1000 }` —— 正好等于我们看到的
// `Timeout awaiting 'request' for 600000ms`。
//
// 这个探针只回答一件事：那个 URL 从 **Node** 拿得到吗？直连 vs 走 VPN 代理。
// （PowerShell 能过不代表 Node 能过 —— 本网络此前就有过这种不对称。）
const URL_SHASUMS = "https://github.com/electron/electron/releases/download/v43.2.0/SHASUMS256.txt";
const PROXY = "http://127.0.0.1:10801";
const TIMEOUT_MS = 15000;

async function attempt(label, opts = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_SHASUMS, { signal: ac.signal, ...opts });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.includes("win32-x64.zip")) ?? "(未找到 win32-x64 行)";
    console.log(`PASS  ${label}  ${Date.now() - t0}ms  status=${res.status} bytes=${text.length}`);
    console.log(`      ${line.trim().slice(0, 90)}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${label}  ${Date.now() - t0}ms  ${e.name}: ${e.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

console.log(`node ${process.version}`);
console.log(`目标 ${URL_SHASUMS}\n`);

// ① 直连（electron-builder 默认走的路）
await attempt("直连");

// ② 走 VPN 代理。Node 的 fetch 不认 http_proxy 环境变量，要显式给 dispatcher；
//    undici 是 Node 内置的，ProxyAgent 从 node:  内部拿不到，故用 undici 包若在，
//    否则退回 http.request 手动 CONNECT 的最小实现。
let proxied = false;
try {
  const { ProxyAgent } = await import("undici");
  proxied = await attempt("VPN 代理 (undici ProxyAgent)", { dispatcher: new ProxyAgent(PROXY) });
} catch {
  console.log("SKIP  undici 不可直接 import，改用 https+CONNECT 手动试");
  const https = await import("node:https");
  const http = await import("node:http");
  const { URL } = await import("node:url");
  const target = new URL(URL_SHASUMS);
  proxied = await new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request({
      host: "127.0.0.1",
      port: 10801,
      method: "CONNECT",
      path: `${target.hostname}:443`,
      timeout: TIMEOUT_MS,
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        console.log(`FAIL  VPN 代理 CONNECT status=${res.statusCode}`);
        socket.destroy();
        return resolve(false);
      }
      const r = https.request(
        { host: target.hostname, path: target.pathname, socket, agent: false, timeout: TIMEOUT_MS },
        (r2) => {
          let body = "";
          r2.on("data", (d) => (body += d));
          r2.on("end", () => {
            console.log(`PASS  VPN 代理 (CONNECT)  ${Date.now() - t0}ms status=${r2.statusCode} bytes=${body.length}`);
            resolve(true);
          });
        },
      );
      r.on("timeout", () => { console.log("FAIL  VPN 代理 超时"); r.destroy(); resolve(false); });
      r.on("error", (e) => { console.log(`FAIL  VPN 代理 ${e.message}`); resolve(false); });
      r.end();
    });
    req.on("timeout", () => { console.log("FAIL  CONNECT 超时"); req.destroy(); resolve(false); });
    req.on("error", (e) => { console.log(`FAIL  CONNECT ${e.message}`); resolve(false); });
    req.end();
  });
}

console.log(`\n结论：直连=${process.exitCode === undefined ? "见上" : ""} 代理可用=${proxied}`);
