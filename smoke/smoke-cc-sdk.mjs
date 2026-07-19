// smoke/smoke-cc-sdk.mjs — Phase 0 runner
// 用法: node smoke/smoke-cc-sdk.mjs --provider deepseek|glm|kimi|all --check all|streaming,tools,... --probes
import { loadEnv, saveResult } from './lib.mjs';
import { PROVIDERS, resolveProvider } from './providers.mjs';

loadEnv();

// Task 3 在此注册五项核心验证；Task 4 注册探测
export const CHECKS = {};   // { streaming: fn(provider), tools: fn, multiturn: fn, subagent: fn, compaction: fn }
export const PROBES = {};   // { resume: fn(provider), anysearch: fn, 'relay-anthropic': fn, canusetool: fn(provider) }

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const providerArg = arg('provider', 'deepseek');
const checkArg = arg('check', 'all');
const runProbes = process.argv.includes('--probes');

const providerIds = providerArg === 'all' ? Object.keys(PROVIDERS) : [providerArg];
const checkNames = checkArg === 'none' ? [] : checkArg === 'all' ? Object.keys(CHECKS) : String(checkArg).split(',');

for (const pid of providerIds) {
  let provider;
  try { provider = resolveProvider(pid); }
  catch (e) { console.error(`[skip] ${pid}: ${e.message}`); continue; }

  console.log(`\n===== ${provider.name} (${provider.model}) =====`);
  const run = { provider: pid, model: provider.model, startedAt: new Date().toISOString(), checks: [], probes: [] };

  for (const name of checkNames) {
    if (!CHECKS[name]) { console.error(`[skip] 未知 check: ${name}`); continue; }
    console.log(`\n--- check: ${name} ---`);
    const t0 = Date.now();
    try {
      const r = await CHECKS[name](provider);
      r.ms = Date.now() - t0;
      run.checks.push(r);
      console.log(`${r.pass ? 'PASS' : 'FAIL'} (${r.ms}ms)`, JSON.stringify(r.details).slice(0, 300));
    } catch (e) {
      run.checks.push({ check: name, pass: false, error: String(e), ms: Date.now() - t0 });
      console.log(`ERROR: ${e}`);
    }
  }

  if (runProbes) {
    for (const [name, fn] of Object.entries(PROBES)) {
      console.log(`\n--- probe: ${name} ---`);
      try {
        const r = await fn(provider);
        run.probes.push(r);
        console.log(`ok=${r.ok}`, JSON.stringify(r.details).slice(0, 300));
      } catch (e) { run.probes.push({ probe: name, ok: false, error: String(e) }); console.log(`ERROR: ${e}`); }
    }
  }

  const file = saveResult(pid, run);
  const passed = run.checks.filter(c => c.pass).length;
  console.log(`\n${provider.name}: ${passed}/${run.checks.length} checks pass → ${file}`);
}
