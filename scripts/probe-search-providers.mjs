// Read-only live probe for Leemo's search sources. Credentials are accepted
// only through the current process environment and are never written or logged.
// Output is intentionally limited to source/status/hit-count/latency/category.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FACTS_PATH = path.join(
  ROOT,
  "docs",
  "research",
  "audit-shots",
  "search-r11-live-probe-facts.json",
);

const TIMEOUT_MS = Number(process.env.LEEMO_SEARCH_PROBE_TIMEOUT_MS ?? 15_000);
const MAX_RESULTS = 2;

const credentials = {
  anysearch: process.env.ANYSEARCH_API_KEY ?? "",
  doubao: process.env.DOUBAO_SEARCH_API_KEY ?? "",
  metaso: process.env.METASO_API_KEY ?? "",
  tavily: process.env.TAVILY_API_KEY ?? "",
  bocha: process.env.BOCHA_API_KEY ?? "",
  google: process.env.GOOGLE_SEARCH_API_KEY ?? "",
  googleCx: process.env.GOOGLE_SEARCH_ENGINE_ID ?? "",
};

const secrets = Object.values(credentials)
  .map((value) => value.trim())
  .filter((value) => value.length >= 4);

function timedSignal() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

function countArray(value) {
  return Array.isArray(value) ? Math.min(value.length, MAX_RESULTS) : 0;
}

function httpCategory(status) {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "quota_or_rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "http_error";
}

class ProbeFailure extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

async function jsonResponse(response) {
  if (!response.ok) throw new ProbeFailure(httpCategory(response.status));
  try {
    return await response.json();
  } catch {
    throw new ProbeFailure("malformed_response");
  }
}

async function runProbe(source, configured, probe) {
  if (!configured) {
    return { source, status: "not_configured", hits: 0, elapsedMs: 0, errorCategory: null };
  }
  const startedAt = Date.now();
  try {
    const hits = await probe();
    return {
      source,
      status: hits > 0 ? "ok" : "zero_results",
      hits,
      elapsedMs: Date.now() - startedAt,
      errorCategory: null,
    };
  } catch (error) {
    const category = error instanceof ProbeFailure
      ? error.category
      : error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "timeout"
        : "network_error";
    return {
      source,
      status: "failed",
      hits: 0,
      elapsedMs: Date.now() - startedAt,
      errorCategory: category,
    };
  }
}

async function probeAnySearch() {
  const headers = {
    "content-type": "application/json",
    "X-Anysearch-Client": "leemo",
  };
  if (credentials.anysearch.trim()) headers.authorization = `Bearer ${credentials.anysearch.trim()}`;
  const response = await fetch("https://api.anysearch.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "2026 人工智能 学习工具 最新进展" }),
    signal: timedSignal(),
  });
  const json = await jsonResponse(response);
  if (json?.code !== 0) throw new ProbeFailure("business_error");
  return countArray(json?.data?.results);
}

async function probeDoubao() {
  const response = await fetch("https://open.feedcoopapi.com/search_api/web_search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.doubao.trim()}`,
    },
    body: JSON.stringify({
      Query: "2026 人工智能 学习工具 最新进展",
      SearchType: "web",
      Count: MAX_RESULTS,
      Filter: { NeedContent: true, NeedUrl: true },
    }),
    signal: timedSignal(),
  });
  const json = await jsonResponse(response);
  if (json?.ResponseMetadata?.Error) throw new ProbeFailure("business_error");
  return countArray(json?.Result?.WebResults);
}

async function probeMetaso() {
  const response = await fetch("https://metaso.cn/api/open/search/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.metaso.trim()}`,
    },
    body: JSON.stringify({
      question: "2026 人工智能 学习工具 最新进展",
      stream: false,
      lang: "zh",
      needHighlight: false,
    }),
    signal: timedSignal(),
  });
  const json = await jsonResponse(response);
  if (json?.errCode !== 0) throw new ProbeFailure("business_error");
  return countArray(json?.data?.references);
}

async function probeTavily() {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.tavily.trim()}`,
    },
    body: JSON.stringify({ query: "2026 AI learning tools", max_results: MAX_RESULTS }),
    signal: timedSignal(),
  });
  return countArray((await jsonResponse(response))?.results);
}

async function probeBocha() {
  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.bocha.trim()}`,
    },
    body: JSON.stringify({ query: "2026 人工智能 学习工具", count: MAX_RESULTS }),
    signal: timedSignal(),
  });
  return countArray((await jsonResponse(response))?.data?.webPages?.value);
}

async function probeGoogle() {
  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
  url.searchParams.set("key", credentials.google.trim());
  url.searchParams.set("cx", credentials.googleCx.trim());
  url.searchParams.set("q", "2026 AI learning tools");
  url.searchParams.set("num", String(MAX_RESULTS));
  const response = await fetch(url, { signal: timedSignal() });
  const json = await jsonResponse(response);
  if (json?.error) throw new ProbeFailure("business_error");
  return countArray(json?.items);
}

async function probeArxiv() {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", "all:retrieval augmented generation learning");
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(MAX_RESULTS));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const response = await fetch(url, {
    headers: { "user-agent": "Leemo/0.0.1 search-verification" },
    signal: timedSignal(),
  });
  if (!response.ok) throw new ProbeFailure(httpCategory(response.status));
  const text = await response.text();
  if (!text.includes("<feed") || !text.includes("</feed>")) {
    throw new ProbeFailure("malformed_response");
  }
  return Math.min((text.match(/<(?:\w+:)?entry(?:\s|>)/g) ?? []).length, MAX_RESULTS);
}

const results = [];
results.push(await runProbe("anysearch", true, probeAnySearch));
results.push(await runProbe("doubao", Boolean(credentials.doubao.trim()), probeDoubao));
results.push(await runProbe("metaso", Boolean(credentials.metaso.trim()), probeMetaso));
results.push(await runProbe("tavily", Boolean(credentials.tavily.trim()), probeTavily));
results.push(await runProbe("bocha", Boolean(credentials.bocha.trim()), probeBocha));
results.push(await runProbe(
  "google",
  Boolean(credentials.google.trim() && credentials.googleCx.trim()),
  probeGoogle,
));
results.push(await runProbe("arxiv", true, probeArxiv));

const output = JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2);
if (secrets.some((secret) => output.includes(secret))) {
  throw new Error("probe output contained credential material");
}
fs.mkdirSync(path.dirname(FACTS_PATH), { recursive: true });
fs.writeFileSync(FACTS_PATH, `${output}\n`, "utf8");
process.stdout.write(`${output}\n`);
