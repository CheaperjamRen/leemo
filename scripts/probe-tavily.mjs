// 验用户给的 Tavily key：能不能用、响应形状是否与适配器的字段映射一致、
// 以及最要紧的 —— 中文数学题搜得好不好（Bing 在这儿 3/3 全废）。
const KEY = process.env.TAVILY_KEY ?? "";
if (!KEY) { console.log("未设 TAVILY_KEY"); process.exit(1); }

const cases = [
  ["Vitest 4 release notes", /vitest/i],
  ["高等数学 泰勒展开 例题", /泰勒|taylor|微积分|高等数学/i],
  ["SQLite WAL 并发写", /sqlite|wal|并发/i],
];

for (const [q, re] of cases) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ query: q, max_results: 8 }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) { console.log(`\n"${q}" → HTTP ${res.status}: ${text.slice(0, 160)}`); continue; }
    const j = JSON.parse(text);
    const rs = j.results ?? [];
    console.log(`\n"${q}" → HTTP 200 · ${Date.now() - t0}ms · ${rs.length} 条 · ${Math.round(text.length / 1024)}KB`);
    console.log(`  顶层字段: [${Object.keys(j).join(", ")}]`);
    console.log(`  单条字段: [${Object.keys(rs[0] ?? {}).join(", ")}]`);
    const rel = rs.filter((r) => re.test(`${r.title ?? ""}${r.url ?? ""}`)).length;
    console.log(`  相关 ${rel}/${rs.length}`);
    for (const r of rs.slice(0, 3)) {
      console.log(`   · ${(r.title ?? "").slice(0, 58)}`);
      console.log(`     ${(r.url ?? "").slice(0, 78)}`);
      console.log(`     content ${String(r.content ?? "").length} 字符`);
    }
  } catch (e) {
    console.log(`\n"${q}" → FAIL ${e.cause?.code ?? e.name}: ${e.message}`);
  }
}
