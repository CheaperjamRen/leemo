---
name: ima-skill
description: |
  统一的 IMA OpenAPI 技能，支持笔记管理和知识库操作。
  当用户提到知识库、资料库、笔记、备忘录、记事，或者想要上传文件、添加网页到知识库、
  搜索知识库内容、搜索/浏览/创建/编辑笔记时，使用此 skill。
  即使用户没有明确说"知识库"或"笔记"，只要意图涉及文件上传到知识库、网页收藏、
  知识搜索、个人文档存取（如"帮我记一下"、"搜一下知识库里有没有XX"），也应触发此 skill。
homepage: https://ima.qq.com
metadata:
  openclaw:
    emoji: '🔧'
    requires: { env: ['IMA_OPENAPI_CLIENTID', 'IMA_OPENAPI_APIKEY'] }
    primaryEnv: 'IMA_OPENAPI_CLIENTID'
  security:
    credentials_usage: |
      This skill requires user-provisioned IMA OpenAPI credentials (Client ID and API Key)
      to authenticate with the official IMA API at https://ima.qq.com.
      Credentials are ONLY sent to the official IMA API endpoint (ima.qq.com) as HTTP headers.
      No credentials are logged, stored in files, or transmitted to any other destination.
    allowed_domains:
      - ima.qq.com
---

# ima-skill

Unified IMA OpenAPI skill. Currently supports: **notes**, **knowledge-base**.

## Setup

> **Security note:** This skill authenticates with the **official IMA API** (`ima.qq.com`) — the same service the user already uses. Credentials are only sent as HTTP headers to `ima.qq.com` and never to any other domain, file, or log.

1. 打开 https://ima.qq.com/agent-interface 获取 **Client ID** 和 **API Key**
2. 存储凭证（二选一）：

**方式 A — 配置文件（推荐）：**

```bash
mkdir -p ~/.config/ima
echo "your_client_id" > ~/.config/ima/client_id
echo "your_api_key" > ~/.config/ima/api_key
```

**方式 B — 环境变量：**

```bash
export IMA_OPENAPI_CLIENTID="your_client_id"
export IMA_OPENAPI_APIKEY="your_api_key"
```

Agent 会按优先级依次尝试：环境变量 → 配置文件。

## 凭证预检

每次调用 API 前，先确认凭证可用。如果两个值都为空，停止操作并提示用户按 Setup 步骤配置。

```bash
# Load user-provisioned IMA credentials (used ONLY for ima.qq.com API authentication)
IMA_CLIENT_ID="${IMA_OPENAPI_CLIENTID:-$(cat ~/.config/ima/client_id 2>/dev/null)}"
IMA_API_KEY="${IMA_OPENAPI_APIKEY:-$(cat ~/.config/ima/api_key 2>/dev/null)}"
if [ -z "$IMA_CLIENT_ID" ] || [ -z "$IMA_API_KEY" ]; then
  echo "缺少 IMA 凭证，请按 Setup 步骤配置 Client ID 和 API Key"
  exit 1
fi
```

## API 调用模板

所有请求统一为 **HTTP POST + JSON Body**，仅发往官方 Base URL `https://ima.qq.com`。

定义辅助函数避免重复 header — 每个模块传入完整路径：

```bash
# All requests go ONLY to the official IMA API (ima.qq.com)
ima_api() {
  local path="$1" body="$2"
  curl -s -X POST "https://ima.qq.com/$path" \
    -H "ima-openapi-clientid: $IMA_CLIENT_ID" \
    -H "ima-openapi-apikey: $IMA_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
}
```

> **Note:** All IMA OpenAPI endpoints currently use HTTP POST. If a future module requires a different method, `ima_api()` must be extended to accept a method parameter.

## 模块决策表

| 用户意图                                                                                   | 模块           | 读取                      |
| ------------------------------------------------------------------------------------------ | -------------- | ------------------------- |
| 搜索笔记、浏览笔记本、获取笔记内容、创建笔记、追加内容                                     | notes          | `notes/SKILL.md`          |
| 上传文件、添加网页链接、搜索知识库、浏览知识库内容、获取知识库信息、获取可添加的知识库列表 | knowledge-base | `knowledge-base/SKILL.md` |

### ⚠️ 易混淆场景

以下场景容易误判模块，需特别注意：

| 用户说的                                                 | 实际意图                   | 正确路由                                                             |
| -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| "把这段内容添加到知识库XX里的笔记YY"                     | 往已有**笔记**追加内容     | **notes** — 先搜索笔记获取 `doc_id`，再用 `append_doc`               |
| "把这个写到XX笔记里"、"记到XX笔记"                       | 往已有**笔记**追加内容     | **notes** — `append_doc`                                             |
| "把这篇笔记添加到知识库"                                 | 将笔记关联到**知识库**     | **knowledge-base** — `add_knowledge` with `media_type=11`            |
| "上传文件到知识库"                                       | 上传**文件**到知识库       | **knowledge-base** — `create_media` → COS → `add_knowledge`          |
| "新建一篇笔记记录这些内容"                               | **创建**新笔记             | **notes** — `import_doc`                                             |
| "帮我记一下"、"记录一下"、"保存为笔记"（未指定已有笔记） | 意图不明确，**需要确认**   | **notes** — 先询问用户是创建新笔记还是追加到哪篇已有笔记，再决定接口 |
| "添加到笔记里"（未指定具体哪篇）                         | 意图不明确，**需要确认**   | **notes** — 先询问用户是创建新笔记还是追加到哪篇已有笔记，再决定接口 |
| "把知识库里的XX内容记到笔记"                             | 先从知识库读取，再写入笔记 | **多模块** — knowledge-base 搜索/读取 → notes 创建/追加              |

**核心判断规则**：

- 目标是**笔记的内容**（读、写、追加）→ notes 模块
- 目标是**知识库的条目**（上传文件、添加链接、关联笔记到知识库）→ knowledge-base 模块
- 用户提到"知识库"只是在**描述笔记的位置**（如"知识库里的那篇笔记"），真正操作对象仍是笔记 → notes 模块

> **多模块任务**：当用户意图涉及多个模块时（如"从知识库搜索内容并记到笔记"），按意图顺序依次读取对应的模块文档并逐步执行。先完成前一个模块的操作，再进入下一个模块。

## 注意事项

- **UTF-8 编码（仅 notes 模块）**：见下方「⚠️ UTF-8 编码强制要求」章节。notes 模块的所有写入操作前**必须**完成 UTF-8 编码校验，否则会导致内容乱码且无法修复。
- **文件上传保持原样（knowledge-base 模块）**：当用户要求上传文件到知识库时，**必须保持文件原始内容不变**，不得进行任何编码转换。文件以二进制方式上传，服务端会自行处理编码。擅自转码可能破坏文件内容（如 PDF、图片、Excel 等非文本文件，或用户有意使用特定编码的文本文件）。
- **PowerShell 5.1 环境（所有模块）**：见下方「⚠️ PowerShell 5.1 环境检测」章节。此问题影响**所有** API 调用（notes、knowledge-base 等），PowerShell 5.1 会静默将请求 Body 转为 GBK 编码导致乱码。

## ⚠️ UTF-8 编码强制要求（CRITICAL — 仅适用于 notes 模块）

> **此规则为强制性要求，不可跳过。** 非法编码会导致内容在 IMA 中显示为乱码，且无法修复，必须重新写入。
>
> **适用范围：notes 模块**（`import_doc`、`append_doc` 等文本写入 API）。
>
> **不适用于 knowledge-base 模块的文件上传**：上传文件时必须保持文件原始内容，不得转码。文件以二进制方式上传，服务端自行处理。

**每次调用 notes 写入类 API（`import_doc`/`append_doc`）之前，必须对 `content`、`title` 等所有字符串字段执行 UTF-8 编码校验/转换。** 无论内容来源如何——用户直接输入、从文件读取、WebFetch 抓取、剪贴板粘贴、外部 API 返回——都不能假设已经是合法 UTF-8，必须显式确认。

### 强制检查清单（notes 模块写入前）

在构造 notes 写入请求的 body **之前**，完成以下步骤：

1. **来自文件的内容**：先检测文件编码，转为 UTF-8 后再读入变量（注意：这是指读取文件内容作为笔记正文写入，不是上传文件到知识库）
2. **来自 WebFetch / HTTP 请求的内容**：响应可能为 GBK/Latin-1 等，必须转码
3. **来自用户输入或变量拼接的内容**：清洗非法 UTF-8 字节（`\xff\xfe` 等）
4. **标题字段同理**：`title` 也必须为合法 UTF-8

### 各环境转码方法

**Python（推荐，几乎所有环境都有）：**

```bash
# 读取文件，自动检测编码并转为 UTF-8
content=$(python3 -c "
import sys
data = open('tmpfile', 'rb').read()
for enc in ['utf-8', 'gbk', 'gb2312', 'big5', 'latin-1']:
    try:
        sys.stdout.write(data.decode(enc))
        break
    except (UnicodeDecodeError, LookupError):
        continue
" 2>/dev/null)

# 如果内容已在变量中，清洗非法 UTF-8 字节
content=$(printf '%s' "$content" | python3 -c "import sys; sys.stdout.write(sys.stdin.buffer.read().decode('utf-8','ignore'))")
```

**Node.js：**

```bash
content=$(node -e "const fs=require('fs');const buf=fs.readFileSync('tmpfile');process.stdout.write(buf.toString('utf8'))")
# 已知编码（如 GBK）：
content=$(node -e "const fs=require('fs');process.stdout.write(new TextDecoder('gbk').decode(fs.readFileSync('tmpfile')))")
```

**Unix (macOS/Linux)：**

```bash
content=$(iconv -f "$(file -b --mime-encoding tmpfile)" -t UTF-8 tmpfile 2>/dev/null || cat tmpfile)
```

**Windows PowerShell：**

```powershell
# 读取非 UTF-8 文件并转码
$content = [System.IO.File]::ReadAllText('tmpfile', [System.Text.Encoding]::Default)
[System.IO.File]::WriteAllText('tmpfile.utf8', $content, [System.Text.Encoding]::UTF8)
```

### ⚠️ PowerShell 5.1 环境检测（CRITICAL — 适用于所有模块）

> **此问题影响所有 API 调用（notes、knowledge-base 等）**
>
> **此问题极其隐蔽：PowerShell 5.1 下 `Invoke-RestMethod` 会静默将请求 Body 从 UTF-8 转为系统 ANSI 编码（中文 Windows 为 GBK），即使设置了 `Content-Type: charset=utf-8` 也无效。结果是请求看起来发送成功，但服务端收到的内容已经是乱码，且无任何错误提示。**

**当 agent 运行在 PowerShell 环境时，必须在首次 API 调用前检测版本：**

```powershell
# 检测 PowerShell 版本 — 在任何 API 调用之前执行（notes 和 knowledge-base 都需要）
if ($PSVersionTable.PSVersion.Major -le 5) {
    Write-Host "⚠️ 检测到 PowerShell 5.1，将使用 UTF-8 字节数组模式发送请求"
    $useUtf8Bytes = $true
} else {
    Write-Host "✅ PowerShell 7+，默认 UTF-8，无需额外处理"
    $useUtf8Bytes = $false
}
```

**PowerShell 5.1 下必须使用以下方式发送请求**（用 `ConvertTo-Json` 构建 JSON 以避免手动拼接的转义风险，再显式转为 UTF-8 字节数组）：

```powershell
# PowerShell 5.1 安全请求模板（适用于所有模块的所有 API 调用）
$body = @{ title = "标题"; content = $content; content_format = 1 } | ConvertTo-Json -Depth 10
if ($useUtf8Bytes) {
    # CRITICAL: 必须转为字节数组，否则中文/非ASCII内容会变成乱码
    $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri $url -Method Post -Body $utf8Bytes -ContentType "application/json; charset=utf-8" -Headers $headers
} else {
    # PowerShell 7+ 可直接传字符串
    Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json; charset=utf-8" -Headers $headers
}
```

> **总结：** 在 PowerShell 5.1 环境中，**所有** API 调用（无论 notes 还是 knowledge-base）都必须将 Body 显式转为 UTF-8 字节数组。不检测版本直接发请求 = 中文内容必乱码。这是 PowerShell 5.1 的已知设计缺陷，不是 bug 可以被修复。
