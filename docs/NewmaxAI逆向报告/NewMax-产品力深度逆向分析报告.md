# NewMax 产品力深度逆向分析报告

> **分析对象**：NewMax v1.1.5（安装目录 `E:\NewMax\NewMax AI - 副本 - 1.1.5`，工作区 `C:\Users\Example\.newmax`）
> **分析日期**：2026-07-20
> **分析目标**：为制作基于 Claude Code 的 Agent 产品提供事无巨细的技术参考

---

## 一、概述与总体架构

### 1.1 产品定位

NewMax 是一款**桌面端 AI 工作助手**，运行在 Electron 壳内，底层引擎为 Anthropic 的 Claude Agent SDK（`claude.exe` 原生二进制）。它不自研 AI 能力，而是通过"壳 + 引擎"的架构，将 Claude Code 的 Agent 能力封装为面向普通用户的桌面应用。

**核心公式**：`Electron 壳 + Claude Agent SDK + 9 个原生 Node 模块 + Skill 生态 = NewMax`

### 1.2 五层架构模型

```
┌─────────────────────────────────────────────────────┐
│                    表现层 (Presentation)              │
│  React UI · 主题系统 · 快捷键 · 托盘 · 语音输入       │
│  多对话管理 · 交互式可视化 · 桌面宠物                   │
├─────────────────────────────────────────────────────┤
│                    应用层 (Application)               │
│  工作区管理 · 长期项目 · 任务调度 · 浏览器自动化        │
│  每日回顾 · 对话搜索 · 通知系统 · 设置中心              │
├─────────────────────────────────────────────────────┤
│                    能力层 (Capability)                │
│  Skill 系统 · MCP 工具集成 · 图像生成                  │
│  网络搜索 · 代码执行 · 数据存储 · 文件监控              │
├─────────────────────────────────────────────────────┤
│                    核心层 (Core)                      │
│  Claude Agent SDK (claude.exe) · 对话引擎              │
│  工具调用调度 · 上下文管理 · 权限控制                   │
├─────────────────────────────────────────────────────┤
│                    系统层 (System)                    │
│  Electron · Node.js · SQLite · node-pty               │
│  sherpa-onnx · uiohook-napi · @parcel/watcher        │
│  skill-guard · better-sqlite3                         │
└─────────────────────────────────────────────────────┘
```

### 1.3 数据流

```
用户输入 → Electron Renderer (React UI)
    → IPC → Electron Main Process
    → Claude Agent SDK (claude.exe 子进程)
    → 工具调用 (Bash/Read/Write/WebFetch/WebSearch 等)
    → 结果流式返回 → UI 渲染
```

关键设计：Claude Agent SDK 以**子进程**方式运行，通过进程间通信（stdio/pipe）与 Electron 主进程交互。这种架构实现了 AI 引擎与 UI 壳的彻底解耦。

---

## 二、技术栈深度分析

### 2.1 基础框架

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| 桌面壳 | Electron | 含 Chromium 渲染引擎（chrome_100_percent.pak, d3dcompiler_47.dll, ffmpeg.dll, libEGL.dll, libGLESv2.dll） |
| UI 框架 | React（推测） | 从 app.asar 打包方式推断 |
| 构建 | electron-builder | 生成 app.asar + app-update.yml |
| AI 引擎 | `@anthropic-ai/claude-agent-sdk` | v0.3.198，含原生 `claude.exe` 二进制 |
| 运行时 | Node.js (Electron 内置) | 支持 N-API 原生模块 |
| 数据库 | SQLite | 通过 `better-sqlite3` 原生模块直接嵌入 |

### 2.2 9 个关键原生模块（N-API / Node Addon）

这些 `.node` 文件是 NewMax 区别于纯 Web 应用的核心竞争力——它们解锁了浏览器沙箱无法触及的系统能力：

| # | 模块 | 文件 | 用途 | 产品意义 |
|---|------|------|------|----------|
| 1 | **better-sqlite3** | `better_sqlite3.node` | 嵌入式 SQLite 数据库引擎 | 所有对话数据本地存储，零网络依赖，隐私核心保障 |
| 2 | **node-pty** | `pty.node` + `conpty.node` + `conpty_console_list.node` | 伪终端 (PTY) / Windows ConPTY | 内置终端（最多 9 个会话），支持交互式 CLI 程序 |
| 3 | **sherpa-onnx** | `sherpa-onnx.node` | 本地语音识别（ONNX Runtime） | 离线语音输入，无需联网，隐私保护 |
| 4 | **uiohook-napi** | `node.napi.node` | 全局键盘/鼠标钩子 | 系统级快捷键（Command+W 唤起小窗等），即使应用不在前台也能响应 |
| 5 | **@parcel/watcher** | `watcher.node` | 高性能文件系统监控 | 工作区文件变更实时感知，跨平台（Windows/Inotify/FSEvents） |

### 2.3 三项核心技术决策

#### 决策一：用 claude.exe 子进程而非 SDK 直接调用

**实现方式**：`@anthropic-ai/claude-agent-sdk-win32-x64` 包内含 `claude.exe` 原生二进制（v0.3.198），NewMax 通过 spawn 子进程方式调用，用 stdio 传递 JSON-RPC 消息。

**为什么好**：
- **进程隔离**：AI 引擎崩溃不影响 UI 壳稳定性
- **升级独立**：claude.exe 可独立更新，无需重新打包整个 Electron 应用
- **权限沙箱**：子进程可设置独立的文件系统和网络权限

#### 决策二：app.asar.unpacked 存放原生模块

**实现方式**：Electron 的 asar 归档不支持原生 `.node` 文件，NewMax 通过 `asar.unpacked` 机制将 5 个原生模块及 `claude.exe` 排除在 asar 压缩之外，保持文件系统直接访问。

**目录结构**：
```
resources/
├── app.asar                          # 打包的 JS/CSS/HTML
└── app.asar.unpacked/
    └── node_modules/
        ├── @anthropic-ai/claude-agent-sdk/  # claude.exe 在此
        ├── better-sqlite3/                  # SQLite 原生模块
        ├── node-pty/                        # PTY 原生模块
        ├── sherpa-onnx-win-x64/             # 语音识别
        ├── uiohook-napi/                    # 键盘钩子
        ├── @parcel/watcher/                 # 文件监控
        └── @yangyixxxx/skill-guard/         # 安全扫描器
```

#### 决策三：多数据库分库设计

**实现方式**：不是一个大而全的数据库，而是按职责拆分：

| 数据库文件 | 职责 | 路径 |
|-----------|------|------|
| `newmax.db` | 核心数据：对话、设置、工作区 | `~/.newmax/newmax.db` |
| `skill-ledger.db` | Skill 安装/卸载/版本/来源 | `~/.newmax/skill-ledger.db` |
| `hermes-tasks.db` | 长期项目任务管理 | `~/.newmax/hermes-tasks.db` |
| `scheduled-tasks.db` | 定时任务（单次/每天/每周） | `~/.newmax/scheduled-tasks.db` |

**为什么好**：各模块独立迁移/备份/重置，互不干扰；skill-ledger 可单独清空重建而不影响对话数据。

---

## 三、系统架构分层详解

### 3.1 安装目录结构

```
E:\NewMax\NewMax AI - 副本 - 1.1.5\
├── NewMax.exe                    # Electron 主入口
├── chrome_100_percent.pak        # Chromium UI 资源（1x）
├── chrome_200_percent.pak        # Chromium UI 资源（2x/HiDPI）
├── d3dcompiler_47.dll            # Direct3D 着色器编译
├── ffmpeg.dll                    # 音视频编解码
├── icudtl.dat                    # Unicode/国际化数据
├── libEGL.dll                    # OpenGL ES 接口
├── libGLESv2.dll                 # OpenGL ES 2.0 接口
├── locales\                      # 65 种语言包 (.pak)
│   ├── zh-CN.pak                 # 简体中文
│   ├── en-US.pak                 # 英文
│   └── ... (63 more)
└── resources\
    ├── app-update.yml            # 更新配置（七牛 S3）
    ├── app.asar                  # 打包的应用代码
    └── app.asar.unpacked\        # 未打包的原生依赖
        └── node_modules\
            ├── @anthropic-ai/claude-agent-sdk\  # AI 引擎
            ├── better-sqlite3\                  # 数据库
            ├── node-pty\                        # 终端
            ├── sherpa-onnx-win-x64\             # 语音
            ├── uiohook-napi\                    # 快捷键
            ├── @parcel/watcher\                 # 文件监控
            └── @yangyixxxx/skill-guard\         # 安全扫描
```

### 3.2 工作区目录结构（`~/.newmax/`）

```
C:\Users\Example\.newmax\
├── newmax.db                     # 主数据库（对话/设置）
├── skill-ledger.db               # Skill 安装台账
├── hermes-tasks.db               # 长期项目管理
├── scheduled-tasks.db            # 定时任务
├── workspace\                    # 用户工作区
│   ├── conversations\            # 对话附件（按 conv-id 目录）
│   │   └── conv-{timestamp}\
│   │       ├── images\           # 生成/上传的图片
│   │       └── *.md / *.txt      # 对话中产出的文件
│   ├── projects\                 # 长期项目文件
│   │   └── proj-{id}\
│   │       ├── project.md        # 项目主文档
│   │       ├── memory\           # 项目记忆
│   │       ├── outputs\          # 任务产出
│   │       └── references\       # 参考资料
│   └── archived-projects\        # 归档项目
├── skills\                       # 已安装 Skill（50+）
│   ├── algorithmic-art\
│   ├── baoyu-*\                  # 第三方 Skills
│   ├── brand-guidelines\
│   ├── canvas-design\
│   └── ... (50+ skills)
└── chrome-profiles\              # 浏览器自动化 Profile
    ├── bp-default\               # 默认浏览器 Profile
    │   └── Default\
    │       ├── Extensions\       # Chrome 扩展
    │       └── ...
    └── chat-default\             # 对话中浏览器 Profile
```

### 3.3 进程通信架构

```
┌───────────────────────────────────────────────┐
│               Electron Main Process            │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Skill    │  │ 更新管理   │  │ 数据库访问  │  │
│  │ 管理器   │  │ (七牛S3)  │  │ (SQLite)   │  │
│  └──────────┘  └───────────┘  └────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │     Claude Agent Bridge (IPC Server)      │  │
│  │          ↓ stdio/pipe ↓                   │  │
│  │     claude.exe (子进程)                    │  │
│  └──────────────────────────────────────────┘  │
│         ↕ IPC (contextBridge)                  │
├───────────────────────────────────────────────┤
│           Electron Renderer Process            │
│  ┌──────────────────────────────────────────┐  │
│  │           React UI                        │  │
│  │  对话界面 · 侧栏 · 设置 · 工作区视图       │  │
│  └──────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

---

## 四、核心功能体系

### 4.1 功能全景（8 大模块）

```
NewMax 功能体系
├── 1. AI 对话
│   ├── 多对话管理（标签页 + 侧栏列表）
│   ├── 自动总结标题
│   ├── 附件上传（图片/文件）
│   ├── 扩展思考过程展示
│   ├── 工具调用可视化
│   ├── 代码执行（沙箱）
│   ├── 网络搜索集成
│   ├── 交互式可视化（HTML/CSS/JS 沙箱）
│   ├── 对话导出（Markdown/图片）
│   ├── 对话搜索（全文）
│   ├── 收藏/归档/分组
│   ├── 复制对话到分屏
│   ├── 规划模式 (/plan)
│   ├── 目标模式 (/goal)
│   ├── 上下文压缩 (/compact)
│   └── 桌面宠物 (/pet)
├── 2. 长期项目
│   ├── 项目创建（支持拖拽对话转项目）
│   ├── 任务拆解与看板
│   ├── 自动排期与执行
│   ├── 任务依赖管理
│   ├── 项目文件管理（分屏预览）
│   ├── 项目技能绑定
│   └── 通知频道（IM 推送 + 系统通知）
├── 3. 工作区 & 终端
│   ├── 多工作区（改名/换路径/迁移文件/图标）
│   ├── 内置终端（最多 9 个会话）
│   ├── 定时任务（单次/每天/每周 + IM 通知）
│   ├── 跨工作区全文搜索
│   └── 侧栏/文件列表宽度可调
├── 4. Skill 管理
│   ├── 一键安装/卸载
│   ├── 覆盖更新（本地 ZIP/文件夹）
│   ├── Skill 市场浏览
│   ├── 斜杠命令 (/skill-name)
│   └── 安全扫描（安装前自动检测）
├── 5. 模型管理
│   ├── 15+ AI 提供商
│   ├── NewMax Gateway（内置充值/余额）
│   ├── ChatGPT/Gemini/Grok OAuth 登录
│   ├── OpenCode Go API Key
│   ├── 图像生成模型配置
│   ├── 智能路由与故障转移
│   ├── 上下文窗口统计（圆环显示）
│   └── Ollama 本地模型
├── 6. 浏览器自动化
│   ├── Chrome CDP 集成
│   ├── 多 Profile 身份管理
│   ├── 操作录制 → 可复用 Workflow
│   ├── 变量标记 + 参数编辑器
│   ├── 一键回放执行
│   └── 卡点人工接管（验证码/登录）
├── 7. AI 洞察
│   ├── 每日工作回顾
│   ├── 深度项目分析
│   ├── 双栏 Tab 视图
│   └── IM 多渠道通知
└── 8. 设置 & 个性化
    ├── 5 种精选主题 + 随机 + 自定义
    ├── 深浅模式
    ├── 提示词配置
    ├── 语音模型下载
    ├── 网络代理（自动白名单）
    ├── 数据备份/导出
    └── 保留标签页/阻止休眠
```

### 4.2 多层入口设计

NewMax 设计了**多层级入口**，让用户在不同场景下都能快速触达 AI：

| 层级 | 入口 | 触发方式 | 场景 |
|------|------|----------|------|
| 全局层 | 快速唤起小窗 | `Command+W`（可自定义） | 任何应用中随时调出，轻量输入 |
| 应用层 | 主窗口 | 点击托盘/Dock/任务栏 | 完整功能，多对话管理 |
| 上下文层 | 斜杠命令 | `/skill-name` | 对话内快速调用 Skill |
| 文件层 | `@` 文件引用 | 在小窗或对话中输入 `@` | 快速引用工作区文件 |
| 系统层 | 系统通知 | AI 发问询 / 定时任务完成 | 不在应用中也能收到提醒 |
| 桌面层 | 桌面宠物 | `/pet` 或快捷键 | 可视化 AI 状态指示 |

---

## 五、Skill 技能系统（最强护城河）

### 5.1 Skill 规范

Skill 采用 **Markdown Frontmatter + 指令正文** 的标准格式：

```markdown
---
name: algorithmic-art
description: Creating algorithmic art using p5.js...
license: Complete terms in LICENSE.txt
---

## ALGORITHMIC PHILOSOPHY CREATION
... (指令正文，纯 Markdown)
```

**关键字段**：
- `name`：唯一标识，用于安装/卸载/调用
- `description`：一行描述，用于触发匹配和在市场中展示
- `license`：许可证信息
- 正文：系统提示注入内容，直接扩展 AI 的行为能力

### 5.2 文件结构（标准布局）

```
skill-name/
├── SKILL.md              # 核心指令（必选）
├── scripts/              # 可执行脚本（可选）
├── references/           # 参考文档（可选，按需加载）
├── templates/            # 模板文件（可选）
├── assets/               # 静态资源（可选）
└── prompts/              # 提示词模板（可选）
```

### 5.3 三层渐进加载机制

这是 NewMax Skill 系统最精妙的设计——不是一次性把整个 Skill 目录塞进上下文，而是按需加载：

| 层级 | 加载时机 | 内容 | 设计意图 |
|------|----------|------|----------|
| **L1 元数据** | 启动时 | `name` + `description`（SKILL.md frontmatter） | 建立 Skill 索引，判断触发匹配 |
| **L2 核心指令** | Skill 被触发时 | SKILL.md 正文 | 注入系统提示，赋予 AI 特定能力 |
| **L3 参考文档** | AI 需要时 | `references/` 目录下的 Markdown 文件 | 按需读取详细说明，不浪费上下文窗口 |

**设计精妙之处**：
- 安装 50 个 Skill 不会撑爆系统提示（只加载 L1 元数据）
- 触发时才加载 L2 核心指令（精确注入）
- 参考资料按需读取（AI 主动调用 Read 工具）
- 大文件 Skill（如 `baoyu-comic` 有 30+ 参考文件）不影响性能

### 5.4 安全机制（skill-guard）

NewMax 在安装任何 Skill 之前，会运行 `@yangyixxxx/skill-guard`（v0.1.0）进行静态安全扫描。

**架构**：
- **纯静态分析**，无需 LLM 参与，<2 秒完成扫描
- **本机运行**，不上传 Skill 内容到云端
- **规则驱动**：70+ 条 YAML 规则，覆盖 9 个安全维度

**规则分类体系**：

| 类别 | 文件 | 规则数 | 典型检测 |
|------|------|--------|----------|
| 🔴 硬触发器 | `hard-triggers.yaml` | 20 条 | `rm -rf /`、`curl \| sh`、reverse shell、powershell 编码执行、sudoers 修改、SSH key 植入 |
| 🟠 命令注入 | `cmd-injection.yaml` | 10 条 | `eval()`、`exec()`、`os.system`、`shell=True`、跨语言 exec |
| 🟠 密钥泄露 | `secrets.yaml` | 8 条 | 私钥、API Key、AWS Key、GitHub Token、JWT、数据库连接串、熵值检测 |
| 🟡 网络行为 | `network.yaml` | 10 条 | DNS 外泄、ICMP 原始套接字、Scapy、FTP、WebSocket |
| 🟡 持久化 | `persistence.yaml` | 3 条 | crontab、注册表 Run Key、schtasks |
| 🟡 敏感文件 | 内嵌在 common.yaml | 8 条 | SSH 密钥、AWS 凭证、Chrome 登录数据、Firefox 登录 |
| 🟢 权限 | 内嵌在 common.yaml | 2 条 | sudo、chmod 777 |
| 🟢 其他 | 内嵌在 common.yaml | 10 条 | pickle、yaml unsafe load、ctypes、动态导入 |
| ⚪ 白名单 | `whitelist/` | npm/pypi/cargo | 知名包不误报 |

**检测创新**：
- **熵值检测**：API Key 等敏感值使用 `minValueEntropy` 参数，要求至少 3.5 bits/char，过滤掉占位符如 `your-key-here`
- **排除模式**：`excludeValuePattern` 字段排除 `$ENV`、`<placeholder>`、`TODO` 等
- **双上下文**：区分 `context: exec`（代码中的危险调用）vs `context: mention`（文档中的提及，权重=0）
- **扩展名过滤**：语言特定规则仅在匹配文件扩展名时触发

### 5.5 Skill 生命周期

```
安装 → 安全扫描 → 注册元数据 → 存入库表
    → 用户触发（/skill 或 自然语言匹配）
    → 注入 SKILL.md 到系统提示
    → AI 执行（可读取 references/ 参考资料）
    → 调用 scripts/ 中的脚本（如有）
卸载 → 删除文件 + 清理库表
更新 → 覆盖安装（自动清理旧文件，不残留）
```

---

## 六、MCP 工具集成

### 6.1 6 个内置 MCP 服务器

NewMax 通过 MCP（Model Context Protocol）将系统能力暴露给 AI：

| MCP 服务器 | 核心工具 | 用途 |
|------------|----------|------|
| **skill-handler** | `Skill(skill, args)` | Skill 调用调度 |
| **ask-user** | `ask_user(questions)` | 向用户发起结构化问询（卡片 UI） |
| **image-generation** | `generate_image(prompt, ...)` | 图片生成（对接已配置的生图模型） |
| **vision-fallback** | `describe_image(path)` | 辅助识图兜底 |
| **visualization** | `create_visualization(file, html)` / `read_visualization(file)` | 交互式可视化创建与读取 |
| **web-search** | `web_search(query, ...)` | 联网搜索 |
| **convert-to-project** | `convert_to_project(title, ...)` / `create_tasks / update_task / mark_task_done / ...` | 对话转长期项目 |

### 6.2 工具调用纪律（强制规则）

NewMax 的系统提示中包含严格的**工具调用纪律**，防止 AI 的"幻觉行为"：

1. **文件操作必须通过 tool_use**：禁止在纯文本里描述工具执行过程
2. **禁止幻觉信号**：检测并禁止 AI 说"我已用 Write 写入 xxx"但实际未调用工具
3. **验证必须落地**：任何声称的落盘结果必须先 `Bash ls` 或 `Read` 确认
4. **路径溯源**：每轮系统检查 `existsSync` 验证 AI 声称的文件路径

这是**防幻觉的最后一道防线**，也是 NewMax 相比原始 Claude Code 在产品化上最重要的增强之一。

---

## 七、产品/UI/UX 设计

### 7.1 设计理念

NewMax 的 UI/UX 遵循以下设计原则：

1. **降低认知负荷**：上下文窗口圆环可视化、自动标题总结、消息跳转
2. **无缝上下文切换**：快速唤起小窗（全局 Command+W）、分屏对话、拖拽排序
3. **渐进式功能暴露**：核心功能入口明显，高级功能通过设置/Skill 渐进发现
4. **中文优先**：系统提示、错误信息、帮助文档全面中文化

### 7.2 交互设计亮点

| 设计 | 实现方式 | 为什么好 |
|------|----------|----------|
| **上下文圆环** | 实时显示当前对话的 token 占用比例 | 用户直观感知"还剩多少空间"，避免对话突然中断 |
| **工具调用动画** | AI 调用工具时展示折叠卡片，实时展开 | 透明化 AI 的内部执行过程，建立信任 |
| **问询卡片** | AI 需要确认时弹出结构化选项卡片 | 比纯文本问句效率高 10 倍（点一下 vs 打字回复） |
| **对话拖拽转项目** | 侧栏对话拖到"长期放养"区域 | 零摩擦的意图转换，不需要重新描述需求 |
| **工作区 Tab 拖拽排序** | 文件和对话标签页可拖拽 | 灵活组织工作空间，符合直觉 |
| **小窗 @ 文件引用** | 在快速唤起窗口输入 `@` 选文件 | 减少窗口切换，在任何应用中都能快速操作 |
| **交互式可视化** | AI 生成的 HTML 组件嵌入回复 | 数据探索、参数调节无需离开对话 |
| **通知分级** | 系统通知 + 应用内 toast | 后台对话问询不会错过，非当前对话也能感知 |

### 7.3 设置体系

NewMax 的设置采用**左侧导航 + 右侧内容**的经典布局，分为：

- **通用**：语言、启动行为、快捷键、保留标签页、阻止休眠
- **模型**：提供商配置、API Key 管理、图像生成模型、智能路由
- **主题**：5 种精选预设 + 随机 + 自定义（色相/纯度/对比度微调）
- **AI 洞察**：每日回顾时间、回顾模块选择、IM 通知渠道多选
- **搜索服务**：网络搜索配置
- **网络代理**：HTTP 代理 + 自动白名单
- **数据**：备份/导出/恢复
- **语音**：语音模型下载
- **账户**：用户信息

### 7.4 主题系统

主题系统支持：
- **5 种精选颜色主题**（预设）
- **随机配色**
- **自定义**：选一个主题色 → 自动生成完整主题 → 纯度和无障碍对比度微调
- **深浅模式切换**
- **CSS 自定义属性体系**：`--ds-space-*`、`--viz-*` 等 Design Token

---

## 八、安全机制

### 8.1 五层安全架构

```
Layer 1: Skill 安装前安全扫描（skill-guard 70+ 规则）
Layer 2: 工具调用执行前权限检查（文件/网络/进程）
Layer 3: 沙箱代码执行（交互式可视化隔离沙箱）
Layer 4: 本地数据加密（SQLite 本地存储，不上传服务器）
Layer 5: 网络代理控制（自动白名单 + 用户配置）
```

### 8.2 skill-guard 深度分析

skill-guard 是 NewMax 安全体系的**第一道关口**。所有从 Skill 市场安装的 Skill 必须先通过扫描，否则拒绝安装。

**技术实现**：
- 基于 esbuild 构建的独立 `.mjs` 文件
- 纯静态正则匹配 + 熵值计算
- 无需网络、无需 LLM、无需文件系统写入
- 支持 YAML 规则热加载（`rules/` 目录）

**检测效果**：
- 20 条硬触发器规则（Critical + hardTrigger=true）→ 命中即拒绝安装
- ~50 条软规则（按加权分累积评估）
- 白名单机制防止知名包误报

### 8.3 数据隐私

- **全本地存储**：所有对话数据存在 `~/.newmax/*.db`（SQLite）
- **离线运行**：支持 Ollama 本地模型完全离线使用
- **不上传服务器**：对话内容不经过任何 NewMax 服务端
- **备份可控**：用户手动导出，格式透明（JSON/SQLite dump）

---

## 九、更新与分发基础设施

### 9.1 更新机制

```yaml
# app-update.yml
provider: s3
bucket: newmax-release
endpoint: https://s3-cn-south-1.qiniucs.com
region: cn-south-1
acl: public-read
path: /releases/
updaterCacheDirName: newmax-updater
```

- **技术栈**：electron-updater + 七牛云 S3 兼容存储
- **区域**：华南（cn-south-1），针对中国大陆用户优化
- **权限**：public-read，无需认证即可下载更新包

### 9.2 分发策略

- Windows 优先（当前分析的安装包为 `.exe` 格式）
- 65 种语言本地化包（`locales/`）
- 增量更新（electron-updater 支持差分更新）

---

## 十、数据存储架构

### 10.1 核心数据模型（推测）

```
conversations 表
├── id (TEXT PK)
├── title (TEXT)                  # 自动总结
├── workspace_id (TEXT FK)        # 所属工作区
├── group_id (TEXT FK)            # 所属分组
├── is_archived (BOOL)            # 是否归档
├── is_favorite (BOOL)            # 是否收藏
├── model (TEXT)                  # 使用的模型
├── context_tokens (INT)          # 当前上下文 token 数
├── created_at (INT)              # Unix timestamp
└── updated_at (INT)

messages 表
├── id (TEXT PK)
├── conversation_id (TEXT FK)
├── role (TEXT)                   # user / assistant / system
├── content (TEXT)                # Markdown 内容
├── thinking (TEXT)               # 扩展思考内容
├── tool_calls (JSON)             # 工具调用记录
├── attachments (JSON)            # 附件列表
├── visualization (TEXT)          # 交互式可视化 HTML
├── token_count (INT)
└── created_at (INT)

skills 表 (skill-ledger.db)
├── id (TEXT PK)
├── name (TEXT UNIQUE)
├── version (TEXT)
├── source (TEXT)                 # market / local / url
├── install_path (TEXT)
├── scan_result (JSON)            # skill-guard 扫描结果
├── is_enabled (BOOL)
└── installed_at (INT)
```

### 10.2 文件存储策略

- **对话附件**：`workspace/conversations/conv-{id}/` 下按对话隔离
- **图片**：`images/` 子目录，UUID 命名
- **项目文件**：`workspace/projects/proj-{id}/` 下，含 memory/、outputs/、references/
- **Skill 文件**：`skills/{name}/` 下完整保留

---

## 十一、竞品对标与产品力评估

### 11.1 竞品矩阵

| 维度 | NewMax | Claude Code (原版) | Cursor | GitHub Copilot Chat |
|------|--------|---------------------|--------|---------------------|
| **产品形态** | 桌面应用 (Electron) | CLI + IDE 插件 | IDE (VS Code Fork) | IDE 插件 |
| **部署方式** | 本地安装 | npm / brew | 本地安装 | 插件安装 |
| **AI 引擎** | Claude Agent SDK | Claude API | 多模型 | GPT-4o / Claude |
| **GUI** | ✅ 完整桌面 UI | ❌ 纯 CLI | ✅ VS Code UI | ✅ VS Code 侧栏 |
| **多对话管理** | ✅ 标签页+分组 | ❌ | ❌ 单文件 | ❌ 单面板 |
| **长期项目** | ✅ 任务/排期/依赖 | ❌ | ❌ | ❌ |
| **Skill 生态** | ✅ 50+ Skills | ✅ 内置 Skills | ❌ | ❌ |
| **浏览器自动化** | ✅ Chrome CDP | ❌ | ❌ | ❌ |
| **语音输入** | ✅ 本地离线 | ❌ | ✅ (付费) | ❌ |
| **终端集成** | ✅ 内置终端 | ✅ | ✅ | ✅ |
| **交互式可视化** | ✅ 沙箱嵌入 | ❌ | ❌ | ❌ |
| **中文支持** | ✅ 原生中文 | ⚠️ 英文为主 | ⚠️ 英文为主 | ⚠️ 英文为主 |
| **离线使用** | ✅ Ollama 支持 | ❌ 需联网 API | ❌ 需联网 | ❌ 需联网 |
| **数据隐私** | ✅ 全本地存储 | ⚠️ API 传输 | ⚠️ API 传输 | ⚠️ 云端处理 |
| **价格模型** | 充值/订阅 | API 按量 | $20/月 | $10/月 |
| **目标用户** | 中国开发者和知识工作者 | 全球开发者 | 全球开发者 | 全球开发者 |

### 11.2 核心优势

1. **Skill 生态壁垒**：50+ Skills + 安全扫描 + 一键安装 + 渐进加载 = 最难复制的护城河
2. **产品化深度**：将 CLI 工具（Claude Code）包装为完整桌面应用，包含对话管理、项目系统、浏览器自动化等完整工作流
3. **中文优先**：从系统提示到 UI 到帮助文档全面中文化
4. **隐私合规**：全本地存储对中国企业用户是核心卖点
5. **端到端体验**：不只是"AI 聊天窗口"，而是覆盖"提问 → 执行 → 产出 → 管理 → 回顾"的完整闭环

### 11.3 可能不足

1. **依赖 Claude 引擎**：核心 AI 能力受限于 Anthropic 的更新节奏和 API 可用性
2. **Windows 优先**：从安装包结构看目前主要支持 Windows
3. **Gateway 锁定**：国内版新手引导强推 NewMax Gateway，可能与用户已有 API Key 冲突
4. **Electron 体积**：安装包较大（完整的 Chromium 运行时）

---

## 十二、可复用的关键方法论

### 12.1 架构模式

| 模式 | NewMax 实现 | 可复用建议 |
|------|-------------|-----------|
| **壳 + 引擎分离** | Electron 壳 + claude.exe 子进程 | 任何 Agent 产品都应分离 UI 和 AI 引擎 |
| **能力插件化** | Skill 系统（SKILL.md 规范） | 定义自己的扩展规范，让第三方贡献能力 |
| **多数据库分库** | 4 个独立 SQLite 文件 | 按业务模块分库，独立迁移/备份/清空 |
| **原生模块分层** | 5 个 .node 模块各司其职 | 将系统能力（语音/快捷键/终端/文件监控）封装为独立原生模块 |
| **渐进式加载** | Skill 三层加载（元数据→指令→参考） | 大资源按需加载，不一次性占满上下文 |

### 12.2 核心技术选型对照表

| 需求 | NewMax 选择 | 理由 | 替代方案 |
|------|------------|------|----------|
| 桌面壳 | Electron | 生态成熟，Chromium 内置，N-API 支持 | Tauri（更小体积，但生态不成熟） |
| 数据库 | SQLite (better-sqlite3) | 同步 API，零配置，文件级备份 | IndexedDB（浏览器限制大） |
| 终端 | node-pty | 伪终端，支持交互式程序 | xterm.js addon（仅 Web） |
| 语音 | sherpa-onnx | 本地离线，ONNX 运行时 | Whisper API（需联网） |
| 快捷键 | uiohook-napi | 全局钩子，应用不在前台也能响应 | Electron globalShortcut（功能受限） |
| 文件监控 | @parcel/watcher | 跨平台原生性能 | chokidar（纯 JS，性能较差） |
| 安全扫描 | skill-guard | 静态分析，<2 秒，离线 | LLM 审查（慢、贵、需联网） |
| 更新分发 | 七牛 S3 + electron-updater | 中国大陆 CDN 加速 | GitHub Releases（国内慢） |
| AI 引擎 | claude.exe（子进程） | 进程隔离，独立升级 | SDK 内嵌（耦合度高） |

### 12.3 产品设计模式

1. **入口分层模式**：全局快捷键 → 主窗口 → 对话内斜杠 → 文件引用，不同场景不同入口
2. **"问询卡片"模式**：AI 需要确认时不用纯文本提问，而是弹出结构化选项
3. **"拖拽转换"模式**：对话拖到项目区域 = 创建长期项目，减少表单填写
4. **"圆环可视化"模式**：把抽象的 token 用量转化为直观的圆环比例
5. **"工具调用透明化"模式**：折叠卡片展示 AI 的每一步操作

### 12.4 差异化方向建议

如果要做一个基于 Claude Code 的 Agent 产品，以下是可以差异化的方向：

1. **Skill 生态差异化**：不必复制 50+ Skills，而是聚焦 2-3 个垂直场景深耕（如：代码审查、文档生成、数据分析）
2. **协作能力**：NewMax 是单用户产品，可以加入团队共享对话/项目
3. **云端同步**：NewMax 全本地，可以加入端到端加密的云同步
4. **移动端**：NewMax 仅桌面端，可以开发移动伴侣 App
5. **更轻量的壳**：考虑 Tauri 替代 Electron，大幅减小安装包体积
6. **开放的 Skill 规范**：兼容 Claude Code 原生 Skills 格式，降低创作者迁移成本

---

## 附录 A：已安装 Skills 分类（52 个）

### 内容创作类
- algorithmic-art — 算法艺术（p5.js）
- baoyu-cover-image — 封面图生成
- baoyu-article-illustrator — 文章插图
- baoyu-comic — 漫画生成
- baoyu-infographic — 信息图生成
- baoyu-slide-deck — 幻灯片生成
- baoyu-xhs-images — 小红书图片
- canvas-design — 画布设计
- brand-guidelines — Anthropic 品牌风格
- frontend-design — 前端设计
- theme-factory — 主题工厂

### 文档处理类
- baoyu-format-markdown — Markdown 格式化
- baoyu-markdown-to-html — Markdown 转 HTML
- baoyu-url-to-markdown — 网页转 Markdown
- baoyu-danger-x-to-markdown — X(Twitter) 转 Markdown
- docx — Word 文档处理
- pptx — PPT 处理
- pdf — PDF 处理
- xlsx — 电子表格处理

### 发布与分发类
- baoyu-post-to-x — 发布到 X(Twitter)
- baoyu-post-to-wechat — 发布到微信公众号
- blog-post-writer — 公众号文章写作

### 开发工具类
- skill-creator — Skill 创建器
- mcp-builder — MCP 服务器构建
- web-artifacts-builder — Web Artifacts 构建
- webapp-testing — Web 应用测试
- project-init — 项目初始化
- workflow-automator — 工作流自动化
- roblox-site-architect — Roblox 站点架构

### 媒体处理类
- baoyu-compress-image — 图片压缩
- ffmpeg-usage — 音视频处理
- imagemagick-conversion — 图片转换
- slack-gif-creator — Slack GIF 创作
- remotion-video — 编程式视频创作

### 数据分析类
- data-analysis — 全链路数据分析
- storage-analyzer — 存储空间分析

### 集成与平台类
- xiaohongshu-skills — 小红书自动化
- feishu-doc-reader — 飞书文档读取
- ima-skill — IMA 知识库
- deepl — DeepL 翻译

### 效率工具类
- daily-review — 每日回顾
- deep-review — 深度回顾
- schedule-memory — 日程记忆
- doc-coauthoring — 文档协作
- internal-comms — 内部沟通
- ppocrv5 — OCR 文字识别

### 基础类
- newmax-help — NewMax 帮助
- claude-skills-zh-cn — 中文 Skills 集合

---

## 附录 B：原生模块完整清单

| 模块 | 文件 | 类型 | 功能 |
|------|------|------|------|
| `better-sqlite3` | `better_sqlite3.node` | 数据库 | 嵌入式 SQLite，同步 API |
| `node-pty` | `pty.node` | 终端 | 伪终端主模块 |
| `node-pty` | `conpty.node` | 终端 | Windows ConPTY 支持 |
| `node-pty` | `conpty_console_list.node` | 终端 | ConPTY 控制台列表 |
| `sherpa-onnx-win-x64` | `sherpa-onnx.node` | 语音 | ONNX 运行时语音识别 |
| `uiohook-napi` | `node.napi.node` | 输入 | 全局键盘/鼠标钩子 |
| `@parcel/watcher` | `watcher.node` | 文件系统 | 跨平台文件监控 |
| `@anthropic-ai/claude-agent-sdk` | `claude.exe` | AI 引擎 | Claude Agent CLI 二进制 |

---

> **报告总结**：NewMax 的产品力核心在于**将 Claude Code 的 Agent 能力产品化**，通过 Skill 生态系统、多层级入口设计、本地隐私保障和安全扫描机制，构建了面向中国用户的完整 AI 工作助手。它最值得学习的地方不是技术有多前沿，而是**产品化的深度和完整性**——从 Skill 的三层渐进加载，到硬触发安全规则，到问询卡片的交互创新，每一层都在解决"AI 产品如何让普通用户真正用起来"这个核心问题。
