// smoke/probes.mjs — Phase 0 四项探测（不卡 PASS 门，只记录事实供后续设计）
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildEnv, newWorkspace } from './lib.mjs';

function baseOptions(provider, cwd, extra = {}) {
  return { cwd, env: buildEnv(provider), permissionMode: 'acceptEdits', settingSources: [], maxTurns: 6, ...extra };
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
export async function probeCanUseTool(provider) {
  const cwd = newWorkspace(`${provider.id}-canusetool`);
  const calls = [];
  const q = query({
    prompt: '在当前目录创建 probe.txt，内容为 hello。',
    options: baseOptions(provider, cwd, {
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        calls.push({ toolName, inputKeys: Object.keys(input) });
        return { behavior: 'allow', updatedInput: input };
      },
    }),
  });
  let result = null;
  for await (const m of q) { if (m.type === 'result') result = m; }
  let fileOk = false;
  try { fileOk = (await fs.readFile(path.join(cwd, 'probe.txt'), 'utf8')).includes('hello'); } catch {}
  return { probe: 'canusetool', ok: calls.length > 0 && fileOk, details: { calls, fileOk, subtype: result?.subtype } };
}
