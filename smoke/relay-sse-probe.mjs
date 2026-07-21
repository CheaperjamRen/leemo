// smoke/relay-sse-probe.mjs — Task B0 Step 1: relay 原始 SSE usage 帧诊断
//
// 目的（终审判定的决定性首查）：直打 RELAY2 的 OpenAI 协议端点，stream:true，
// 抓【上游原始 SSE 帧序列】，回答唯一分支问题：
//   上游到底有没有携带 usage 的 data 帧？（有→网关透传问题；无→本地 count_tokens 回填）
// 并顺带回答工程细节：usage 帧与 finish_reason 是否落在【同一次网络读】
//   ——这决定 vendor 状态机（finish_reason 处 break 内层循环）能否观察到它。
//
// 两次请求，一趟跑完（brief 允许 two requests in one run）：
//   A) body 带 stream_options.include_usage:true
//   B) body 不带 stream_options
// 各自 dump 帧结构到 smoke/results/（redact），对照差异。
//
// 密钥/内容纪律：
//   - 只记录每个 data 对象的【结构】（key 名、usage 数值、finish_reason、choices 长度），
//     绝不落 delta.content 文本；redact() 兜底扫 RELAY2_API_KEY。
//   - 这是新增 smoke 文件，不改任何既有 smoke/。
//
// 网络：niubiapi 拦裸 Node fetch（Cloudflare），需 VPN 三件套：
//   NODE_USE_ENV_PROXY=1 + https_proxy=http://127.0.0.1:10801 +
//   http_proxy=http://127.0.0.1:10801 + no_proxy=127.0.0.1,localhost
//   Node 24 全局 fetch 在 NODE_USE_ENV_PROXY=1 时读取 https_proxy。403 = 没设代理。
//
// 用法: node smoke/relay-sse-probe.mjs

import { loadEnv, redact, saveResult } from './lib.mjs';

loadEnv(); // 读 .env 到 process.env（RELAY2_*）；redact() 据此脱敏

const BASE = process.env.RELAY2_BASE_URL?.trim();
const KEY = process.env.RELAY2_API_KEY?.trim();
const MODEL = process.env.RELAY2_MODEL?.trim();

function redactHard(s) {
  let out = redact(String(s));
  out = out.replace(/\b(sk|xai|gsk|glm|Bearer)[-_ ][A-Za-z0-9_\-]{8,}/g, '[REDACTED]');
  return out;
}

// 从一个 OpenAI SSE data 对象抽取【结构指纹】——无内容文本。
function fingerprint(obj) {
  if (obj === '[DONE]') return { done: true };
  const fp = {
    topKeys: Object.keys(obj).sort(),
    hasUsage: obj.usage != null,
    choicesLen: Array.isArray(obj.choices) ? obj.choices.length : null,
  };
  if (obj.usage != null) {
    // usage 数值是 token 计数，非内容，安全记录
    fp.usage = {
      prompt_tokens: obj.usage.prompt_tokens ?? null,
      completion_tokens: obj.usage.completion_tokens ?? null,
      total_tokens: obj.usage.total_tokens ?? null,
      cached_tokens: obj.usage.prompt_tokens_details?.cached_tokens ?? null,
    };
  }
  const ch = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
  if (ch) {
    fp.finish_reason = ch.finish_reason ?? null;
    // delta 只记录出现了哪些 key（role/content/tool_calls…），不记内容值
    if (ch.delta && typeof ch.delta === 'object') fp.deltaKeys = Object.keys(ch.delta).sort();
  }
  return fp;
}

// 拉一趟流式请求，逐【网络读】分组记录帧，回答"usage 与 finish_reason 是否同读到达"。
async function probe(label, includeUsage) {
  const url = `${BASE.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: MODEL,
    stream: true,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: momo-usage-probe. Nothing else.' }],
  };
  if (includeUsage) body.stream_options = { include_usage: true };

  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  const result = {
    label,
    includeUsageSent: Boolean(includeUsage),
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get('content-type'),
    reads: [],          // 每次网络读一组：[{readIndex, frames:[fingerprint...]}]
    frames: [],         // 扁平帧指纹序列
    usageFrameCount: 0,
    finishReasonReadIndex: null,
    usageReadIndex: null,
    usageSameReadAsFinish: null,
    ms: null,
  };

  if (!resp.ok) {
    let bodyText = '';
    try { bodyText = await resp.text(); } catch {}
    result.errorBodySnippet = redactHard(bodyText).slice(0, 300);
    result.ms = Date.now() - t0;
    return result;
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let readIndex = -1;

  const parseFrames = (chunkText) => {
    buf += chunkText;
    const out = [];
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        const payload = m[1].trim();
        if (!payload) continue;
        if (payload === '[DONE]') { out.push('[DONE]'); continue; }
        try { out.push(JSON.parse(payload)); } catch { out.push({ __unparsed: true }); }
      }
    }
    return out;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    readIndex++;
    const objs = parseFrames(dec.decode(value, { stream: true }));
    if (!objs.length) continue;
    const fps = objs.map((o) => (o === '[DONE]' ? { done: true } : fingerprint(o)));
    result.reads.push({ readIndex, frames: fps });
    for (const fp of fps) {
      result.frames.push({ readIndex, ...fp });
      if (fp.hasUsage) {
        result.usageFrameCount++;
        if (result.usageReadIndex === null) result.usageReadIndex = readIndex;
      }
      if (fp.finish_reason && result.finishReasonReadIndex === null) {
        result.finishReasonReadIndex = readIndex;
      }
    }
  }
  result.ms = Date.now() - t0;
  if (result.usageReadIndex !== null && result.finishReasonReadIndex !== null) {
    result.usageSameReadAsFinish = result.usageReadIndex === result.finishReasonReadIndex;
  }
  return result;
}

async function main() {
  const missing = [];
  if (!BASE) missing.push('RELAY2_BASE_URL');
  if (!KEY) missing.push('RELAY2_API_KEY');
  if (!MODEL) missing.push('RELAY2_MODEL');
  if (missing.length) {
    console.error(`[probe] BLOCKED: .env 缺 ${missing.join(', ')}`);
    process.exit(2);
  }

  console.log(`[probe] target=${BASE} model=${MODEL} proxy=${process.env.https_proxy || '(none)'}`);
  console.log(`[probe] NODE_USE_ENV_PROXY=${process.env.NODE_USE_ENV_PROXY || '(unset)'}`);

  const runs = [];
  // A: with stream_options.include_usage — the branch question
  console.log('\n[probe] --- A: stream_options.include_usage=true ---');
  let A;
  try {
    A = await probe('with_include_usage', true);
  } catch (e) {
    // one retry only if transport failed (per brief)
    console.error('[probe] A transport error, one retry: ' + redactHard(String(e)));
    A = await probe('with_include_usage', true);
  }
  runs.push(A);
  console.log(`[probe] A status=${A.status} frames=${A.frames.length} usageFrames=${A.usageFrameCount} usageSameReadAsFinish=${A.usageSameReadAsFinish}`);

  // B: without stream_options — control
  console.log('\n[probe] --- B: NO stream_options ---');
  let B;
  try {
    B = await probe('no_stream_options', false);
  } catch (e) {
    console.error('[probe] B transport error: ' + redactHard(String(e)));
    B = { label: 'no_stream_options', error: redactHard(String(e)) };
  }
  runs.push(B);
  console.log(`[probe] B status=${B.status} frames=${B.frames?.length ?? 'n/a'} usageFrames=${B.usageFrameCount ?? 'n/a'}`);

  const verdict = {
    question: 'Does the relay emit any usage-bearing SSE frame when stream_options.include_usage is sent?',
    with_include_usage_hasUsageFrame: (A.usageFrameCount ?? 0) > 0,
    without_stream_options_hasUsageFrame: (B.usageFrameCount ?? 0) > 0,
    usageSameReadAsFinish_A: A.usageSameReadAsFinish,
    branch:
      (A.usageFrameCount ?? 0) > 0
        ? 'UPSTREAM-HAS-USAGE → passthrough path (fix vendor 0 / accumulation if needed)'
        : 'UPSTREAM-NO-USAGE → local o200k backfill path',
  };
  console.log('\n[probe] VERDICT:', JSON.stringify(verdict, null, 2));

  const out = {
    mode: 'relay-sse-probe',
    target: BASE,
    model: MODEL,
    at: new Date().toISOString(),
    verdict,
    runs,
  };
  const file = saveResult('relay-sse-probe', out);
  console.log(`\n[probe] saved → ${file}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[probe] fatal: ' + redactHard(e instanceof Error ? e.stack || e.message : String(e)));
  process.exit(1);
});
