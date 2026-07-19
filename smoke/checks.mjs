// smoke/checks.mjs — Phase 0 五项核心验证
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildEnv, u, newWorkspace } from './lib.mjs';

const CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 单项 10 分钟硬上限：网络卡死/权限挂起时 abort，runner 记为 ERROR 而非挂死

function baseOptions(provider, cwd, extra = {}) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(new Error(`check 超时（${CHECK_TIMEOUT_MS / 60000} 分钟）`)), CHECK_TIMEOUT_MS);
  timer.unref(); // 正常完成后不阻止进程退出
  return {
    cwd,
    env: buildEnv(provider),
    permissionMode: 'acceptEdits',
    settingSources: [],          // 隔离本机 ~/.claude 设置，保证可复现
    maxTurns: 10,
    abortController,
    ...extra,
  };
}

// ① 流式：stream_event 增量 ≥5 且正常收束
export async function checkStreaming(provider) {
  const cwd = newWorkspace(`${provider.id}-streaming`);
  const q = query({
    prompt: '请从 1 数到 5，每个数字单独一行，不要多余内容。',
    options: baseOptions(provider, cwd, { includePartialMessages: true, maxTurns: 3 }),
  });
  let streamEvents = 0, result = null;
  for await (const m of q) {
    if (m.type === 'stream_event') streamEvents++;
    if (m.type === 'result') result = m;
  }
  return {
    check: 'streaming',
    pass: streamEvents >= 5 && result?.subtype === 'success' && !result.is_error,
    details: { streamEvents, subtype: result?.subtype, usage: result?.usage },
  };
}

// ② 内置工具：真实读文件 + 写文件
export async function checkTools(provider) {
  const cwd = newWorkspace(`${provider.id}-tools`);
  await fs.writeFile(path.join(cwd, 'notes.md'), '# 会议纪要\n- Leemo 的内部构建代号是 obsidian-7413\n- 默认推荐 DeepSeek\n');
  const q = query({
    prompt: '读取 notes.md，把其中的内部构建代号写入 answer.txt（只写代号本身，不要别的字）。',
    options: baseOptions(provider, cwd),
  });
  const toolsUsed = [];
  let result = null;
  for await (const m of q) {
    if (m.type === 'assistant') for (const b of m.message.content) { if (b.type === 'tool_use') toolsUsed.push(b.name); }
    if (m.type === 'result') result = m;
  }
  let content = '';
  try { content = await fs.readFile(path.join(cwd, 'answer.txt'), 'utf8'); } catch {}
  return {
    check: 'tools',
    pass: toolsUsed.length > 0 && content.includes('7413') && result?.subtype === 'success',
    details: { toolsUsed, answerContent: content.trim().slice(0, 80) },
  };
}

// ③ 多轮：同 session 内第二轮引用第一轮信息（流式输入队列，两条依次成轮）
export async function checkMultiTurn(provider) {
  const cwd = newWorkspace(`${provider.id}-multiturn`);
  async function* turns() {
    yield u('请记住这个暗号：蓝色鲸鱼 42。记住后只回复"记住了"。');
    yield u('我刚才让你记住的暗号是什么？一字不差地说出来。');
  }
  const q = query({ prompt: turns(), options: baseOptions(provider, cwd, { maxTurns: 6 }) });
  let assistantTurns = 0, lastResult = null;
  for await (const m of q) {
    if (m.type === 'assistant' && !m.parent_tool_use_id) assistantTurns++;
    if (m.type === 'result') lastResult = m;
  }
  const finalText = lastResult?.subtype === 'success' ? lastResult.result || '' : '';
  return {
    check: 'multiturn',
    pass: /蓝色鲸鱼/.test(finalText) && /42/.test(finalText) && lastResult?.subtype === 'success',
    details: { assistantTurns, finalText: finalText.slice(0, 120) },
  };
}

// ④ 子 agent：强制走 Task 工具，验证派生与回收
export async function checkSubagent(provider) {
  const cwd = newWorkspace(`${provider.id}-subagent`);
  for (const name of ['alpha', 'beta', 'gamma']) {
    await fs.writeFile(path.join(cwd, `${name}.txt`), name + '\n');
  }
  const q = query({
    prompt: '使用 Task 工具派一个子 agent 统计当前目录下 .txt 文件的数量和文件名，然后向我汇报。必须用 Task 工具，不要自己直接数。',
    options: baseOptions(provider, cwd, { maxTurns: 15 }),
  });
  let taskToolUsed = false, subagentActivity = 0, result = null;
  for await (const m of q) {
    if (m.type === 'assistant') {
      if (m.parent_tool_use_id) subagentActivity++;
      for (const b of m.message.content) { if (b.type === 'tool_use' && b.name === 'Task') taskToolUsed = true; }
    }
    if (m.type === 'user' && m.parent_tool_use_id) subagentActivity++;
    if (m.type === 'result') result = m;
  }
  const answer = result?.subtype === 'success' ? result.result || '' : '';
  return {
    check: 'subagent',
    pass: taskToolUsed && /3|三/.test(answer) && result?.subtype === 'success',
    details: { taskToolUsed, subagentActivity, answer: answer.slice(0, 150) },
  };
}

// ⑤ 上下文压缩：/compact 手动触发（走 provider 的摘要请求，验证压缩管线）。
//    两个已知局限，报告解读时必须遵守：
//    a) 自动触发需灌 10 万+ tokens，不在 smoke 范围；
//    b) "流式输入中的纯文本 /compact 会被 harness 当斜杠命令拦截"是未经验证的机制假设——
//       若三个 provider 全部 FAIL 且 boundary 恒为 null，先怀疑该触发路径在 SDK 层未生效，
//       用交互式 CLI 手动复验后再下"provider 不支持压缩"的结论。
export async function checkCompaction(provider) {
  const cwd = newWorkspace(`${provider.id}-compaction`);
  async function* turns() {
    yield u('请完整复述并记住这个设定：Leemo 是基于 Claude Agent SDK 的桌面 AI 工作台，人格叫 momo，暗号是紫色大象 88。');
    yield u('/compact');
    yield u('压缩之后问你：设定里的暗号是什么？直接说出。');
  }
  const q = query({ prompt: turns(), options: baseOptions(provider, cwd) });
  let boundary = null, lastResult = null;
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'compact_boundary') boundary = m.compact_metadata;
    if (m.type === 'result') lastResult = m;
  }
  const finalText = lastResult?.subtype === 'success' ? lastResult.result || '' : '';
  return {
    check: 'compaction',
    pass: Boolean(boundary) && /紫色大象/.test(finalText) && /88/.test(finalText) && lastResult?.subtype === 'success',
    details: { subtype: lastResult?.subtype, trigger: boundary?.trigger, pre_tokens: boundary?.pre_tokens, post_tokens: boundary?.post_tokens, finalText: finalText.slice(0, 120) },
  };
}
