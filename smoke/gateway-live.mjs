// smoke/gateway-live.mjs — Task G4: gateway 竖切 Live 验收
//
// 用法: node smoke/gateway-live.mjs --check all|streaming,tools,multiturn,subagent,compaction
//
// 把 Phase 0 的五项核心验证（smoke/checks.mjs 原样导出）跑到本地协议网关上：
//   claude-agent-sdk ──ANTHROPIC_BASE_URL──▶ 127.0.0.1:<port> (Leemo gateway)
//                                              └─ OpenAI 协议 ─▶ 用户中转站 (RELAY2_*)
//
// 密钥隔离铁律（本 runner 的核心设计约束）：
//   本进程【绝不】调用 loadEnv()/loadEnvFile()，故 runner 的 process.env 永远不含
//   RELAY2_API_KEY。checks.mjs 的 buildEnv() 会 `...process.env` 展开进 SDK 子进程 env，
//   runner 保持无 key ⇒ SDK 子进程 env 只可能拿到占位 token `leemo-gw:relay2`。
//   真 key 只活在网关子进程内存里（dev.ts 自己 loadEnvFile 读 .env）。
//
// 网关引导 = 子进程方案（option a，见 gw-g4-brief）：因验收命令用纯 node 跑本文件，
//   无法就地用 tsconfig 别名加载 TS 网关源，故 spawn `tsx src/gateway/dev.ts`、
//   解析其 stdout 打印的端口。tsx 直接走 cli.mjs，cwd=仓库根以便 dev.ts 的
//   loadEnvFile() 能读到 .env。
//
// 本文件是新增资产，不改任何既有 smoke/ 文件（checks/lib/providers/smoke-cc-sdk 全禁改）。

import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveResult, redact, buildEnv } from './lib.mjs';
import { checkStreaming, checkTools, checkMultiTurn, checkSubagent, checkCompaction } from './checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const DEV_ENTRY = path.join('src', 'gateway', 'dev.ts');
const PROVIDER_ID = 'relay2';

const CHECKS = {
  streaming: checkStreaming,
  tools: checkTools,
  multiturn: checkMultiTurn,
  subagent: checkSubagent,
  compaction: checkCompaction,
};

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dflt;
}

// 双层脱敏：lib.redact（扫 runner env 里的 *_API_KEY/*_TOKEN，本 runner 无 RELAY2 key
// 故主要靠正则兜底）+ registry.ts 同款 sk-/Bearer 形状正则，用于任何来自网关子进程的输出。
function redactHard(s) {
  let out = redact(String(s));
  out = out.replace(/\b(sk|xai|gsk|glm|Bearer)[-_ ][A-Za-z0-9_\-]{8,}/g, '[REDACTED]');
  return out;
}

// 起网关子进程，解析端口 + provider 列表。dev.ts 打印：
//   [gateway:dev] listening on http://127.0.0.1:<port>
//   [gateway:dev] providers: relay2
function startGatewaySubprocess() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, DEV_ENTRY], {
      cwd: ROOT,
      // 继承 runner 的（无 key）env；dev.ts 会自己 loadEnvFile 把真 key 读进【子进程】内存。
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let port = null;
    let providers = null;
    let settled = false;

    const tryResolve = () => {
      if (settled || port === null || providers === null) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, port, providers, stderrTail: () => redactHard(stderr).slice(-1500) });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`gateway 子进程 90s 内未打印端口；stdout=${redactHard(stdout).slice(-500)} stderr=${redactHard(stderr).slice(-500)}`));
    }, 90_000);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      const mPort = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (mPort) port = Number(mPort[1]);
      const mProv = stdout.match(/providers:\s*(.+)/);
      if (mProv) {
        const list = mProv[1].trim();
        providers = list === '(none)' ? [] : list.split(',').map((s) => s.trim());
      }
      tryResolve();
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`gateway 子进程提前退出 code=${code}；stderr=${redactHard(stderr).slice(-800)}`));
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

// 干净地关掉网关子进程（含 tsx 可能派生的子孙进程）。Windows 用 taskkill /T /F。
function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* best-effort */ }
}

async function main() {
  const checkArg = arg('check', 'all');
  const checkNames = checkArg === 'all' ? Object.keys(CHECKS) : String(checkArg).split(',');

  console.log('[gw-live] starting gateway subprocess (tsx src/gateway/dev.ts)…');
  const gw = await startGatewaySubprocess();
  console.log(`[gw-live] gateway up on 127.0.0.1:${gw.port}, providers=[${gw.providers.join(', ')}]`);

  try {
    if (!gw.providers.includes(PROVIDER_ID)) {
      throw new Error(
        `网关未注册 provider '${PROVIDER_ID}'（providers=[${gw.providers.join(', ')}]）——` +
        `RELAY2_* 未在 .env 配置。这是控制方/用户侧问题：BLOCKED。`
      );
    }

    const base = `http://127.0.0.1:${gw.port}`;

    // /health + /v1/models 双探：确认网关活着，并拿 claude- 伪装模型名当 ANTHROPIC_MODEL。
    // /v1/models 不需要 token（server.ts handleModels 无鉴权）；网关按【token】解析 provider
    // 并把上游 model 强制覆盖成真 RELAY2_MODEL，故 SDK 侧用伪装名/真名皆可。
    const health = await (await fetch(`${base}/health`)).json();
    const modelsJson = await (await fetch(`${base}/v1/models`)).json();
    const disguisedModel = modelsJson?.data?.[0]?.id;
    if (!disguisedModel) throw new Error(`/v1/models 未返回模型（health=${JSON.stringify(health)}）`);

    // provider 形状对齐 smoke/providers.mjs 的 resolveProvider 产物：
    //   id / name / baseUrl / apiKey / model —— 供 checks.mjs 的 buildEnv 消费。
    // apiKey = 占位 token（绝非真 key）；baseUrl 指向网关。
    const provider = {
      id: PROVIDER_ID,
      name: 'Relay2 (via Leemo gateway)',
      baseUrl: base,
      apiKey: `leemo-gw:${PROVIDER_ID}`,
      model: disguisedModel,
    };

    // ── 密钥隔离证据：dump 出 checks.mjs 会实际下发给 SDK 子进程的 env（buildEnv 产物）──
    const childEnv = buildEnv(provider);
    const isolation = {
      ANTHROPIC_BASE_URL: childEnv.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: childEnv.ANTHROPIC_AUTH_TOKEN,        // 期望 leemo-gw:relay2
      ANTHROPIC_API_KEY_isEmpty: childEnv.ANTHROPIC_API_KEY === '',
      ANTHROPIC_MODEL: childEnv.ANTHROPIC_MODEL,
      childEnv_has_RELAY2_API_KEY: Boolean(childEnv.RELAY2_API_KEY), // 期望 false
      childEnv_has_RELAY2_BASE_URL: Boolean(childEnv.RELAY2_BASE_URL),
      childEnv_keyShapedValues: Object.entries(childEnv)
        .filter(([, v]) => typeof v === 'string' && /^(sk|xai|gsk|glm)[-_]|^Bearer /.test(v))
        .map(([k]) => k), // 期望 []（占位 token 不匹配 sk-/Bearer 形状）
      runner_process_env_has_RELAY2_API_KEY: Boolean(process.env.RELAY2_API_KEY), // 期望 false
    };
    console.log('[gw-live] key-isolation:', JSON.stringify(isolation));

    const run = {
      mode: 'gateway-live',
      provider: PROVIDER_ID,
      via: 'Leemo local protocol gateway → OpenAI-protocol relay (RELAY2_*)',
      gatewayBase: base,
      sdkModel: disguisedModel,
      health,
      isolation,
      startedAt: new Date().toISOString(),
      checks: [],
    };

    for (const name of checkNames) {
      if (!CHECKS[name]) { console.error(`[skip] 未知 check: ${name}（可选: ${Object.keys(CHECKS).join('/')}）`); continue; }
      console.log(`\n--- check: ${name} ---`);
      const t0 = Date.now();
      try {
        const r = await CHECKS[name](provider);
        r.ms = Date.now() - t0;
        run.checks.push(r);
        console.log(`${r.pass ? 'PASS' : 'FAIL'} (${r.ms}ms)`, redactHard(JSON.stringify(r.details)).slice(0, 400));
      } catch (e) {
        run.checks.push({ check: name, pass: false, error: redactHard(String(e)), ms: Date.now() - t0 });
        console.log('ERROR: ' + redactHard(String(e)));
      }
    }

    run.finishedAt = new Date().toISOString();
    const file = saveResult(`gateway-${PROVIDER_ID}`, run);
    const passed = run.checks.filter((c) => c.pass).length;
    console.log(`\n[gw-live] ${passed}/${run.checks.length} checks pass → ${file}`);
  } finally {
    stopGateway(gw.child);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[gw-live] fatal: ' + redactHard(e instanceof Error ? e.stack || e.message : String(e)));
    process.exit(1);
  });
