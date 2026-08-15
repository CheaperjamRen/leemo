// 轮 4 卡 H 探针②：AnySearch 若真有 API，端点在哪、要不要 key。
// 探针①已知：anysearch.com 返回 Next.js 错误页外壳，api.anysearch.com 是 Go 的
// "404 page not found"（有服务、无开放路由）。这里把所有合理路径试一遍再下结论 ——
// 免 key 默认源是 06 §4 的设计前提，塌了要明说，不能糊过去。
const TIMEOUT = 8000;

async function hit(url, init = {}) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    const res = await fetch(url, {
      signal: ac.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0", ...(init.headers ?? {}) }, ...init,
    });
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    return { status: res.status, ct: res.headers.get("content-type") ?? "", body };
  } catch (e) {
    return { status: 0, err: e.cause?.code ?? e.name, body: "" };
  }
}

const paths = [
  "search", "api/search", "v1/search", "api/v1/search",
  "query", "api/query", "web-search", "api/web-search",
];
console.log("=== api.anysearch.com 路径扫描 (GET ?q=test) ===");
for (const p of paths) {
  const r = await hit(`https://api.anysearch.com/${p}?q=test`);
  const looksJson = r.ct.includes("json");
  console.log(`  /${p.padEnd(16)} ${r.status || "FAIL " + r.err}` +
    (looksJson ? `  JSON: ${r.body.slice(0, 120).replace(/\s+/g, " ")}` : r.body ? `  ${r.body.slice(0, 60).replace(/\s+/g, " ")}` : ""));
}

console.log("\n=== anysearch.ai 这是什么站 ===");
const ai = await hit("https://anysearch.ai/");
const title = ai.body.match(/<title[^>]*>([^<]+)</i)?.[1]?.trim();
const desc = ai.body.match(/name="description"\s+content="([^"]+)"/i)?.[1]?.trim();
console.log(`  title: ${title ?? "(none)"}`);
console.log(`  desc:  ${(desc ?? "(none)").slice(0, 200)}`);
// 有没有 API/文档入口
const apiLinks = [...ai.body.matchAll(/href="([^"]*(?:api|doc|developer)[^"]*)"/gi)]
  .map((m) => m[1]).filter((h, i, a) => a.indexOf(h) === i).slice(0, 8);
console.log(`  api/doc 链接: ${apiLinks.length ? apiLinks.join(" , ") : "(无)"}`);

console.log("\n=== 结论判据 ===");
console.log("  若上面无任何路径返回 JSON 搜索结果 ⇒ AnySearch 不能作免 key 默认源。");
