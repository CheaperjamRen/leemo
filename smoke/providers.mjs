// smoke/providers.mjs — Provider 目录（06 号设计文档 §3.1 的最小前身）
export const PROVIDERS = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', keyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
  glm:      { name: 'GLM',      baseUrl: 'https://open.bigmodel.cn/api/anthropic', keyEnv: 'GLM_API_KEY', modelEnv: 'GLM_MODEL', defaultModel: 'glm-5.2' },
  kimi:     { name: 'Kimi',     baseUrl: 'https://api.moonshot.cn/anthropic', keyEnv: 'KIMI_API_KEY', modelEnv: 'KIMI_MODEL', defaultModel: 'kimi-k2.5' },
};

export function resolveProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`未知 provider: ${id}（可选: ${Object.keys(PROVIDERS).join('/')}）`);
  const apiKey = process.env[p.keyEnv];
  if (!apiKey) throw new Error(`${p.keyEnv} 未配置——在 E:\\Leemo\\.env 里填入后重试`);
  return { id, ...p, apiKey, model: process.env[p.modelEnv] || p.defaultModel };
}
