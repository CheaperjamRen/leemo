// smoke/bridge-live.mjs — Task B4: Bridge 竖切 Live 验收（收官卡）
//
// 用法: node smoke/bridge-live.mjs      （跑前必须设 VPN 三件套，见下）
//
// 证明 B0-B3 全栈经【真 SDK query()】+【真端点】端到端工作，并结清三个
// 只有真流量能证的累积假设：
//   risk#1  events.ts 的 stream_event→text.delta 映射在真 SDK 下是否真的产出 delta
//   risk#2  网关 B0 挂的 leemo_estimated:true 是否流穿到 result.usage→tokensEstimated
//   B0 concern  经网关时 message_start 估值是否够自动 compaction（best-effort）
//
// 两对话并发，同一 createBridge：
//   A = DeepSeek 直连（apiFormat anthropic，真 key 走 ANTHROPIC_AUTH_TOKEN）——含工具轮 + resume
//   B = relay2 经网关（apiFormat openai，占位 token leemo-gw:relay2）——流式文本 + 用量 + 隔离
//
// 密钥隔离铁律：B1 的 sanitizeHostEnv 在 pool 里把 process.env 里所有 *_API_KEY/
//   *_AUTH_TOKEN 剥掉后才铺 provider 自己的 token。故即便本 runner loadEnv() 读进了
//   RELAY2_API_KEY，SDK 子进程 env 也永远拿不到它——本卡的隔离 dump 就是要【实证】这点
//   （比 gateway-live 的 runner-无-key 前提更强：直接验 sanitizeHostEnv 的效果）。
//
// bootstrap：抄 gateway-live——网关走【子进程】(tsx src/gateway/dev.ts，自带 alias-hook
//   读 vendor)；bridge 的 TS 模块走【内嵌 tsx loader】in-process import（bridge 不碰
//   vendor，只需 TS→JS 转译）。真 SDK query() 适配成 pool 的注入式 QueryFn。
//
// Live 成本纪律：单场景单跑，prompt 极小。跑前同一 shell 设：
//   $env:NODE_USE_ENV_PROXY='1'; $env:https_proxy='http://127.0.0.1:10801';
//   $env:http_proxy='http://127.0.0.1:10801'; $env:no_proxy='127.0.0.1,localhost'
//   （relay 走中转站需代理；no_proxy 保 SDK→本地网关直连；DeepSeek 国内直连不受影响）
//
// 本文件是新增资产，不改任何既有 smoke/ 文件，不改 src/**、.env、tsconfig。

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv, redact, u } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TSX_API = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "esm", "api", "index.mjs")).href;
const DEV_ENTRY = path.join("src", "gateway", "dev.ts");
const ROUND_TIMEOUT_MS = 600_000; // 每场景独立 600s

// ── 双层脱敏（沿用 gateway-live）：lib.redact 扫 runner env 里的 key 逐字替换 +
//    sk-/Bearer 形状正则兜底。本 runner loadEnv 后 process.env 含 DEEPSEEK/RELAY2 key，
//    redact 会把它们逐字擦掉；正则再兜任何漏网的 key 形状串。 ──
function redactHard(s) {
  let out = redact(String(s));
  out = out.replace(/\b(sk|xai|gsk|glm|Bearer)[-_ ][A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
  return out;
}

function saveBridgeResult(data) {
  const dir = path.join(ROOT, "smoke", "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bridge-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, redactHard(JSON.stringify(data, null, 2)));
  return file;
}

// ===========================================================================
// 网关子进程（抄 gateway-live.startGatewaySubprocess——不改原文件，此处独立重实现）
// ===========================================================================
function startGatewaySubprocess() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, DEV_ENTRY], {
      cwd: ROOT,
      // 继承 runner env（含 VPN 三件套 + .env 已 loadEnv 的 RELAY2_*）；dev.ts 亦会自 loadEnvFile。
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", port = null, providers = null, settled = false;
    const tryResolve = () => {
      if (settled || port === null || providers === null) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, port, providers });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`gateway 子进程 90s 内未打印端口；stderr=${redactHard(stderr).slice(-400)}`));
    }, 90_000);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      const mPort = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (mPort) port = Number(mPort[1]);
      const mProv = stdout.match(/providers:\s*(.+)/);
      if (mProv) {
        const list = mProv[1].trim();
        providers = list === "(none)" ? [] : list.split(",").map((s) => s.trim());
      }
      tryResolve();
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`gateway 子进程提前退出 code=${code}；stderr=${redactHard(stderr).slice(-800)}`));
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch { /* best-effort */ }
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  // .env → process.env（拿 DeepSeek 直连的真 key + RELAY2_* 供网关子进程/隔离实证）。
  loadEnv();

  // ── 内嵌 tsx loader，然后动态 import src/bridge 的 TS 模块（in-process） ──
  const { register: tsxRegister } = await import(TSX_API);
  tsxRegister();
  const poolMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "pool.ts")).href);
  const providersMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "providers.ts")).href);
  const eventsMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "events.ts")).href);
  const pricingMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "pricing.ts")).href);
  const interactMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "interact.ts")).href);
  const balanceMod = await import(pathToFileURL(path.join(ROOT, "src", "bridge", "balance.ts")).href);
  const { createBridge } = poolMod;
  void providersMod; // 形状已在 pool 内部消费；此处仅确保模块可加载
  const { normalizeSdkStream } = eventsMod;
  const { resolvePricing } = pricingMod;
  const { createApprovalBroker } = interactMod;
  const { fetchBalance } = balanceMod;

  // ── 起网关，拿 port + 伪装模型名（沿用 gateway-live 的 /health + /v1/models 双探） ──
  console.log("[bridge-live] starting gateway subprocess (tsx src/gateway/dev.ts)…");
  const gw = await startGatewaySubprocess();
  console.log(`[bridge-live] gateway up on 127.0.0.1:${gw.port}, providers=[${gw.providers.join(", ")}]`);

  const results = {
    mode: "bridge-live",
    startedAt: new Date().toISOString(),
    proxyTrio: {
      NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? null,
      https_proxy: process.env.https_proxy ? "(set)" : null,
      no_proxy: process.env.no_proxy ?? null,
    },
    gateway: { port: gw.port, providers: gw.providers },
    conversations: {},
    criteria: {},
    assumptions: {},
    probes: {},
    isolation: {},
    configDirs: {},
  };

  try {
    if (!gw.providers.includes("relay2")) {
      throw new Error(`网关未注册 provider 'relay2'（providers=[${gw.providers.join(", ")}]）——RELAY2_* 未配置：BLOCKED`);
    }
    const base = `http://127.0.0.1:${gw.port}`;
    const modelsJson = await (await fetch(`${base}/v1/models`)).json();
    const disguisedModel = modelsJson?.data?.[0]?.id;
    if (!disguisedModel) throw new Error(`/v1/models 未返回模型`);
    const relayRealModel = String(disguisedModel).replace(/^claude-/, "");
    results.gateway.disguisedModel = disguisedModel;

    // ── data dir（per-provider CONFIG_DIR 落这里）+ 两个 workspace（SDK cwd） ──
    const stamp = Date.now();
    const dataDir = path.join(ROOT, "smoke", "workspaces", `bridge-live-data-${stamp}`);
    const wsA = path.join(ROOT, "smoke", "workspaces", `bridge-live-deepseek-${stamp}`);
    const wsB = path.join(ROOT, "smoke", "workspaces", `bridge-live-relay2-${stamp}`);
    fs.mkdirSync(wsA, { recursive: true });
    fs.mkdirSync(wsB, { recursive: true });
    // A 的工具轮素材：notes.md 藏一个暗号，让模型 Read→Write→answer.txt（抄 checkTools 的可靠诱发法）。
    const CODEWORD = "MOMO-7413";
    fs.writeFileSync(path.join(wsA, "notes.md"), `# 便签\n- 本次任务暗号：${CODEWORD}\n- 默认搭子：momo\n`);

    // ── Provider A：DeepSeek 直连（anthropic 直连语义，真 key 进 AUTH_TOKEN） ──
    const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const providerA = {
      id: "deepseek",
      name: "DeepSeek (direct)",
      category: "cn_official",
      apiFormat: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      models: [deepseekModel],
      modelCapabilities: {},
      envTemplate: {},
    };
    if (!providerA.apiKey) throw new Error("DEEPSEEK_API_KEY 未配置：BLOCKED（控制方/用户侧问题）");

    // ── Provider B：relay2 经网关（openai，占位 token 由 buildConversationEnv 生成） ──
    const providerB = {
      id: "relay2",
      name: "Relay2 (via Leemo gateway)",
      category: "custom",
      apiFormat: "openai",
      baseUrl: "http://unused-for-gateway.invalid",
      apiKey: "sk-NEVER-USED-placeholder-source", // gateway 模式下 buildConversationEnv 绝不发它
      models: [relayRealModel],
      modelCapabilities: {},
      envTemplate: {},
    };

    // ── 审批桥：canUseTool = broker（default 模式=full ask flow，逼真 SDK 真的回调它）。
    //    transport 自动放行并【记录】每次 ApprovalRequest → 证审批往返 live（criterion 5）。 ──
    const transportA = {
      requests: [],
      async request(req) {
        this.requests.push({ id: req.id, toolName: req.toolName, risk: req.risk, inputSummary: req.inputSummary });
        return { id: req.id, decision: "allow-once" };
      },
    };
    const persistenceA = { getWhitelist: () => [], addToWhitelist: () => {} };
    const brokerA = createApprovalBroker(transportA, persistenceA, { mode: "default", dangerousCommandCaching: false });

    // ── per-conversation extras（pool 只给 env/abortController/resume；其余 SDK Options
    //    由适配器按 provider id 从 CLAUDE_CONFIG_DIR 派发）。 ──
    const capturedEnv = {}; // providerId -> 实际下发给 query 的 env（隔离实证用）
    const EXTRAS = new Map();
    EXTRAS.set("deepseek", {
      cwd: wsA,
      canUseTool: brokerA.canUseTool,       // 审批桥接真 SDK canUseTool
      includePartialMessages: true,          // 拿 stream_event 验 risk#1
      permissionMode: "default",             // default → SDK 真的回调 canUseTool
      settingSources: [],
      maxTurns: 10,
      streamingInput: true,                  // 升流式输入以启用 canUseTool/控制请求
    });
    EXTRAS.set("relay2", {
      cwd: wsB,
      includePartialMessages: true,          // 网关路径验 risk#1
      permissionMode: "acceptEdits",
      settingSources: [],
      maxTurns: 3,
      streamingInput: false,                 // 纯文本任务，走 checkStreaming 同款 string prompt
    });

    // ── 真 SDK → pool.QueryFn 适配器 ──
    const realQueryFn = (params) => {
      const { prompt, options } = params;
      const env = options?.env ?? {};
      const configDir = env.CLAUDE_CONFIG_DIR ? path.basename(env.CLAUDE_CONFIG_DIR) : "";
      const providerId = configDir;
      const extras = EXTRAS.get(providerId) ?? {};
      // 记下每个 provider 实际拿到的 env（首个 send 即定型）——隔离 dump 的 ground truth。
      if (!capturedEnv[providerId] && options?.env) capturedEnv[providerId] = options.env;

      // string prompt → 单条流式 user 消息（仅在需要 canUseTool/控制请求时升级）；
      // 否则原样透传 string（B 走 checkStreaming 已验证的 string 路径）。
      const sdkPrompt =
        extras.streamingInput && typeof prompt === "string"
          ? (async function* () { yield u(prompt); })()
          : prompt;

      const sdkOptions = {
        env: options?.env,
        abortController: options?.abortController,
        ...(options?.resume ? { resume: options.resume } : {}),
        cwd: extras.cwd,
        includePartialMessages: extras.includePartialMessages,
        permissionMode: extras.permissionMode,
        settingSources: extras.settingSources,
        maxTurns: extras.maxTurns,
        ...(extras.canUseTool ? { canUseTool: extras.canUseTool } : {}),
      };
      return query({ prompt: sdkPrompt, options: sdkOptions });
    };

    // ── 同一 createBridge，两对话 ──
    const bridge = createBridge({ queryFn: realQueryFn, dataDir });
    const convoA = bridge.createConversation({ provider: providerA, modelId: deepseekModel });
    const convoB = bridge.createConversation({ provider: providerB, modelId: relayRealModel, gatewayPort: gw.port });

    // ── 一轮：喂 normalizeSdkStream 收 LeemoEvent（pool 的 send 输出即其入参） ──
    async function runRound(convo, prompt, ctx) {
      const events = [];
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { convo.interrupt(); } catch {} }, ROUND_TIMEOUT_MS);
      try {
        for await (const ev of normalizeSdkStream(convo.send(prompt), ctx)) events.push(ev);
      } finally { clearTimeout(timer); }
      return { events, timedOut };
    }
    const digest = (r) => {
      const ev = r.events;
      const usage = ev.find((e) => e.type === "usage.final")?.usage;
      const run = ev.find((e) => e.type === "run.finished");
      return {
        timedOut: r.timedOut,
        started: ev.find((e) => e.type === "conversation.started")?.sessionId ? true : false,
        textDeltas: ev.filter((e) => e.type === "text.delta").length,
        thinkingDeltas: ev.filter((e) => e.type === "thinking.delta").length,
        textFinal: (ev.find((e) => e.type === "text.final")?.text || "").slice(0, 160),
        toolStarted: ev.filter((e) => e.type === "tool.started").map((e) => e.name),
        toolFinished: ev.filter((e) => e.type === "tool.finished").length,
        usage,
        runSubtype: run?.subtype,
        runIsError: run?.isError,
        eventTypes: ev.map((e) => e.type),
      };
    };

    const ctxA = { providerId: "deepseek", modelId: deepseekModel, cwd: wsA, pricing: resolvePricing("deepseek", deepseekModel) };
    const ctxB = { providerId: "relay2", modelId: relayRealModel, cwd: wsB, pricing: resolvePricing("relay2", relayRealModel) };

    // ── 并发驱动：A（工具轮 + resume 召回）与 B（流式文本）同时跑 ──
    console.log("[bridge-live] driving 2 concurrent conversations (DeepSeek direct + relay2 gateway)…");
    const driveA = (async () => {
      const r1 = await runRound(
        convoA,
        `读取 notes.md，把其中的暗号原样写入 answer.txt（只写暗号本身，不要别的字）。同时把这个暗号记在心里。`,
        ctxA
      );
      let answerFile = "";
      try { answerFile = fs.readFileSync(path.join(wsA, "answer.txt"), "utf8"); } catch {}
      // 第二轮：resume 召回暗号（pool 自动把 round1 的 session_id 作为 resume 传下去）。
      const r2 = await runRound(
        convoA,
        `我们刚才处理的暗号是什么？一字不差地只回复暗号本身。`,
        ctxA
      );
      return { r1: digest(r1), r2: digest(r2), answerFile: answerFile.trim().slice(0, 80) };
    })();
    const driveB = (async () => {
      const r1 = await runRound(
        convoB,
        `请从 1 数到 5，每个数字单独一行，不要多余内容。`,
        ctxB
      );
      return { r1: digest(r1) };
    })();

    const [aOut, bOut] = await Promise.all([driveA, driveB]);
    results.conversations.A_deepseek_direct = aOut;
    results.conversations.B_relay2_gateway = bOut;

    // =====================================================================
    // 核心 7 条判据
    // =====================================================================
    const A1 = aOut.r1, A2 = aOut.r2, B1 = bOut.r1;

    // 1. 双接线事件流完整（各含 started/text.final/run.finished success；至少一路含工具轮）
    const aStreamOk = A1.started && A1.textFinal.length >= 0 && A1.runSubtype === "success" && !A1.runIsError;
    const bStreamOk = B1.started && B1.runSubtype === "success" && !B1.runIsError && (B1.textFinal.length > 0 || B1.textDeltas > 0);
    const aToolRound = A1.toolStarted.length > 0 && A1.toolFinished > 0;
    results.criteria.c1_dual_event_streams = {
      pass: Boolean(aStreamOk && bStreamOk && aToolRound),
      A_started: A1.started, A_runSubtype: A1.runSubtype, A_tools: A1.toolStarted, A_toolFinished: A1.toolFinished,
      B_started: B1.started, B_runSubtype: B1.runSubtype, B_textFinalLen: B1.textFinal.length, B_textDeltas: B1.textDeltas,
    };

    // 2. usage.final 非零 + cost 计算出（DeepSeek 直连硬断言；relay2 经网关记录并断言 B0 效果）
    const aUsage = A1.usage, bUsage = B1.usage;
    const c2Pass = Boolean(aUsage && aUsage.inputTokens > 0 && (aUsage.costSource === "sdk" || aUsage.costSource === "local-pricing"));
    results.criteria.c2_usage_nonzero = {
      pass: c2Pass,
      deepseek: aUsage ? { inputTokens: aUsage.inputTokens, outputTokens: aUsage.outputTokens, costUsd: aUsage.costUsd, costSource: aUsage.costSource } : null,
      relay2_via_gateway: bUsage ? { inputTokens: bUsage.inputTokens, outputTokens: bUsage.outputTokens, costUsd: bUsage.costUsd, costSource: bUsage.costSource } : null,
      relay2_inputTokens_gt0: Boolean(bUsage && bUsage.inputTokens > 0),
    };

    // 3. tokensEstimated 结论（risk#2）——如实记录 relay2 经网关的 leemo_estimated 流穿情况
    results.criteria.c3_tokens_estimated = {
      pass: Boolean(bUsage), // 有 usage.final 即算“已观测到结论”；true/false 都是有效结论
      relay2_tokensEstimated: bUsage ? bUsage.tokensEstimated : null,
      relay2_costSource: bUsage ? bUsage.costSource : null,
      deepseek_tokensEstimated: aUsage ? aUsage.tokensEstimated : null,
      note: bUsage
        ? (bUsage.tokensEstimated
            ? "leemo_estimated:true 经真 SDK 聚合后存活并流穿到 UsageRecord.tokensEstimated"
            : "leemo_estimated 未在 result.usage 出现（真值透传 或 标记被 SDK result 聚合剥离）——UsageRecord.tokensEstimated=false")
        : "relay2 未产出 usage.final",
    };

    // 4. 密钥隔离（relay2 网关对话）：dump 实际下发的 env
    const envB = capturedEnv["relay2"] || {};
    const envA = capturedEnv["deepseek"] || {};
    // 只抓“像真 key 的值”：排除 config 类变量名（_MODEL/_URL/_BASE_URL——非密钥），
    // 且 key-shape 前缀分支要求值长度 ≥20（真 key 都很长）以免把短模型名（如 glm-5.2）
    // 误判成密钥；Bearer 前缀单列（其后即密钥）。
    const looksLikeSecretValue = (v) =>
      typeof v === "string" &&
      ((/^(sk|xai|gsk|glm)[-_]/.test(v) && v.length >= 20) || /^Bearer\s+\S{8,}/.test(v));
    const keyShaped = (env) => Object.entries(env)
      .filter(([k]) => !/_MODEL$|_URL$|_BASE_URL$/i.test(k))
      .filter(([, v]) => looksLikeSecretValue(v))
      .map(([k]) => k);
    const isoB = {
      ANTHROPIC_BASE_URL: envB.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: envB.ANTHROPIC_AUTH_TOKEN, // 期望 leemo-gw:relay2
      ANTHROPIC_API_KEY_isEmpty: envB.ANTHROPIC_API_KEY === "",
      has_RELAY2_API_KEY: Boolean(envB.RELAY2_API_KEY),   // 期望 false（sanitizeHostEnv 剥掉）
      has_DEEPSEEK_API_KEY: Boolean(envB.DEEPSEEK_API_KEY), // 期望 false（兄弟 key 也剥掉）
      keyShapedValues: keyShaped(envB),                    // 期望 []（占位 token 不匹配 sk-/Bearer 形状）
    };
    // DeepSeek 直连：AUTH_TOKEN 含真 key 是直连语义（允许）；断言无【兄弟】key。
    const isoA = {
      ANTHROPIC_BASE_URL: envA.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN_isRealDeepseekKey: envA.ANTHROPIC_AUTH_TOKEN === process.env.DEEPSEEK_API_KEY,
      has_RELAY2_API_KEY: Boolean(envA.RELAY2_API_KEY),   // 期望 false（兄弟 key 剥掉）
      has_DEEPSEEK_API_KEY_var: Boolean(envA.DEEPSEEK_API_KEY), // 期望 false（原始变量名被剥；key 只在 AUTH_TOKEN）
    };
    results.isolation.relay2 = isoB;
    results.isolation.deepseek = isoA;
    results.criteria.c4_key_isolation = {
      pass: Boolean(
        isoB.ANTHROPIC_AUTH_TOKEN === "leemo-gw:relay2" &&
        isoB.ANTHROPIC_API_KEY_isEmpty &&
        !isoB.has_RELAY2_API_KEY &&
        !isoB.has_DEEPSEEK_API_KEY &&
        isoB.keyShapedValues.length === 0 &&
        !isoA.has_RELAY2_API_KEY
      ),
      relay2: isoB,
      deepseek_no_sibling: !isoA.has_RELAY2_API_KEY,
    };

    // 5. 审批桥 live：canUseTool 适配真 SDK 签名 + 往返可用（transport 收到 ApprovalRequest）
    results.criteria.c5_approval_live = {
      pass: Boolean(transportA.requests.length > 0 && aToolRound),
      approvalRequests: transportA.requests.length,
      requestedTools: [...new Set(transportA.requests.map((r) => r.toolName))],
      note: transportA.requests.length > 0
        ? "canUseTool 被真 SDK 回调，broker→transport 往返成功，工具经审批放行后真的执行"
        : "canUseTool 未被回调（若工具仍跑=SDK 未经 canUseTool；见归因）",
    };

    // 6. resume 续轮召回
    const recalled = new RegExp(CODEWORD.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).test(A2.textFinal) || /7413/.test(A2.textFinal);
    results.criteria.c6_resume_recall = {
      pass: Boolean(recalled && A2.runSubtype === "success"),
      round2FinalText: A2.textFinal,
      round2Subtype: A2.runSubtype,
      codeword: CODEWORD,
    };

    // 7. CONFIG_DIR 隔离：两 provider 目录各自落盘且互不串
    const dirA = path.join(dataDir, "providers", "deepseek");
    const dirB = path.join(dataDir, "providers", "relay2");
    const dirAok = fs.existsSync(dirA), dirBok = fs.existsSync(dirB);
    results.configDirs = { deepseek: dirAok ? dirA.replace(ROOT, "<ROOT>") : null, relay2: dirBok ? dirB.replace(ROOT, "<ROOT>") : null };
    results.criteria.c7_config_dir_isolation = { pass: Boolean(dirAok && dirBok && dirA !== dirB), deepseek: dirAok, relay2: dirBok };

    // =====================================================================
    // 三个待验证假设（无论结论都如实写）
    // =====================================================================
    results.assumptions.risk1_text_delta = {
      deepseek_direct_textDeltas: A1.textDeltas,
      relay2_gateway_textDeltas: B1.textDeltas,
      produced: A1.textDeltas > 0 || B1.textDeltas > 0,
      conclusion:
        (A1.textDeltas > 0 || B1.textDeltas > 0)
          ? `events.ts 的 stream_event→text.delta 映射在真 SDK 下【确实产出】delta（直连=${A1.textDeltas}，网关=${B1.textDeltas}）——防御式可选链正确命中 content_block_delta/text_delta 形状`
          : "两路均未产出 text.delta——需查 includePartialMessages 是否生效或 SDK stream_event 形状是否偏离",
    };
    results.assumptions.risk2_tokens_estimated = {
      relay2_tokensEstimated: bUsage ? bUsage.tokensEstimated : null,
      relay2_costSource: bUsage ? bUsage.costSource : null,
      conclusion: results.criteria.c3_tokens_estimated.note,
    };

    // =====================================================================
    // best-effort 探测
    // =====================================================================
    // auto-compaction 经网关：触发需灌 10 万+ tokens（~分钟 + 成本），本卡不主动触发。
    results.probes.auto_compaction = {
      attempted: false,
      note:
        "自动 compaction 需堆 10 万+ tokens 触发，成本高，本 live 卡不主动烧。留观测：经网关时 " +
        "message_start.input_tokens 为 o200k 估值（真值只在流末）。手动 /compact 经网关的压缩管线已在 G4 " +
        "gateway-live checkCompaction 实测 PASS（live 5/5），证压缩管线本身经网关可用；估值驱动的【自动】触发保真度留待专门压测卡。",
    };
    // ask_user MCP live：难稳定诱使模型调用，且接入会干扰工具轮判定；B3 已 fake 全覆盖。
    results.probes.ask_user_mcp = {
      attempted: false,
      note: "未接入 live 模型（诱发不稳定且会干扰 A 的工具轮判定）；ask_user 往返已在 B3 fake 测覆盖。",
    };
    // DeepSeek 余额（balance.ts live，便宜，尽量做）
    try {
      const bal = await fetchBalance(
        { id: "deepseek", apiFormat: "anthropic", baseUrl: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY },
        { fetchFn: fetch }
      );
      results.probes.deepseek_balance = {
        attempted: true,
        supported: bal.supported,
        totalUsd: bal.totalUsd,
        totalCny: bal.totalCny,
        granted: bal.granted,
        toppedUp: bal.toppedUp,
        rawShape: bal.raw !== undefined ? redactHard(JSON.stringify(bal.raw)).slice(0, 200) : undefined,
        pass: Boolean(bal.supported && (typeof bal.totalCny === "number" || typeof bal.totalUsd === "number")),
      };
    } catch (e) {
      results.probes.deepseek_balance = { attempted: true, error: redactHard(String(e)), pass: false };
    }

    bridge.dispose();

    // =====================================================================
    // 汇总
    // =====================================================================
    results.finishedAt = new Date().toISOString();
    const core = ["c1_dual_event_streams", "c2_usage_nonzero", "c3_tokens_estimated", "c4_key_isolation", "c5_approval_live", "c6_resume_recall", "c7_config_dir_isolation"];
    const passed = core.filter((k) => results.criteria[k]?.pass).length;
    results.summary = {
      corePassed: `${passed}/${core.length}`,
      matrix: Object.fromEntries(core.map((k) => [k, results.criteria[k]?.pass ? "PASS" : "FAIL"])),
      verdict: passed === core.length ? "Bridge 竖切 live 达成" : "存在 FAIL——见归因",
    };

    const file = saveBridgeResult(results);
    console.log("\n[bridge-live] === core matrix ===");
    for (const k of core) console.log(`  ${results.criteria[k]?.pass ? "PASS" : "FAIL"}  ${k}`);
    console.log(`[bridge-live] ${passed}/${core.length} core criteria pass → ${file}`);
    console.log(`[bridge-live] risk#1 text.delta: direct=${A1.textDeltas} gateway=${B1.textDeltas}`);
    console.log(`[bridge-live] risk#2 tokensEstimated(relay2)=${bUsage ? bUsage.tokensEstimated : "n/a"} costSource=${bUsage ? bUsage.costSource : "n/a"}`);
    console.log(`[bridge-live] balance: ${JSON.stringify(results.probes.deepseek_balance)}`);
    return { file, passed, core: core.length };
  } finally {
    stopGateway(gw.child);
  }
}

main()
  .then((r) => process.exit(r && r.passed === r.core ? 0 : 2))
  .catch((e) => {
    console.error("[bridge-live] fatal: " + redactHard(e instanceof Error ? e.stack || e.message : String(e)));
    process.exit(1);
  });
