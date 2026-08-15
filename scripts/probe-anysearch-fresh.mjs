// 轮 4 卡 H 探针⑤：用服务端没见过的查询复核延迟/体积（探针④疑似命中查询缓存），
// 并量清 31KB 里各字段占比 —— 决定客户端裁到什么程度还够模型引用。
const URL = "https://api.anysearch.com/v1/search";
const H = { "content-type": "application/json", "X-Anysearch-Client": "leemo/0.0.1" };
const stamp = Date.now(); // 掺进查询里，确保不是缓存命中

const queries = [
  `Vitest 4 workspace config ${stamp}`,
  `Electron 32 webUtils getPathForFile ${stamp}`,
  `高等数学 泰勒展开 例题 ${stamp}`,
  `SQLite WAL mode concurrent writes ${stamp}`,
];

const lens = { title: 0, url: 0, snippet: 0, content: 0, other: 0 };
let n = 0;
const mss = [];

for (const q of queries) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, { method: "POST", headers: H, body: JSON.stringify({ query: q }) });
    const text = await res.text();
    const ms = Date.now() - t0;
    mss.push(ms);
    const j = JSON.parse(text);
    const r = j.data?.results ?? [];
    for (const hit of r) {
      n++;
      for (const k of ["title", "url", "snippet", "content"]) lens[k] += (hit[k] ?? "").length;
      for (const k of Object.keys(hit)) {
        if (!["title", "url", "snippet", "content"].includes(k)) lens.other += String(hit[k] ?? "").length;
      }
    }
    const snip = r.length ? Math.round(r.reduce((a, x) => a + (x.snippet ?? "").length, 0) / r.length) : 0;
    const cont = r.length ? Math.round(r.reduce((a, x) => a + (x.content ?? "").length, 0) / r.length) : 0;
    console.log(`${String(ms).padStart(5)}ms · ${String(r.length).padStart(2)}条 · ${String(Math.round(text.length / 1024)).padStart(3)}KB · 均 snippet=${snip} content=${cont}`);
    console.log(`   ${q.replace(` ${stamp}`, "")}\n   → ${(r[0]?.title ?? "(无)").slice(0, 70)}`);
  } catch (e) {
    console.log(`FAIL ${e.cause?.code ?? e.name} — ${q}`);
  }
}

const sorted = [...mss].sort((a, b) => a - b);
console.log(`\n延迟(新查询): min=${sorted[0]}ms median=${sorted[Math.floor(sorted.length / 2)]}ms max=${sorted.at(-1)}ms`);
const total = Object.values(lens).reduce((a, b) => a + b, 0);
console.log(`字段占比(${n} 条合计 ${Math.round(total / 1024)}KB):`);
for (const [k, v] of Object.entries(lens)) {
  console.log(`  ${k.padEnd(8)} ${String(Math.round(v / 1024)).padStart(3)}KB  ${((v / total) * 100).toFixed(1)}%`);
}
const keep = lens.title + lens.url + lens.snippet;
console.log(`\n只留 title+url+snippet ⇒ ${Math.round(keep / 1024)}KB（原 ${Math.round(total / 1024)}KB，省 ${(100 - (keep / total) * 100).toFixed(0)}%）`);
