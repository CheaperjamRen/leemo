// 轮 5 打包诊断：把每一个出网请求的目标打出来。
//
// 起因：electron-builder 在 "downloaded label=electron progress=100%" 之后卡住，
// 600s 后报 `Timeout awaiting 'request'`，而 TCP 对端是个 GitHub CDN IP —— 光看
// 日志不知道它在要哪个 URL。用 --require 挂上这个钩子，最后一行 REQ 就是元凶。
//
// 用法：NODE_OPTIONS="--require E:\Leemo\scripts\http-trace.cjs" npm run electron:pack
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");

function label(args) {
  const [a, b] = args;
  if (typeof a === "string") return a;
  if (a && typeof a === "object") {
    const proto = a.protocol || "https:";
    const host = a.hostname || a.host || "?";
    const p = a.path || a.pathname || "";
    return `${proto}//${host}${p}`;
  }
  if (b && typeof b === "object") return `${b.hostname || b.host}${b.path || ""}`;
  return "(unknown)";
}

for (const [mod, name] of [
  [http, "http"],
  [https, "https"],
]) {
  for (const fn of ["request", "get"]) {
    const orig = mod[fn];
    mod[fn] = function (...args) {
      const target = label(args);
      const t0 = Date.now();
      process.stderr.write(`[REQ ] ${name}.${fn} ${target}\n`);
      const req = orig.apply(this, args);
      req.on("response", (res) =>
        process.stderr.write(`[RESP] ${res.statusCode} ${Date.now() - t0}ms ${target}\n`),
      );
      req.on("error", (e) =>
        process.stderr.write(`[ERR ] ${e.code || e.message} ${Date.now() - t0}ms ${target}\n`),
      );
      req.on("timeout", () =>
        process.stderr.write(`[TMO ] ${Date.now() - t0}ms ${target}\n`),
      );
      return req;
    };
  }
}

const origConnect = tls.connect;
tls.connect = function (...args) {
  const o = typeof args[0] === "object" ? args[0] : {};
  process.stderr.write(`[TLS ] ${o.host || o.servername || "?"}:${o.port || 443}\n`);
  return origConnect.apply(this, args);
};

process.stderr.write("[http-trace] armed\n");
