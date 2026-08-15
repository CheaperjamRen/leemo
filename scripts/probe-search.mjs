// 轮 4 卡 H 探针①：AnySearch 到底存不存在 + 各付费源无 key 时的错误形状。
// 06 §4 把 AnySearch 当"免 key 默认源"，Phase 0 只测到 api 端点 404 —— 404 和
// "域名根本不存在"是两件事，前者是路径猜错，后者是整个前提塌了。必须分清。
const TIMEOUT = 8000;

async function probe(label, url, init = {}) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    const res = await fetch(url, {
      redirect: "manual",
      signal: ac.signal,
      headers: { "user-agent": "Mozilla/5.0", ...(init.headers ?? {}) },
      ...init,
    });
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    const ms = Date.now() - t0;
    console.log(`${label}\n  ${res.status} ${res.statusText} · ${ms}ms · ${body.length}B` +
      (res.headers.get("location") ? `\n  → ${res.headers.get("location")}` : "") +
      (body ? `\n  body: ${body.slice(0, 160).replace(/\s+/g, " ")}` : ""));
    return { label, status: res.status, ms, len: body.length };
  } catch (e) {
    console.log(`${label}\n  FAIL ${e.cause?.code ?? e.name}: ${e.message}`);
    return { label, status: 0, err: e.cause?.code ?? e.name };
  }
}

const out = [];
console.log("=== ① AnySearch 域名/端点是否存在 ===");
for (const u of [
  "https://anysearch.com/", "https://www.anysearch.com/",
  "https://api.anysearch.com/", "https://anysearch.ai/", "https://anysearch.io/",
]) out.push(await probe(u, u));

console.log("\n=== ② 付费源无 key 时的错误形状（决定 fallback 判据）===");
out.push(await probe("Tavily (no key)", "https://api.tavily.com/search", {
  method: "POST", redirect: "follow",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "test" }),
}));
out.push(await probe("博查 Bocha (no key)", "https://api.bochaai.com/v1/web-search", {
  method: "POST", redirect: "follow",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "test" }),
}));

console.log("\n=== 汇总 ===");
for (const r of out) {
  const verdict = r.status === 0 ? `不可达 (${r.err})`
    : r.status === 401 || r.status === 403 ? "存在，要 key"
    : r.status === 404 ? "域名在，端点不对"
    : r.status >= 200 && r.status < 400 ? "有响应"
    : `HTTP ${r.status}`;
  console.log(`  ${r.label} → ${verdict}`);
}
