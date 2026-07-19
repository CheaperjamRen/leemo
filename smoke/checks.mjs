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

// ④ 子 agent：强制走子 agent 派生工具，验证派生与回收
//    诊断证据（2026-07-20 DeepSeek 实测）：init.tools 数组把派生工具标为 'Task'，
//    但模型实际发出的 tool_use.name 是 'Agent'（SDK 0.3.210 措辞 "Agent/Task tool" 双名坐实）。
//    故工具名匹配用集合 ['Task','Agent']；details 收集全部 tool_use 名（toolNames）留证。
//    另：模型默认最终回复不含数量（实测仅回 "任务已完成 ✅"），故 prompt 硬性要求最终复述
//    数量与全部文件名，保证 /3|三/ 断言有据可依（判定逻辑不放水）。
export async function checkSubagent(provider) {
  const cwd = newWorkspace(`${provider.id}-subagent`);
  for (const name of ['alpha', 'beta', 'gamma']) {
    await fs.writeFile(path.join(cwd, `${name}.txt`), name + '\n');
  }
  const q = query({
    prompt: '使用 Task 工具派一个子 agent 统计当前目录下 .txt 文件的数量和文件名，然后向我汇报。必须用 Task 工具，不要自己直接数。子 agent 完成后，你必须在给我的最终回复里写明文件数量和全部文件名。',
    options: baseOptions(provider, cwd, { maxTurns: 15 }),
  });
  let taskToolUsed = false, subagentActivity = 0, result = null;
  const toolNames = new Set();
  for await (const m of q) {
    if (m.type === 'assistant') {
      if (m.parent_tool_use_id) subagentActivity++;
      for (const b of m.message.content) {
        if (b.type === 'tool_use') {
          toolNames.add(b.name);
          if (['Task', 'Agent'].includes(b.name)) taskToolUsed = true;
        }
      }
    }
    if (m.type === 'user' && m.parent_tool_use_id) subagentActivity++;
    if (m.type === 'result') result = m;
  }
  const answer = result?.subtype === 'success' ? result.result || '' : '';
  return {
    check: 'subagent',
    pass: taskToolUsed && /3|三/.test(answer) && result?.subtype === 'success',
    details: { taskToolUsed, subagentActivity, toolNames: [...toolNames], answer: answer.slice(0, 150) },
  };
}

// ⑤ 上下文压缩：resume + 字符串 '/compact' 斜杠命令手动触发，验证压缩管线。
//    诊断证据（2026-07-20 DeepSeek 实测，见 task-34 报告）：
//    a) 流式输入中途的纯文本 '/compact' 不走斜杠命令解析（原实现恒 boundary=null 的真因）；
//       必须 resume + 字符串 prompt 才路由到本地斜杠命令（q2 result="Not enough messages..." 即命令已被识别的铁证）。
//    b) 极简会话（单次设定）下 /compact 返回 "Not enough messages to compact." → 无 boundary；
//       须先灌足上下文（实测 pre_tokens≈23k）compact 才真正发生并产出 boundary + 召回存活。
//    c) 故三段式：q1 多轮流式建立设定并堆足上下文（记 session_id）→ q2 resume+'/compact' 收 boundary
//       → q3 resume 问暗号验召回。依赖 resume（P1 已验证）+ 字符串 prompt 斜杠命令路径。
//    自动触发需灌 10 万+ tokens，不在 smoke 范围。判定断言保持不变，不放水。
export async function checkCompaction(provider) {
  const cwd = newWorkspace(`${provider.id}-compaction`);
  // q1: 多轮流式建立设定并堆足上下文（记 session_id）
  async function* turns() {
    yield u('请完整复述并记住这个设定：Leemo 是基于 Claude Agent SDK 的桌面 AI 工作台，人格叫 momo，暗号是紫色大象 88。回复"记住了"。');
    yield u('详细解释什么是 AI Agent，至少 200 字。');
    yield u('详细讲讲桌面应用与 Web 应用的区别，至少 200 字。');
    yield u('列举 8 门常见编程语言并各写两句话介绍。');
    yield u('详细讲讲什么是上下文窗口以及为什么需要压缩，至少 200 字。');
    yield u('详细总结我们刚才聊过的所有话题。');
  }
  const q1 = query({ prompt: turns(), options: baseOptions(provider, cwd, { maxTurns: 20 }) });
  let sessionId = null;
  for await (const m of q1) { if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id; }

  // q2: resume + 字符串 '/compact'，收 compact_boundary 与消息类型序列（messageTypes 供报告判断命令是否被识别）
  const q2 = query({ prompt: '/compact', options: baseOptions(provider, cwd, { maxTurns: 3, resume: sessionId }) });
  let boundary = null;
  const messageTypes = [];
  for await (const m of q2) {
    messageTypes.push(m.type + (m.subtype ? `:${m.subtype}` : ''));
    if (m.type === 'system' && m.subtype === 'compact_boundary') boundary = m.compact_metadata;
  }

  // q3: resume 后问暗号验证召回
  const q3 = query({ prompt: '压缩之后问你：设定里的暗号是什么？直接说出。', options: baseOptions(provider, cwd, { maxTurns: 3, resume: sessionId }) });
  let lastResult = null;
  for await (const m of q3) { if (m.type === 'result') lastResult = m; }
  const finalText = lastResult?.subtype === 'success' ? lastResult.result || '' : '';
  return {
    check: 'compaction',
    pass: Boolean(boundary) && /紫色大象/.test(finalText) && /88/.test(finalText) && lastResult?.subtype === 'success',
    details: { sessionId, messageTypes, subtype: lastResult?.subtype, trigger: boundary?.trigger, pre_tokens: boundary?.pre_tokens, post_tokens: boundary?.post_tokens, finalText: finalText.slice(0, 120) },
  };
}
