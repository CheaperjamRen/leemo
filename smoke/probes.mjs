// smoke/probes.mjs — Phase 0 四项探测（不卡 PASS 门，只记录事实供后续设计）
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildEnv, newWorkspace } from './lib.mjs';

const PROBE_TIMEOUT_MS = 10 * 60 * 1000; // 与 checks.mjs 同款：网络卡死/权限挂起时 abort，runner 记为 ERROR 而非挂死

function baseOptions(provider, cwd, extra = {}) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(new Error(`probe 超时（${PROBE_TIMEOUT_MS / 60000} 分钟）`)), PROBE_TIMEOUT_MS);
  timer.unref(); // 正常完成后不阻止进程退出
  return {
    cwd,
    env: buildEnv(provider),
    permissionMode: 'acceptEdits',
    settingSources: [],
    maxTurns: 6,
    abortController,
    ...extra,
  };
}

// P1: SDK session resume 在第三方端点下的可靠性（06 号 §六 持久化方案的分叉依据）
export async function probeResume(provider) {
  const cwd = newWorkspace(`${provider.id}-resume`);
  let sessionId = null;
  const q1 = query({ prompt: '记住：我的幸运数字是 7。只回复"好的"。', options: baseOptions(provider, cwd, { maxTurns: 3 }) });
  for await (const m of q1) { if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id; }
  if (!sessionId) return { probe: 'resume', ok: false, details: { error: '未拿到 session_id' } };

  const q2 = query({
    prompt: '我的幸运数字是多少？直接说数字。',
    options: baseOptions(provider, cwd, { maxTurns: 3, resume: sessionId }),
  });
  let text = '';
  for await (const m of q2) { if (m.type === 'result' && m.subtype === 'success') text = m.result || ''; }
  return { probe: 'resume', ok: /7|七/.test(text), details: { sessionId, answer: text.slice(0, 80) } };
}

// P2: AnySearch 国内直连（06 号 §四 联网搜索默认源的可达性）
export async function probeAnySearch() {
  const targets = ['https://www.anysearch.com/', 'https://api.anysearch.com/'];
  const out = [];
  for (const url of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      out.push({ url, status: res.status, ms: Date.now() - t0 });
    } catch (e) { out.push({ url, error: String(e).slice(0, 120), ms: Date.now() - t0 }); }
  }
  return { probe: 'anysearch', ok: out.some(r => typeof r.status === 'number'), details: out };
}

// P3: 用户中转站是否原生提供 Anthropic 协议（决定网关是否必需覆盖它）
export async function probeRelayAnthropic() {
  const base = process.env.RELAY_BASE_URL, key = process.env.RELAY_API_KEY;
  const model = process.env.RELAY_MODEL || 'claude-sonnet-4-6';
  if (!base || !key) return { probe: 'relay-anthropic', ok: null, details: 'RELAY_* 未配置，跳过' };
  const url = base.replace(/\/+$/, '') + '/v1/messages';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: 'user', content: '回复 OK 两个字母即可' }] }),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await res.text()).slice(0, 200);
    return { probe: 'relay-anthropic', ok: res.status === 200, details: { url, status: res.status, body } };
  } catch (e) { return { probe: 'relay-anthropic', ok: false, details: { url, error: String(e).slice(0, 200) } }; }
}

// P4: canUseTool 回调在第三方端点下的行为（审批条 UI 的机制基础）
// permissionMode 'default' 下 Write 需要审批 → 必然经过 canUseTool
// 诊断证据（2026-07-20 DeepSeek 实测，见 task-34 报告）：回调 content 恒为小写 'hello'（大小写非根因）；
//   真正根因是模型把"当前目录"猜成臆造的绝对路径（如 \root\probe.txt、\workspace\probe.txt），
//   Write 落在 options.cwd 之外 → 读死 cwd/probe.txt 得 ENOENT，间歇 fileOk=false。
//   故按回调记录的 file_path 实际去向读取（回退 cwd/probe.txt，再回退列目录），保留 filePath 证据；
//   断言大小写不敏感以增强健壮性。ok 判定仍为 calls.length>0 && fileOk，不放水。
export async function probeCanUseTool(provider) {
  const cwd = newWorkspace(`${provider.id}-canusetool`);
  const calls = [];
  const q = query({
    prompt: '在当前目录创建 probe.txt，内容为 hello。',
    options: baseOptions(provider, cwd, {
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        calls.push({ toolName, inputKeys: Object.keys(input), file_path: input.file_path });
        return { behavior: 'allow', updatedInput: input };
      },
    }),
  });
  let result = null;
  for await (const m of q) { if (m.type === 'result') result = m; }
  // 按模型实际写入去向读取：优先回调记录的 file_path，回退 cwd/probe.txt
  const candidates = [...calls.filter(c => c.file_path).map(c => c.file_path), path.join(cwd, 'probe.txt')];
  let filePath = null, foundContent = null;
  for (const p of candidates) {
    try { foundContent = await fs.readFile(p, 'utf8'); filePath = p; break; } catch {}
  }
  const fileOk = foundContent != null && foundContent.toLowerCase().includes('hello');
  if (foundContent == null) {
    try { foundContent = 'DIR:' + JSON.stringify(await fs.readdir(cwd)); } catch { foundContent = '<读取失败且目录不可列>'; }
  }
  return { probe: 'canusetool', ok: calls.length > 0 && fileOk, details: { calls, filePath, foundContent: String(foundContent).slice(0, 50), fileOk, subtype: result?.subtype } };
}
