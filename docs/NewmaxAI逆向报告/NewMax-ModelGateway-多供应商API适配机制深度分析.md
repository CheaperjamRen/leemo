# NewMax ModelGateway：多供应商 API 适配机制深度分析

> **核心命题**：NewMax 基于 Claude Code CLI（`claude.exe`），但 Claude Agent SDK 原生只支持 Anthropic Messages API 格式。NewMax 如何做到无痛接入 OpenAI、DeepSeek、Doubao、Moonshot、Google Gemini 等非 Anthropic 格式 API？

---

## 目录

1. [核心答案：本地 HTTP 代理 + 格式双向转换](#一核心答案本地-http-代理--格式双向转换)
2. [架构全景图](#二架构全景图)
3. [关键机制 1：环境变量劫持](#三关键机制-1环境变量劫持)
4. [关键机制 2：ModelGateway 的三层路由](#四关键机制-2modelgateway-的三层路由)
5. [关键机制 3：anthropicToOpenAI()——消息格式转换器](#五关键机制-3anthropictoopenai消息格式转换器)
6. [关键机制 4：SSE 事件流转换——响应方向](#六关键机制-4sse-事件流转换响应方向)
7. [关键机制 5：模型能力检测与适配](#七关键机制-5模型能力检测与适配)
8. [关键机制 6：用量数据提取与计费](#八关键机制-6用量数据提取与计费)
9. [Provider 配置的完整生命周期](#九provider-配置的完整生命周期)
10. [三个典型流程对比](#十三-个典型流程对比)
11. [关键文件索引](#十一关键文件索引)
12. [为什么这个设计"无痛"](#十二为什么这个设计无痛)
13. [架构设计启示：如何复刻这套机制](#十三架构设计启示如何复刻这套机制)

---

## 一、核心答案：本地 HTTP 代理 + 格式双向转换

NewMax **不修改 `claude.exe` 源码**。它在 `claude.exe` 和外部 API 之间插入了一个**本地 HTTP 代理服务器（ModelGateway）**，完成两个方向的格式转换：

```
请求方向：Anthropic Messages 格式 → OpenAI Chat Completions 格式（或 Gemini 格式）
响应方向：OpenAI SSE 事件流       → Anthropic SSE 事件流
```

**claude.exe 完全不知道自己不是在和 `api.anthropic.com` 通信**——它发 Anthropic Messages、收 Anthropic SSE，一切如常。ModelGateway 负责所有脏活累活。

---

## 二、架构全景图

```
┌──────────────────────────────────────────────────────────┐
│                 claude.exe (Claude Agent SDK)              │
│                                                           │
│  以为自己在和 api.anthropic.com 通信                         │
│  发送: POST /v1/messages   (Anthropic 格式)                │
│  期待: SSE stream          (Anthropic 事件类型)             │
│                                                           │
│  通过环境变量 ANTHROPIC_BASE_URL 指定目标地址               │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP Request
                           ▼
┌──────────────────────────────────────────────────────────┐
│           NewMax ModelGateway (本地代理)                    │
│           监听: 127.0.0.1:{随机端口}                       │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Step 1: 请求识别                                      │ │
│  │   - 从 Host header / session 识别目标 provider        │ │
│  │   - 读取 provider 配置: apiFormat, baseUrl, apiKey    │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Step 2: 格式转换 (请求方向)                           │ │
│  │                                                      │ │
│  │ 根据 apiFormat 字段分发:                              │ │
│  │                                                      │ │
│  │  ├─ 'anthropic'  → 直接转发（仅做 thinking 兼容处理）  │ │
│  │  ├─ 'openai'     → anthropicToOpenAI() +             │ │
│  │  │                  convertMessageToOpenAI()          │ │
│  │  ├─ 'responses'  → OpenAI Responses API（Codex 专用） │ │
│  │  └─ 'antigravity'→ Google Cloud Code Assist 内部 API  │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Step 3: 发送上游请求                                  │ │
│  │   - URL: buildOpenAIChatCompletionsURL(baseUrl)      │ │
│  │   - Auth: Authorization: Bearer {apiKey}             │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Step 4: SSE 流式响应转换 (响应方向)                    │ │
│  │                                                      │ │
│  │ OpenAI SSE chunks:                                   │ │
│  │   {"choices":[{"delta":{"content":"你好"}}]}          │ │
│  │   {"choices":[{"delta":{"tool_calls":[...]}}]}       │ │
│  │   {"choices":[{"finish_reason":"stop"}]}             │ │
│  │                                                      │ │
│  │          ↓ 逐 chunk 转换 ↓                            │ │
│  │                                                      │ │
│  │ Anthropic SSE events:                                │ │
│  │   event: content_block_start                         │ │
│  │   event: content_block_delta (text)                  │ │
│  │   event: content_block_start (tool_use)              │ │
│  │   event: content_block_delta (input_json_delta)      │ │
│  │   event: content_block_stop                          │ │
│  │   event: message_delta (usage, stop_reason)          │ │
│  │   event: message_stop                                │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Step 5: Token 用量提取 (从最终 chunk 或 stream 累加)   │ │
│  │   → parseXxxUsage()                                  │ │
│  │   → calculateCost()                                  │ │
│  │   → logRequest() → proxy_request_logs 表             │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 三、关键机制 1：环境变量劫持

claude.exe 启动时，读取以 `ANTHROPIC_` 为前缀的环境变量来决定 API 目标。NewMax 利用这一点，将环境变量的值从 Anthropic 真实地址**重定向**到目标供应商：

```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "apiFormat": "openai",
  "settingsConfig": {
    "env": {
      "ANTHROPIC_BASE_URL":              "https://api.deepseek.com/v1",
      "ANTHROPIC_AUTH_TOKEN":            "sk-xxx",
      "ANTHROPIC_MODEL":                 "deepseek-v4-pro",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL":   "deepseek-v4-flash",
      "ANTHROPIC_DEFAULT_SONNET_MODEL":  "deepseek-v4-pro"
    }
  }
}
```

**字段说明**：

| 环境变量 | 含义 | 被劫持后指向 |
|---------|------|-------------|
| `ANTHROPIC_BASE_URL` | claude.exe 发 HTTP 请求的目标地址 | 目标供应商的 API 端点（如 `api.deepseek.com`） |
| `ANTHROPIC_AUTH_TOKEN` | API 认证令牌 | 目标供应商的 API Key |
| `ANTHROPIC_MODEL` | 默认模型名 | 目标供应商的模型 ID |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 快速模型 | 目标供应商的轻量模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 均衡模型 | 目标供应商的主力模型 |

### 实际流程

```
1. 用户选择 DeepSeek 模型发起对话
2. NewMax Electron 主进程读取 DeepSeek provider 配置
3. 将配置中的 env 字段注入 claude.exe 子进程的环境变量
4. claude.exe 启动，读取 ANTHROPIC_BASE_URL = "https://api.deepseek.com/v1"
5. claude.exe 发 POST /v1/messages 到 api.deepseek.com
6. ⚠️ 但 DeepSeek 的 API 不接受 Anthropic Messages 格式！
```

这就引出了 ModelGateway——在第 5 步之前插入一个本地代理来完成格式转换。

**实际上，`ANTHROPIC_BASE_URL` 指向的是 `127.0.0.1:{ModelGateway端口}`**，而非直接指向供应商。

---

## 四、关键机制 2：ModelGateway 的三层路由

从 app.asar 源码中提取的核心路由逻辑：

```javascript
// ModelGateway 请求处理（简化还原）
async function handleGatewayRequest(req, res) {
  const provider      = resolveProvider(req);           // 从 session/host 识别
  const apiFormat     = provider.apiFormat;            // 'anthropic' | 'openai' | 'responses' | 'antigravity'
  const baseUrl       = provider.settingsConfig.env.ANTHROPIC_BASE_URL;
  const apiKey        = provider.settingsConfig.env.ANTHROPIC_AUTH_TOKEN;
  const defaultModel  = provider.settingsConfig.env.ANTHROPIC_MODEL;

  let requestBody = parseRequestBody(req);
  let upstreamUrl;

  // ── 第 1 层：特殊格式（Responses API） ──
  if (isClaudeCodex(apiFormat)) {
    // GPT Codex 系列 → 使用 OpenAI Responses API
    upstreamUrl = buildOpenAIResponsesURL(baseUrl);
    // requestBody 保持 Anthropic 格式，Responses API 原生接受
  }
  // ── 第 2 层：格式匹配（Anthropic → Anthropic） ──
  else if (apiFormat === 'anthropic') {
    upstreamUrl = buildAnthropicMessagesURL(baseUrl);
    // 不做格式转换，只处理 thinking type 兼容性
    normalizeAnthropicThinking(requestBody, modelCapabilities);
  }
  // ── 第 3 层：格式转换（Anthropic → OpenAI） ──
  else {
    // 核心：把 Anthropic Messages 格式转为 OpenAI Chat Completions 格式
    requestBody = anthropicToOpenAI(requestBody);
    upstreamUrl = buildOpenAIChatCompletionsURL(baseUrl);
  }

  // 发送到上游
  let response = await sendUpstream(upstreamUrl, requestBody, apiKey);

  // 流式响应：SSE 事件逐 chunk 转换
  if (requestBody.stream) {
    pipeStreamWithConversion(response, res, apiFormat);
  }
}
```

### 路由决策表

| `apiFormat` | 示例供应商 | formatMode | 请求体转换 | 上游端点 |
|-------------|-----------|------------|-----------|---------|
| `"anthropic"` | Anthropic 官方 | `anthropic` | 无（仅做 thinking 兼容） | `/v1/messages` |
| `"openai"` | DeepSeek、Doubao、Moonshot、硅基流动 | `openai` | `anthropicToOpenAI()` 全转换 | `/v1/chat/completions` |
| `"responses"` 或 `"codex"` | GPT Codex 系列 | `responses` | 无（Responses API 原生接受 Anthropic 消息格式） | `/v1/responses` |
| `"antigravity"` | Google Cloud Code Assist | `antigravity` | 使用独立 Google 适配器 | `daily-cloudcode-pa.googleapis.com` |

---

## 五、关键机制 3：`anthropicToOpenAI()`——消息格式转换器

这是整个适配层的**核心函数**。从源码中完整还原：

### 5.1 主函数

```javascript
function anthropicToOpenAI(anthropicRequest) {
  const openaiMessages = [];
  const openaiRequest = {};

  // ── 1. model 透传 ──
  if (anthropicRequest.model !== undefined) {
    openaiRequest.model = anthropicRequest.model;
  }

  // ── 2. system prompt 转换 ──
  //    Anthropic: system 是顶层字符串或数组 [{type:"text", text:"..."}, ...]
  //    OpenAI:    system 是 messages[0] role="system"
  const system = anthropicRequest.system;
  if (typeof system === 'string' && system) {
    openaiMessages.push({ role: 'system', content: system });
  } else if (Array.isArray(system)) {
    const text = system
      .filter((block, i) => !(i === 0 && isCcBillingHeaderBlock(block)))
      .map(block => toString(toObject(block).text))
      .filter(Boolean)
      .join('\n\n');
    if (text) openaiMessages.push({ role: 'system', content: text });
  }

  // ── 3. messages 转换（逐条消息调用 convertMessageToOpenAI） ──
  for (const msg of toArray(anthropicRequest.messages)) {
    const role    = toString(toObject(msg).role) || 'user';
    const content = toObject(msg).content;
    const converted = convertMessageToOpenAI(role, content);
    openaiMessages.push(...converted);
  }
  openaiRequest.messages = openaiMessages;

  // ── 4. 通用参数透传 ──
  if (anthropicRequest.max_tokens !== undefined)
    openaiRequest.max_tokens = anthropicRequest.max_tokens;
  if (anthropicRequest.temperature !== undefined)
    openaiRequest.temperature = anthropicRequest.temperature;
  if (anthropicRequest.top_p !== undefined)
    openaiRequest.top_p = anthropicRequest.top_p;
  if (anthropicRequest.stop_sequences !== undefined)
    openaiRequest.stop = anthropicRequest.stop_sequences;
  if (anthropicRequest.stream !== undefined)
    openaiRequest.stream = anthropicRequest.stream;

  // ── 5. tools 转换 ──
  //    Anthropic: tools[{name, description, input_schema}]
  //    OpenAI:    tools[{type:"function", function:{name, description, parameters}}]
  const anthropicTools = toArray(anthropicRequest.tools);
  openaiRequest.tools = anthropicTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema  // input_schema 直接复用为 parameters
    }
  }));

  return openaiRequest;
}
```

### 5.2 图片格式转换：`convertMessageToOpenAI()`

```javascript
function convertMessageToOpenAI(role, content) {
  const messages = [];

  // 纯文本消息
  if (typeof content === 'string') {
    messages.push({ role, content });
    return messages;
  }

  // 多模态内容（图片 + 文本）
  const blocks = toArray(content);
  const parts = [];

  for (const block of blocks) {
    const type = toString(toObject(block).type);

    if (type === 'text') {
      parts.push({ type: 'text', text: toString(toObject(block).text) });
    }
    // ⚠️ 关键：图片格式转换
    else if (type === 'image') {
      const source  = toObject(toObject(block).source);
      const mime    = toString(source.media_type) || 'image/png';
      const data    = toString(source.data);

      // Anthropic: {type:"image", source:{type:"base64", media_type:"image/png", data:"..."}}
      //       ↓
      // OpenAI:   {type:"image_url", image_url:{url:"data:image/png;base64,...", detail:"auto"}}
      if (data) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${mime};base64,${data}`,
            detail: 'auto'
          }
        });
      }
    }
    // tool_result → 转换为 tool 消息
    else if (type === 'tool_result') {
      const toolCallId = toString(toObject(block).tool_use_id);
      const resultContent = toString(toObject(block).content);
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: resultContent
      });
    }
    // tool_use → 转换为 assistant 消息中的 tool_calls
    else if (type === 'tool_use') {
      const toolId   = toString(toObject(block).id);
      const toolName = toString(toObject(block).name);
      const toolInput = toObject(block).input;
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: toolId,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(toolInput)
          }
        }]
      });
    }
  }

  if (parts.length > 0) {
    messages.push({ role, content: parts });
  }

  return messages;
}
```

### 5.3 参数映射对照表

| Anthropic Messages API | OpenAI Chat Completions API |
|------------------------|----------------------------|
| `max_tokens` | `max_tokens` （直接透传） |
| `temperature` | `temperature` （直接透传） |
| `top_p` | `top_p` （直接透传） |
| `stop_sequences` | `stop` （字段名不同） |
| `system: "..."`（顶层） | `messages[0]: {role: "system", content: "..."}` |
| `messages[].content: [{type:"text", text:"..."}]` | `messages[].content: [{type:"text", text:"..."}]` |
| `messages[].content: [{type:"image", source:{type:"base64", media_type, data}}]` | `messages[].content: [{type:"image_url", image_url:{url:"data:{mime};base64,{data}"}}]` |
| `tools: [{name, description, input_schema}]` | `tools: [{type:"function", function:{name, description, parameters}}]` |
| `tool_use: {id, name, input}`（消息内的 block） | `tool_calls: [{id, type:"function", function:{name, arguments: "{json}"}}]`（assistant 消息属性） |
| `tool_result: {tool_use_id, content}`（消息内的 block） | `{role:"tool", tool_call_id, content}`（独立消息） |

---

## 六、关键机制 4：SSE 事件流转换——响应方向

OpenAI 的 SSE（Server-Sent Events）格式与 Anthropic 完全不同。ModelGateway 在流式响应的 pipe 过程中**逐 chunk 转换**：

### 6.1 事件映射表

| OpenAI SSE Chunk | Anthropic SSE Event |
|---|---|
| `{"object":"chat.completion.chunk", "choices":[{"delta":{"role":"assistant"}}]}` | `event: message_start` |
| `{"choices":[{"delta":{"content":"你好"}}]}` | `event: content_block_start` + `event: content_block_delta` + `{"type":"text_delta","text":"你好"}` |
| `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"Read"}}]}}]}` | `event: content_block_start` + `{"type":"tool_use","id":"call_xxx","name":"Read"}` |
| `{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\"file\""}}]}}]}` | `event: content_block_delta` + `{"type":"input_json_delta","partial_json":"{\"file\""}` |
| `{"choices":[{"finish_reason":"stop"}]}` | `event: content_block_stop` + `event: message_delta` + `event: message_stop` |
| `{"usage":{"prompt_tokens":100,"completion_tokens":50,...}}` | 提取到 `message_stop` 事件的 `usage` 字段中 |
| `{"choices":[{"finish_reason":"tool_calls"}]}` | `event: message_delta` + `{"stop_reason":"tool_use"}` + `event: message_stop` |
| `{"choices":[{"finish_reason":"length"}]}` | `event: message_delta` + `{"stop_reason":"max_tokens"}` + `event: message_stop` |

### 6.2 流式转换核心逻辑

```javascript
// 流式处理中的 SSE 事件构建（简化还原）
let currentToolCalls = {};  // 按 index 跟踪 tool_call 累积状态

for await (const chunk of upstreamStream) {
  if (chunk.choices?.[0]?.delta?.role) {
    // assistant role 出现 → message_start
    emitSSE('event: message_start\ndata: {"type":"message_start"}\n\n');
  }

  if (chunk.choices?.[0]?.delta?.content) {
    const text = chunk.choices[0].delta.content;
    // 首次文本 → content_block_start + content_block_delta
    if (isFirstTextChunk) {
      emitSSE(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`);
      isFirstTextChunk = false;
    }
    emitSSE(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`);
  }

  if (chunk.choices?.[0]?.delta?.tool_calls) {
    for (const tc of chunk.choices[0].delta.tool_calls) {
      // 新 tool_call → content_block_start (tool_use)
      if (tc.id && !currentToolCalls[tc.index]) {
        currentToolCalls[tc.index] = { id: tc.id, name: tc.function?.name || '', args: '' };
        emitSSE(`event: content_block_start\ndata: {"type":"content_block_start","index":${tc.index + textBlockCount},"content_block":{"type":"tool_use","id":${JSON.stringify(tc.id)},"name":${JSON.stringify(tc.function.name)}}}\n\n`);
      }
      // tool_call arguments delta → content_block_delta (input_json_delta)
      if (tc.function?.arguments) {
        currentToolCalls[tc.index].args += tc.function.arguments;
        emitSSE(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${tc.index + textBlockCount},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(tc.function.arguments)}}}\n\n`);
      }
    }
  }

  if (chunk.choices?.[0]?.finish_reason) {
    // 结束 → content_block_stop（所有 block）+ message_delta + message_stop
    for (let i = 0; i < totalBlocks; i++) {
      emitSSE(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${i}}\n\n`);
    }

    const stopReason = mapFinishReason(chunk.choices[0].finish_reason);
    // stop → "end_turn", tool_calls → "tool_use", length → "max_tokens"

    const usage = chunk.usage ? {
      input_tokens: chunk.usage.prompt_tokens,
      output_tokens: chunk.usage.completion_tokens
    } : {};

    emitSSE(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":${JSON.stringify(stopReason)},"stop_sequence":null},"usage":${JSON.stringify(usage)}}\n\n`);
    emitSSE(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  }
}
```

### 6.3 finish_reason 映射

```javascript
function mapFinishReason(openaiFinishReason) {
  const MAP = {
    'stop':        'end_turn',
    'tool_calls':  'tool_use',
    'length':      'max_tokens',
    'content_filter': 'end_turn'  // 降级为 end_turn
  };
  return MAP[openaiFinishReason] || 'end_turn';
}
```

---

## 七、关键机制 5：模型能力检测与适配

ModelGateway 在转发前还会检测模型能力，做针对性适配：

### 7.1 Thinking 能力检测与自动剥离

```javascript
if (apiFormat === 'anthropic') {
  const capabilities = getModelCapabilities(provider, model);
  const thinkingSupport = getKnownThinkingSupport(provider.id, model);
  const thinking = capabilities?.thinking ?? thinkingSupport;

  // 如果模型不支持 extended thinking，自动剥离 thinking 参数
  const normalized = normalizeAnthropicThinking(requestBody, thinking);
  if (normalized.stripped) {
    console.log('[ModelGateway] Stripped unsupported thinking.type=' + normalized.originalType);
  }
}
```

**支持的 thinking 检测级别**：

| 级别 | 说明 | 示例模型 |
|------|------|---------|
| `full` | 支持完整的 extended thinking | Claude Sonnet 4、Opus 4 |
| `basic` | 仅支持基础 thinking | Claude Haiku 3.5 |
| `none` | 不支持 thinking | 大部分第三方模型 |

### 7.2 max_tokens 超限自动降级

```javascript
// 当上游返回 400 (max_tokens 超限) 时自动降级
if (response.status === 400 && isMaxTokensError(response)) {
  // 从错误信息中提取允许的最大值
  const maxAllowed = clampMaxTokensFromError(response.body);
  if (maxAllowed > 0) {
    // 重新构建请求，将 max_tokens 钳制到允许范围
    requestBody.max_tokens = Math.min(requestBody.max_tokens, maxAllowed);
    // 重新发送
    response = await sendUpstream(upstreamUrl, requestBody, apiKey);
  }
}
```

### 7.3 视觉能力自动检测

```javascript
// 通过模型名称前缀初步判断
function hasVisionCapability(modelId) {
  // GPT-4o, GPT-4-turbo, Gemini, Claude 3+ → true
  // GPT-3.5, text-*  → false
  const NO_VISION_PREFIXES = ['gpt-3.5', 'text-'];
  const HAS_VISION_PREFIXES = ['gpt-4', 'claude-3', 'claude-4', 'gemini', 'deepseek-vl'];
  // ... 前缀匹配逻辑
}
```

---

## 八、关键机制 6：用量数据提取与计费

### 8.1 四个供应商的 Usage 解析函数

```javascript
// ── Anthropic（最复杂——有缓存 token 细分） ──
function parseAnthropicUsage(response) {
  const u = response.usage ?? {};
  return {
    inputTokens:         asInt(u.input_tokens),
    outputTokens:        asInt(u.output_tokens),
    cacheReadTokens:     asInt(u.cache_read_input_tokens),
    cacheCreationTokens: asInt(u.cache_creation_input_tokens)
  };
}

// ── OpenAI ──
function parseOpenAIUsage(response) {
  const u = response.usage ?? {};
  const details = u.prompt_tokens_details ?? {};
  return {
    inputTokens:         asInt(u.prompt_tokens),
    outputTokens:        asInt(u.completion_tokens),
    cacheReadTokens:     asInt(details.cached_tokens),
    cacheCreationTokens: 0           // OpenAI 目前不返回 cache creation
  };
}

// ── Google Gemini（流式累加方式） ──
// 每条 chunk 累加:
//   promptTokenCount     += chunk.usageMetadata?.promptTokenCount ?? 0
//   candidatesTokenCount += chunk.usageMetadata?.candidatesTokenCount ?? 0
// 最终:
//   inputTokens  = promptTokenCount
//   outputTokens = candidatesTokenCount

// ── Custom（通用 OpenAI 兼容 API） ──
// response.usage.input_tokens  → inputTokens
// response.usage.output_tokens → outputTokens
```

### 8.2 费用计算引擎

```javascript
const PER_MILLION = 0xf4240; // = 1,000,000（用十六进制避免魔法数字）

function calculateCost(usage, pricing) {
  if (!pricing) return zeroCost();

  const inputPrice          = parseFloat(pricing.inputCostPerMillion) || 0;
  const outputPrice         = parseFloat(pricing.outputCostPerMillion) || 0;
  const cacheReadPrice      = parseFloat(pricing.cacheReadCostPerMillion) || 0;
  const cacheCreationPrice  = parseFloat(pricing.cacheCreationCostPerMillion) || 0;

  // ⚠️ 关键：计费输入 token = 总输入 - 缓存命中（缓存命中按低价另算）
  const billableInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens);

  const inputCost          = billableInput * inputPrice / PER_MILLION;
  const outputCost         = usage.outputTokens * outputPrice / PER_MILLION;
  const cacheReadCost      = usage.cacheReadTokens * cacheReadPrice / PER_MILLION;
  const cacheCreationCost  = usage.cacheCreationTokens * cacheCreationPrice / PER_MILLION;
  const totalCost          = inputCost + outputCost + cacheReadCost + cacheCreationCost;

  return {
    inputCost:          toFixed6(inputCost),          // e.g. "0.001234"
    outputCost:         toFixed6(outputCost),
    cacheReadCost:      toFixed6(cacheReadCost),
    cacheCreationCost:  toFixed6(cacheCreationCost),
    totalCost:          toFixed6(totalCost),
    currency:           pricing.currency              // "USD" 或 "CNY"
  };
}
```

**费用公式**：`token 数 × 每百万 token 价格 ÷ 1,000,000`，精确到小数点后 6 位。

**计费分离**：缓存命中的输入 token 不计入 `inputCost`，而是单独计为 `cacheReadCost`（通常便宜 90%）。

### 8.3 定价数据来源

```sql
-- model_pricing 表结构
CREATE TABLE model_pricing (
    model_id                      TEXT PRIMARY KEY,
    display_name                  TEXT NOT NULL DEFAULT '',
    input_cost_per_million        TEXT,
    output_cost_per_million       TEXT,
    cache_read_cost_per_million   TEXT,
    cache_creation_cost_per_million TEXT,
    currency                      TEXT NOT NULL DEFAULT 'USD'
);
```

**查找逻辑**：

```javascript
function findModelPricing(modelId) {
  // 1. 标准化模型名（去 provider 前缀、去版本号、小写）
  const normalized = normalizeModelName(modelId);

  // 2. 精确匹配
  let row = db.prepare('SELECT * FROM model_pricing WHERE model_id = ?').get(normalized);
  if (row) return mapRow(row);

  // 3. 模糊匹配（LIKE 前缀，ORDER BY LENGTH DESC 取最精确）
  row = db.prepare(
    'SELECT * FROM model_pricing WHERE ? LIKE LOWER(model_id) || \'%\' ORDER BY LENGTH(model_id) DESC LIMIT 1'
  ).get(normalized);
  return row ? mapRow(row) : null;  // 无匹配返回 null → calculateCost 走全零
}

function normalizeModelName(raw) {
  // "anthropic/claude-sonnet-4-20250514@latest" → "claude-sonnet-4-20250514"
  let name = raw;
  const slashIdx = name.indexOf('/');
  if (slashIdx !== -1) name = name.slice(slashIdx + 1);
  const atIdx = name.indexOf(':') !== -1 ? name.indexOf(':') : name.indexOf('@');
  if (atIdx !== -1) name = name.slice(0, atIdx);
  name = name.replace(/@/g, '-').trim().toLowerCase();
  name = name.replace(/^claude-(opus|sonnet|haiku)-(\d+)\.(\d+)/, 'claude-$1-$2$3');
  return name;
}
```

### 8.4 数据库写入

```javascript
function logRequest(record) {
  // record 结构：
  // {
  //   providerId, providerName, model, requestModel,
  //   usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
  //   cost:  { inputCost, outputCost, cacheReadCost, cacheCreationCost, totalCost, currency },
  //   latencyMs, statusCode, errorMessage, isStreaming, conversationId,
  //   detail: { requestHeaders, requestBody, responseHeaders, responseSummary }  // 可选
  // }

  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO proxy_request_logs (
      request_id, provider_id, provider_name, model, request_model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd,
      latency_ms, status_code, error_message, is_streaming, conversation_id, created_at,
      currency
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, record.providerId, record.providerName, record.model, record.requestModel,
         record.usage.inputTokens, record.usage.outputTokens,
         record.usage.cacheReadTokens, record.usage.cacheCreationTokens,
         record.cost.inputCost, record.cost.outputCost,
         record.cost.cacheReadCost, record.cost.cacheCreationCost, record.cost.totalCost,
         record.latencyMs, record.statusCode, record.errorMessage,
         record.isStreaming ? 1 : 0, record.conversationId ?? null, now,
         record.cost.currency);

  // 异步写入详情（避免阻塞）
  if (record.detail) {
    process.nextTick(() => writeDetailAsync(id, record.detail));
  }
}
```

---

## 九、Provider 配置的完整生命周期

```
┌──────────────┐
│ 1. 用户添加   │  设置 > 模型供应商 > 添加
│   Provider   │  内置: anthropic / openai / deepseek / moonshot / google / doubao...
│              │  自定义: 输入名称 + API Key + Base URL
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 2. 持久化     │  存入 settings 表（app key）
│   配置       │  providers: [{
│              │    id, name, apiFormat, enabled,
│              │    settingsConfig: {
│              │      env: {ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, ...}
│              │    }
│              │  }]
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 3. 用户选择   │  对话中选择模型 → providerOrder 决定供应商优先级
│   模型       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 4. 环境变量   │  启动 claude.exe 子进程时注入 env
│   注入       │  ANTHROPIC_BASE_URL    = 127.0.0.1:{ModelGatewayPort}
│              │  ANTHROPIC_AUTH_TOKEN  = {真实 API Key}
│              │  ANTHROPIC_MODEL       = {模型 ID}
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 5. 运行时     │  claude.exe → ModelGateway → 上游供应商
│   适配       │  ModelGateway 根据 session 识别 provider
│              │  格式转换 + 发送 + SSE 转换 + usage 提取
└──────────────┘
```

### Provider 配置 JSON 示例

```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "apiFormat": "openai",
  "enabled": true,
  "isBuiltIn": true,
  "settingsConfig": {
    "env": {
      "ANTHROPIC_BASE_URL":              "https://api.deepseek.com/v1",
      "ANTHROPIC_AUTH_TOKEN":            "sk-your-api-key-here",
      "ANTHROPIC_MODEL":                 "deepseek-v4-pro",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL":   "deepseek-v4-flash",
      "ANTHROPIC_DEFAULT_SONNET_MODEL":  "deepseek-v4-pro",
      "ANTHROPIC_SMALL_FAST_MODEL":      "deepseek-v4-flash"
    }
  },
  "capabilities": {
    "thinking": "none",
    "vision": true,
    "toolUse": true,
    "streaming": true,
    "maxTokens": 65536
  }
}
```

---

## 十、三个典型流程对比

### 流程 A：Anthropic 模型（零转换）

```
claude.exe                    ModelGateway                  api.anthropic.com
    │                             │                              │
    │── POST /v1/messages ──────→│                              │
    │   (Anthropic 原生格式)       │                              │
    │                             │── 同格式转发 ──────────────→│
    │                             │   (仅处理 thinking 兼容)       │
    │                             │                              │
    │                             │←── Anthropic SSE ──────────│
    │←── Anthropic SSE ─────────│   (透传，不做转换)              │
    │                             │                              │
```

### 流程 B：OpenAI 格式模型（DeepSeek / Doubao / Moonshot / 硅基流动...）

```
claude.exe                    ModelGateway                  api.deepseek.com
    │                             │                              │
    │── POST /v1/messages ──────→│                              │
    │   {                         │                              │
    │     model: "deepseek-v4",   │                              │
    │     messages: [             │                              │
    │       {role:"user",         │                              │
    │        content: [           │                              │
    │          {type:"image",     │                              │
    │           source:{...}}     │                              │
    │        ]}                   │                              │
    │     ],                      │                              │
    │     tools: [{               │                              │
    │       name: "Read",         │                              │
    │       input_schema: {...}   │                              │
    │     }]                      │                              │
    │   }                         │                              │
    │                             │                              │
    │                             │── anthropicToOpenAI() ──────→│
    │                             │   {                          │
    │                             │     model: "deepseek-v4",    │
    │                             │     messages: [              │
    │                             │       {role:"system", ...},  │
    │                             │       {role:"user",          │
    │                             │        content: [            │
    │                             │          {type:"image_url",  │
    │                             │           image_url: {       │
    │                             │             url:"data:       │
    │                             │              image/png;      │
    │                             │              base64,..."}}   │
    │                             │        ]}                    │
    │                             │     ],                       │
    │                             │     tools: [{                │
    │                             │       type:"function",       │
    │                             │       function: {            │
    │                             │         name:"Read",         │
    │                             │         parameters:{...}     │
    │                             │       }}]                    │
    │                             │     stream: true             │
    │                             │   }                          │
    │                             │                              │
    │                             │←── OpenAI SSE chunks ──────│
    │                             │   delta.content              │
    │                             │   delta.tool_calls           │
    │                             │   finish_reason              │
    │                             │   usage                      │
    │                             │                              │
    │                             │── SSE 事件转换 ──→           │
    │←── Anthropic SSE events ──│                               │
    │   content_block_start      │                               │
    │   content_block_delta      │                               │
    │   message_stop + usage     │                               │
```

### 流程 C：Google Antigravity（特殊处理）

```
claude.exe                    ModelGateway                  daily-cloudcode-pa.googleapis.com
    │                             │                              │
    │── POST /v1/messages ──────→│                              │
    │   (Anthropic 原生格式)       │                              │
    │                             │── Google Adapter ──────────→│
    │                             │   消息格式转换:               │
    │                             │   Anthropic Messages →       │
    │                             │   Gemini contents/parts       │
    │                             │                              │
    │                             │   OAuth token (非 API Key)    │
    │                             │                              │
    │                             │←── Gemini SSE ─────────────│
    │                             │── 反向 SSE 转换 ──→          │
    │←── Anthropic SSE events ──│                               │
```

---

## 十一、关键文件索引

| 文件（app.asar 解包后） | 功能 | 关键导出 |
|---|---|---|
| `out__main__index.js`（主 bundle） | ModelGateway 路由逻辑 | `handleGatewayRequest()`、`anthropicToOpenAI()`、`convertMessageToOpenAI()`、`logRequest()`、`calculateCost()`、`findModelPricing()` |
| `out__main__anthropic-B1AZmpwC.js` | Anthropic 原生适配器 | `parseAnthropicUsage()`、Anthropic SSE 解析器 |
| `out__main__openai-DweheQL1.js` | OpenAI 适配器 | `parseOpenAIUsage()`、Responses API 适配 |
| `out__main__google-CXmmmHhM.js` | Google Antigravity 适配器 | Gemini 格式转换、token 流式累加 |
| `out__main__custom-CNyAx999.js` | 自定义适配器 | 通用 OpenAI 兼容 API、CUA function tools |
| `newmax.db` → `model_pricing` 表 | 模型定价表 | 30+ 模型预置定价（含输入/输出/缓存价格） |
| `newmax.db` → `proxy_request_logs` 表 | API 请求审计日志 | 每个请求的 token 数、费用、延迟、状态码 |

---

## 十二、为什么这个设计"无痛"

| 痛点 | NewMax 的解决方案 | 核心价值 |
|------|------------------|---------|
| claude.exe 只认 Anthropic API 格式 | ModelGateway 做格式双向转换，claude.exe 无需任何修改 | **零侵入**——不改 claude.exe 源码 |
| 不同供应商 API 格式各异 | `apiFormat` 字段统一抽象：`anthropic` / `openai` / `responses` / `antigravity` | **多态路由**——一个字段切换全套适配逻辑 |
| 图片格式不一致 | `convertMessageToOpenAI()` 统一将 `source.base64` → `image_url.url` | 图片输入对用户透明 |
| Tool 定义格式不同 | `tools[].input_schema` → `tools[].function.parameters` | Claude Code 的 tool calling 在非 Anthropic API 上正常工作 |
| SSE 事件类型不同 | 逐 chunk 转换：`choices[].delta.content` → `content_block_delta` | 流式 UI 正常渲染 |
| 用量计费不同 | 每个 provider 有独立的 `parseXxxUsage()` + `model_pricing` 查表 | 统一计费仪表盘，用户端透明 |
| thinking/扩展思考支持参差 | `getModelCapabilities()` 预检 + `normalizeAnthropicThinking()` 自动剥离不支持的参数 | 不会因不支持的参数导致 API 400 错误 |
| max_tokens 超限 | OpenAI 400 错误时自动 `clampMaxTokensFromError()` 降级重试 | 提升成功率，减少用户感知到的错误 |
| 供应商认证方式不同（API Key vs OAuth） | env 中的 `ANTHROPIC_AUTH_TOKEN` 被适配器灵活解释为 API Key / Bearer Token / OAuth Token | 支持 Google Cloud Code 等非 API Key 认证 |
| 新供应商接入 | 只需配置 `apiFormat` + `baseUrl` + `apiKey`，无需写代码 | **配置即接入**——降低扩展成本 |

---

## 十三、架构设计启示：如何复刻这套机制

如果你要在自己的 Claude Code based agent 产品中实现类似的多供应商支持，以下是核心技术决策清单：

### 13.1 必需组件

| 组件 | 说明 | 建议实现方式 |
|------|------|-------------|
| **本地 HTTP 代理** | 在 CLI 进程和外部 API 之间插入的中间层 | Node.js `http.createServer()` 或 Go reverse proxy |
| **环境变量注入** | 将目标地址、API Key、模型名注入 CLI 子进程 | `child_process.spawn(..., {env: {...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:PORT'}})` |
| **请求格式转换器** | Anthropic Messages → OpenAI Chat Completions | 参考本文 `anthropicToOpenAI()` 实现 |
| **SSE 事件转换器** | OpenAI SSE → Anthropic SSE | 参考本文事件映射表 |
| **Usage 解析器** | 从不同供应商的响应中提取统一 token 结构 | 每个供应商一个 `parseUsage()` 函数 |
| **定价引擎** | token 数 × 价格 ÷ 1,000,000 | 预置 `model_pricing` 表 + 模糊匹配 |

### 13.2 格式转换的三个关键难点

1. **图片传输**：Anthropic 使用 `source.base64`，OpenAI 使用 `image_url.url = "data:mime;base64,..."`。两者都是 base64 但**嵌套结构不同**。需递归转换 content block 数组。

2. **Tool calling 的流式拼接**：OpenAI 的 tool_calls 通过 `index` 字段分片返回 arguments JSON 片段。需要按 index 分组并**逐个字符拼接**才能还原完整的 `input_json_delta` 流。这是最容易出 bug 的地方。

3. **System prompt 位置**：Anthropic 的 system prompt 是顶层字段，OpenAI 是 messages 数组的第一个元素。转换时需要注意 Anthropic 的 system 可能是字符串或 content block 数组。

### 13.3 扩展性设计原则

```
┌─────────────────────────────────────────────┐
│  不要为每个供应商写 if/else                  │
│  用 apiFormat 驱动多态路由                    │
│  每个 apiFormat 对应一组：                    │
│    - 请求转换函数                             │
│    - 响应转换函数                             │
│    - Usage 解析函数                           │
│    - 认证方式                                 │
│    - 模型能力声明                             │
└─────────────────────────────────────────────┘
```

新增一个 OpenAI 兼容供应商的步骤：

1. 在 Provider 配置表中添加一行：`{apiFormat: "openai", baseUrl: "https://api.xxx.com/v1", apiKey: "sk-xxx"}`
2. 在 `model_pricing` 表中添加该模型的定价信息
3. 如果模型不支持某些能力（thinking、vision），在 capabilities 中标注
4. **不需要写任何转换代码**——因为 `apiFormat: "openai"` 已注册了全套转换逻辑

---

## 附录：完整 SSET 事件类型对照表

### Anthropic SSE 事件类型（claude.exe 期待接收的）

| 事件类型 | JSON 数据 | 说明 |
|---------|----------|------|
| `message_start` | `{"type":"message_start","message":{"id":"...","model":"...","role":"assistant"}}` | 消息开始 |
| `content_block_start` | `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}` | 文本块开始 |
| `content_block_start` | `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"...","name":"..."}}` | 工具调用块开始 |
| `content_block_delta` | `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}` | 文本增量 |
| `content_block_delta` | `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"..."}}` | 工具参数增量 |
| `content_block_stop` | `{"type":"content_block_stop","index":0}` | 块结束 |
| `message_delta` | `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":...,"output_tokens":...}}` | 消息增量（含 usage） |
| `message_stop` | `{"type":"message_stop"}` | 消息结束 |

### OpenAI SSE Chunk 类型（上游返回的）

| JSON 路径 | 示例值 | 说明 |
|----------|--------|------|
| `object` | `"chat.completion.chunk"` | 固定值 |
| `choices[0].delta.role` | `"assistant"` | 角色声明（首个 chunk） |
| `choices[0].delta.content` | `"你好，我来帮你..."` | 文本增量 |
| `choices[0].delta.tool_calls[0].id` | `"call_abc123"` | 工具调用 ID |
| `choices[0].delta.tool_calls[0].function.name` | `"Read"` | 工具名 |
| `choices[0].delta.tool_calls[0].function.arguments` | `"{\"file_path\":\"..."` | 工具参数 JSON 片段 |
| `choices[0].finish_reason` | `"stop"` / `"tool_calls"` / `"length"` | 结束原因 |
| `usage` | `{"prompt_tokens":100,"completion_tokens":50}` | 用量统计（最终 chunk） |

---

> **文档版本**: v1.0
> **分析对象**: NewMax v1.1.5（安装目录 `E:\NewMax\NewMax AI - 副本 - 1.1.5`）
> **分析方法**: app.asar 源码解包 + 数据库 schema 逆向 + Provider 配置交叉验证
> **产出日期**: 2026-07-21
