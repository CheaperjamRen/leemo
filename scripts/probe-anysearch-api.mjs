// 轮 4 卡 H 探针③：AnySearch 真实调用形状。
// 前两次探针只发 GET，全 404 —— 路由对方法敏感。用户给出的形状是
// POST /v1/search {query, tag, params}。文档 L177 称无 key 时要保留
// X-Anysearch-Client 头，匿名即可用；探针②的匿名 401 没带该头，故重测。
const KEY = process.env.ANYSEARCH_KEY ?? "";
const URL = "https://api.anysearch.com/v1/search";
const body = JSON.stringify({
  query: "TypeScript 5.6 release notes",
  tag: "code.doc",
  params: { library: "typescript" },
});

async function call(label, headers) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, { method: "POST", headers, body });
    const text = await res.text();
    const ms = Date.now() - t0;
    let shape = "";
    try {
      const j = JSON.parse(text);
      const arr = j.data?.results ?? j.results ?? j.data ?? [];
      shape = Array.isArray(arr)
        ? `code=${j.code ?? "-"} results=${arr.length} keys=[${Object.keys(arr[0] ?? {}).join(",")}]`
        : `code=${j.code ?? "-"} keys=[${Object.keys(j).join(",")}]`;
    } catch { shape = "(non-JSON)"; }
    console.log(`${label}\n  HTTP ${res.status} · ${ms}ms · ${text.length}B\n  ${shape}\n  ${text.slice(0, 220).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`${label}\n  FAIL ${e.cause?.code ?? e.name}: ${e.message}`);
  }
}

const CT = { "content-type": "application/json" };
await call("① 纯匿名（无任何自定义头）", CT);
await call("② 匿名 + X-Anysearch-Client（文档 L177 的说法）",
  { ...CT, "X-Anysearch-Client": "leemo/0.0.1" });
if (KEY) {
  await call("③ 带 key（Bearer）",
    { ...CT, authorization: `Bearer ${KEY}`, "X-Anysearch-Client": "leemo/0.0.1" });
} else {
  console.log("③ 跳过：未设 ANYSEARCH_KEY 环境变量");
}
