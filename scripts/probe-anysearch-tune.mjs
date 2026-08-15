// 轮 4 卡 H 探针④：AnySearch 能否让服务端别回 content（省上下文），以及延迟是否稳定。
// 探针③已确认：POST /v1/search 免 key 可用（10 条），但每条带全页正文 → 70~113KB。
// 原样进模型 = 一次搜索吃掉几万 token，必须治。优先问服务端要，其次客户端裁。
const URL = "https://api.anysearch.com/v1/search";
const CT = { "content-type": "application/json", "X-Anysearch-Client": "leemo/0.0.1" };

async function call(label, payload) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, { method: "POST", headers: CT, body: JSON.stringify(payload) });
    const text = await res.text();
    const ms = Date.now() - t0;
    let n = "?", hasContent = "?";
    try {
      const j = JSON.parse(text);
      const r = j.data?.results ?? [];
      n = r.length;
      hasContent = r.some((x) => typeof x.content === "string" && x.content.length > 200) ? "有正文" : "无正文";
    } catch {}
    console.log(`  ${label.padEnd(34)} ${res.status} · ${String(ms).padStart(5)}ms · ${String(n).padStart(2)}条 · ${String(Math.round(text.length / 1024)).padStart(4)}KB · ${hasContent}`);
    return { ms, n, kb: Math.round(text.length / 1024) };
  } catch (e) {
    console.log(`  ${label.padEnd(34)} FAIL ${e.cause?.code ?? e.name}`);
    return null;
  }
}

const q = "TypeScript 5.6 release notes";
console.log("=== 参数能否压掉 content ===");
await call("baseline", { query: q });
await call("exclude_content:true", { query: q, exclude_content: true });
await call("params.exclude_content:true", { query: q, params: { exclude_content: true } });
await call("count:3", { query: q, count: 3 });
await call("top_k:3", { query: q, top_k: 3 });
await call("summary_only:true", { query: q, summary_only: true });

console.log("\n=== 延迟稳定性（同一查询连打 4 次，看是否稳定在 6~9s）===");
const runs = [];
for (let i = 1; i <= 4; i++) {
  const r = await call(`run ${i}`, { query: q, exclude_content: true });
  if (r) runs.push(r.ms);
}
if (runs.length) {
  const sorted = [...runs].sort((a, b) => a - b);
  console.log(`  min=${sorted[0]}ms  median=${sorted[Math.floor(sorted.length / 2)]}ms  max=${sorted.at(-1)}ms`);
}
