// smoke/lib.mjs — 共享工具：env 加载、SDK 环境构造、工作区、脱敏
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && m[2] !== '') {
      let val = m[2];
      const qm = val.match(/^(['"])(.*)\1$/);
      if (qm) val = qm[2];
      process.env[m[1]] ??= val;
    }
  }
}

// options.env 整体替换子进程环境，必须 spread process.env
export function buildEnv(provider) {
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: provider.baseUrl,
    ANTHROPIC_AUTH_TOKEN: provider.apiKey,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: provider.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: provider.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: provider.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.model,
    ANTHROPIC_SMALL_FAST_MODEL: provider.model,
    CLAUDE_CODE_SUBAGENT_MODEL: provider.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

// 流式输入模式的 user 消息形状
export const u = (content) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: null,
  session_id: '',
});

export function newWorkspace(tag) {
  const dir = path.join(ROOT, 'smoke', 'workspaces', `${tag}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function redact(str) {
  let out = String(str);
  for (const [k, v] of Object.entries(process.env)) {
    // ≥4：真实 key 不会更短；阈值防止 "0"/"1" 这类占位值触发全局替换把日志搅烂
    if (/(_API_KEY|_TOKEN)$/.test(k) && v && v.length >= 4) out = out.split(v).join(`<${k}>`);
  }
  return out;
}

export function saveResult(providerId, data) {
  const dir = path.join(ROOT, 'smoke', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${providerId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, redact(JSON.stringify(data, null, 2)));
  return file;
}
