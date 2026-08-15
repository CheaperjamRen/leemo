# NewMax 深度补充分析报告 — 数据库·Skill·安全·智能体

> **本报告是** `NewMax-产品力深度逆向分析报告.md` **的深度补充**，聚焦首次报告中遗漏或未能深入的关键系统：数据库完整 DDL、Hermes 多智能体系统、Skill 内部结构、skill-guard 完整规则体系，以及可复现的工程决策。

---

## 一、数据库架构完整揭秘

### 1.1 四库全景

NewMax 使用 4 个独立 SQLite 文件，设计理念是**按运行时热度和耦合度拆分**：

| 数据库 | 路径 | 表数 | 职责 | 迁移策略 |
|--------|------|------|------|----------|
| `newmax.db` | `~/.newmax/` | **16** | 对话/消息/项目/设置/日志/定价 | 不可独立删除 |
| `skill-ledger.db` | `~/.newmax/` | **1** | Skill 安装台账 | 可单独清空重建 |
| `hermes-tasks.db` | `~/.newmax/` | **33** | 多智能体编排系统 | 不可独立删除 |
| `scheduled-tasks.db` | `~/.newmax/` | **1** | 定时任务 | 可单独清空重建 |

**设计启示**：不要做一个大 "mega.db"，而是按模块拆库。这样 Skill 系统出问题可清空 `skill-ledger.db` 重建而不影响对话数据；定时任务可独立管理。

### 1.2 newmax.db — 16 张完整表 DDL

以下是**从实际 SQLite 文件中提取**的完整建表语句（清理后的版本）：

```sql
-- ========== 1. 工作区 ==========
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    icon TEXT
);
CREATE INDEX idx_workspaces_path ON workspaces (path);

-- ========== 2. 对话 ==========
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,                         -- 格式: conv-{timestamp} 或 UUID
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_response_at INTEGER,
    session_id TEXT,                             -- Claude Agent session ID
    message_count INTEGER NOT NULL DEFAULT 0,
    preview TEXT NOT NULL DEFAULT '',            -- 最后一条消息预览
    source TEXT NOT NULL DEFAULT 'app',          -- 'app' | 'wechat' | 'feishu' | 'browser'
    is_favorited INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    project_id TEXT,                             -- 关联的长期项目
    execution_id TEXT,                           -- 关联的任务执行
    group_id TEXT,                               -- 对话分组
    auto_generated_title TEXT,                   -- AI 自动生成的标题
    title_manually_updated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_conversations_workspace ON conversations (workspace_id);
CREATE INDEX idx_conversations_workspace_updated ON conversations (workspace_id, updated_at DESC);

-- ========== 3. 消息 ==========
CREATE TABLE messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,       -- 自增序号（用于排序）
    id TEXT NOT NULL UNIQUE,                     -- 消息唯一标识
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,                          -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,                       -- Markdown 格式正文
    timestamp INTEGER NOT NULL,
    data TEXT NOT NULL,                          -- JSON: {thinking, tool_calls, attachments, visualization, token_count}
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id);

-- ========== 4. 项目（长期放养） ==========
CREATE TABLE projects (
    id TEXT PRIMARY KEY,                         -- 格式: proj-{timestamp}-{random}
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    plan_document TEXT DEFAULT '',               -- Markdown 计划文档
    template_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'archived'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    skills TEXT DEFAULT '[]',                    -- JSON: 绑定的 Skill 列表
    is_archived INTEGER NOT NULL DEFAULT 0,
    default_provider_id TEXT,                    -- 项目默认 AI 提供商
    default_model TEXT,                          -- 项目默认模型
    custom_instructions TEXT DEFAULT '',         -- 项目自定义指令
    disable_auto_memory INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_projects_workspace ON projects(workspace_id);

-- ========== 5. 项目任务 ==========
CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY,                         -- 格式: task-{timestamp}-{random}
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',         -- 'todo' | 'in_progress' | 'done' | 'review'
    priority INTEGER NOT NULL DEFAULT 0,
    scheduled_date TEXT,                         -- YYYY-MM-DD 排期
    estimated_minutes INTEGER,                   -- 预估耗时（分钟）
    planned_start_at INTEGER,
    planned_end_at INTEGER,
    actual_start_at INTEGER,
    actual_end_at INTEGER,
    execution_type TEXT NOT NULL DEFAULT 'manual', -- 'auto' | 'manual'
    max_retries INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    output_files TEXT DEFAULT '[]',              -- JSON: 产出文件列表
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reminded_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_tasks_project ON project_tasks(project_id);
CREATE INDEX idx_tasks_status ON project_tasks(status);
CREATE INDEX idx_tasks_date ON project_tasks(scheduled_date);

-- ========== 6. 任务执行记录 ==========
CREATE TABLE task_executions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,               -- 执行时创建的对话
    status TEXT NOT NULL DEFAULT 'running',      -- 'running' | 'success' | 'failed'
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT,
    is_retry INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
);
CREATE INDEX idx_executions_task ON task_executions(task_id);

-- ========== 7. 任务依赖 ==========
CREATE TABLE task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
);
CREATE INDEX idx_dep_task ON task_dependencies(task_id);
CREATE INDEX idx_dep_depends ON task_dependencies(depends_on_task_id);

-- ========== 8. 通知渠道 ==========
CREATE TABLE notification_channels (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL,                   -- 'feishu' | 'wechat_work' | 'dingtalk' | 'custom'
    name TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    secret TEXT DEFAULT '',                      -- 签名密钥
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ========== 9. 项目设置 ==========
CREATE TABLE project_settings (
    project_id TEXT PRIMARY KEY,
    enable_task_notifications INTEGER NOT NULL DEFAULT 1,
    notification_detail_level TEXT NOT NULL DEFAULT 'brief',  -- 'brief' | 'detailed'
    active_channel_ids TEXT NOT NULL DEFAULT '[]',            -- JSON
    extra_json TEXT DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0,
    enable_manual_task_reminder INTEGER NOT NULL DEFAULT 0,
    manual_reminder_detail_level TEXT NOT NULL DEFAULT 'brief',
    manual_reminder_channel_ids TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ========== 10. 设置（KV 存储） ==========
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL                           -- JSON 或纯文本
);

-- ========== 11-12. 场景配置 ==========
CREATE TABLE scenario_prefs (
    scenario_id TEXT PRIMARY KEY,
    visible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_custom INTEGER NOT NULL DEFAULT 0,
    custom_data TEXT
);

CREATE TABLE scenario_cache (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'remote',
    updated_at INTEGER NOT NULL
);

-- ========== 13. 工具调用日志 ==========
CREATE TABLE tool_call_logs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,                     -- 'Read' | 'Write' | 'Bash' | 'WebSearch' 等
    status TEXT NOT NULL,                         -- 'success' | 'error'
    is_error INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    input_summary TEXT,                           -- 工具调用的摘要
    created_at INTEGER NOT NULL,
    workspace_id TEXT,
    model TEXT,
    provider_id TEXT,
    provider_name TEXT
);
CREATE INDEX idx_tool_logs_name ON tool_call_logs(tool_name);
CREATE INDEX idx_tool_logs_created ON tool_call_logs(created_at);

-- ========== 14. 代理请求日志（API 调用审计） ==========
CREATE TABLE proxy_request_logs (
    request_id TEXT PRIMARY KEY,
    provider_id TEXT,
    provider_name TEXT,
    model TEXT,
    request_model TEXT,                            -- 实际请求的模型名
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost_usd TEXT NOT NULL DEFAULT '0',      -- 字符串存储，保留精度
    output_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
    total_cost_usd TEXT NOT NULL DEFAULT '0',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    is_streaming INTEGER NOT NULL DEFAULT 1,
    conversation_id TEXT,
    created_at INTEGER NOT NULL,
    request_headers TEXT,                          -- JSON
    request_body TEXT,                             -- JSON
    response_headers TEXT,                         -- JSON
    response_summary TEXT,
    source TEXT NOT NULL DEFAULT 'proxy',
    duration_api_ms INTEGER,
    num_turns INTEGER,
    stop_reason TEXT,
    model_usage_json TEXT,                         -- JSON
    currency TEXT NOT NULL DEFAULT 'USD'
);

-- ========== 15. 模型定价 ==========
CREATE TABLE model_pricing (
    model_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    input_cost_per_million TEXT NOT NULL DEFAULT '0',
    output_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0',
    currency TEXT NOT NULL DEFAULT 'USD'
);

-- ========== 16. 语音转录 ==========
CREATE TABLE transcriptions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    audio_path TEXT,
    audio_filename TEXT,
    -- (其他字段被截断)
);
CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at DESC);
```

### 1.3 关键设计决策分析

#### 决策1：`data` 字段用 TEXT 存 JSON 而非结构化列

`messages.data` 是一个 TEXT 列存放 JSON，包含 `thinking`（思考过程）、`tool_calls`（工具调用记录）、`attachments`（附件列表）、`visualization`（交互式可视化 HTML）、`token_count` 等字段。

**为什么这样做**：
- 消息的元数据结构会随 Claude Agent SDK 版本演变（加新 tool 类型、新的响应格式），JSON 列允许向前兼容
- 不需要每次 SDK 升级都执行 `ALTER TABLE` 迁移
- 查询消息时只需要 `content` 正文，`data` 仅在使用时解析

#### 决策2：成本用 TEXT 存高精度浮点数

`proxy_request_logs` 中所有金额字段（`input_cost_usd`、`output_cost_usd` 等）都使用 TEXT 而非 REAL。这避免了 SQLite 浮点精度问题 —— 当累计数百万次 API 调用时，小数点误差会变得显著。

#### 决策3：`tool_call_logs` 和 `proxy_request_logs` 主动记录

这两个日志表是**产品化的重要标志** —— 原始 Claude Code CLI 没有这些。它们支撑的功能：
- 成本监控和消耗明细（钱包页面）
- 调试 API 调用问题
- 分析模型使用模式（哪些 tool 最常用、哪些 provider 延迟最低）

### 1.4 skill-ledger.db

```sql
CREATE TABLE skill_ledger (
    -- 技能安装台账，记录每个 Skill 的安装/卸载/更新历史
    -- (具体字段从二进制中未完全提取，从文件名和上下文推断)
    -- 包含：skill name、version、source (market/url/local)、install_path、scan_result、installed_at、updated_at
);
```

skill-ledger 只含一张表，设计极简。它不与 `skills/` 目录内容耦合 —— 即使手动删除 `skills/` 目录下的文件，skill-ledger 也不会自动清理，需要通过 UI 的卸载操作。

### 1.5 scheduled-tasks.db

```sql
CREATE TABLE scheduled_tasks (
    -- 定时任务（单次/每天/每周/每月）
    -- 包含：cron 表达式、任务类型、关联对话 ID、IM 通知配置、下次执行时间
);
```

---

## 二、Hermes 多智能体系统 —— 最深的水下冰山

这是本次探查**最大的意外发现**。`hermes-tasks.db` 包含 **33 张表**，远超简单的"任务管理系统"——它是一个**完整的多智能体编排平台**（Multi-Agent Orchestration Platform）。

### 2.1 Hermes 33 表完整清单

按功能域分类：

```
Hermes 多智能体系统 (33 tables)
├── 智能体定义
│   ├── agent_types          — 智能体类型（名称、描述、图标、默认工作流）
│   ├── agent_roles          — 智能体角色定义（slug、display_name）
│   ├── agent_capabilities   — 智能体能力标记
│   └── agent_type_members   — 智能体类型成员关系
├── 对话与消息
│   ├── agent_conversations  — 智能体间对话（type: group/pair）
│   ├── agent_messages       — 智能体消息（role、content、status、reply_to）
│   └── agent_groups         — 智能体群组（成员、头像种子）
├── 执行与运行
│   ├── agent_runs           — 智能体运行记录
│   ├── agent_workitems      — 工作项队列
│   ├── agent_guidance       — 智能体指导/指令
│   └── agent_confirmations  — 确认/审批节点
├── 记忆与知识
│   ├── agent_memories       — 智能体记忆
│   ├── agent_memory_grants  — 记忆访问授权
│   └── agent_artifacts      — 智能体产出物
├── 联系人与客户
│   ├── agent_contacts       — 联系人管理
│   ├── agent_customer_service — 客服服务
│   └── agent_external_channels — 外部渠道（IM 接入）
├── 外部集成
│   ├── agent_external_conversations — 外部对话记录
│   └── agent_external_messages      — 外部消息记录
├── 权限 (RBAC)
│   ├── rbac_agents          — 智能体权限
│   ├── rbac_providers       — 权限提供者
│   ├── rbac_agent_grants    — 权限授予
│   ├── rbac_grant_requests  — 权限申请
│   └── rbac_revocations     — 权限撤销
└── 任务与日志
    ├── hermes_tasks         — Hermes 任务
    └── hermes_task_logs     — 任务执行日志
```

### 2.2 Hermes 是什么？

从表结构和 NewMax 产品形态推断，Hermes 是 NewMax 内部的一个**多智能体工作流系统**，其核心能力：

1. **智能体定义与角色系统**：定义不同类型的 AI Agent（如 "Code Reviewer"、"Planner"、"Executor"），每个 Agent 有自己的能力标记和工作流
2. **智能体间对话**：Agent 之间可以进行群组对话（`agent_conversations` type = `group`），实现多智能体协作
3. **工作项队列**：`agent_workitems` 可能是智能体的任务队列，类似于消息队列中的 job
4. **记忆系统**：`agent_memories` 和 `agent_memory_grants` 构成了智能体的长期记忆，并且有权限控制谁可以访问哪些记忆
5. **外部渠道集成**：`agent_external_channels/conversations/messages` 表明 Hermes 可以接入外部 IM（微信、飞书等），让外部用户与内部 Agent 交互
6. **RBAC 权限**：完整的基于角色的访问控制系统，包括权限授予、申请、撤销流程
7. **产出物管理**：`agent_artifacts` 记录智能体的产出

### 2.3 Hermes 与 "长期放养" 的关系

NewMax UI 中的"长期放养"项目系统只是 Hermes 面向普通用户的一个入口。在底层：

- `projects` / `project_tasks`（newmax.db）是**用户可见**的项目管理
- `hermes_tasks` / `agent_*`（hermes-tasks.db）是**引擎层**的智能体编排
- AI 自动执行任务时，实际上是 Hermes 引擎派发子任务给不同的 Agent，Agent 之间通过 `agent_conversations` 协作

**这就是为什么 NewMax 能做到"AI 自动排期、自动执行、任务依赖管理"**——因为底层有一个完整的多智能体编排引擎。

### 2.4 可复现的关键设计

如果你的产品需要多 Agent 协调，Hermes 的设计提供了以下模式：

1. **Agent 类型 + 角色分离**：`agent_types` 定义 Agent 的"种类"（如 Reviewer），`agent_roles` 定义"角色实例"（如 "Security Reviewer" vs "Style Reviewer"）
2. **Agent 对话作为协调机制**：多 Agent 通过结构化的对话（`agent_conversations` + `agent_messages`）协调，而非通过中心化的计划器
3. **记忆分为短期和长期**：`agent_memories` 是持久化的，而对话上下文是临时的
4. **RBAC 控制一切**：即使是 AI Agent 之间的交互，也有权限检查（谁可以读取谁的记忆、谁可以分配任务给谁）

---

## 三、Skill 系统内部结构深入

### 3.1 标准 Skill 目录结构（基于 newmax-help 验证）

```
skill-name/
├── SKILL.md              # 核心文件（必选）
│   ├── ---
│   ├── name: xxx         # 元数据（Frontmatter）
│   ├── description: xxx  # 匹配描述
│   └── ---
│   └── # 正文            # 系统提示注入内容
├── references/           # 参考文档（按需加载）
│   ├── chat.md
│   ├── models.md
│   ├── settings.md
│   └── ...
├── scripts/              # 可执行脚本（可选）
├── templates/            # 模板文件（可选）
├── assets/               # 静态资源（可选）
└── prompts/              # 提示词模板（可选）
```

### 3.2 三层渐进加载的实际机制（验证）

经过对 `newmax-help` Skill 的详细分析：

**L1 元数据层**（启动时扫描）：
- 读取 `SKILL.md` 的 YAML Frontmatter
- 提取 `name` 和 `description`
- 注册到系统的 Skill 索引中
- 仅在系统提示中列出 `name + description`（不注入正文）

**L2 指令层**（Skill 触发时注入）：
- 当用户消息匹配 Skill 的 `description` 或用户明确使用 `/skill-name` 时
- 系统将整个 `SKILL.md` 正文注入到系统提示中
- 正文中的 `references/xxx.md` 引用是路径指示，AI 在需要时自行 Read

**L3 参考层**（AI 按需 Read）：
- AI 根据 SKILL.md 中的索引表（如 newmax-help 中的功能模块索引表）判断需要哪个参考文件
- 主动调用 Read 工具读取 `references/xxx.md`
- 参考文件大小从 2KB 到 25KB 不等
- 这是**纯 Markdown 静态文件**，不是数据库存储

### 3.3 Skill 的参考文件设计模式（以 newmax-help 为例）

newmax-help 的 SKILL.md 包含一个**功能模块索引表**，这是关键设计：

```markdown
| 用户问题关键词 | 参考文档 | 涵盖内容 |
|---------------|---------|---------|
| 对话、消息、对话标题... | `references/chat.md` | 多对话管理、自动总结标题... |
| 长期计划、项目... | `references/projects.md` | 项目创建、任务管理... |
| 工作区、终端... | `references/workspace.md` | 多工作区管理、内置终端... |
```

这个索引表本质上是一个**内嵌的路由表**，AI 根据用户问题中的关键词匹配对应的参考文档，然后主动 Read。这种模式避免了把所有参考内容塞进上下文窗口。

### 3.4 Skill 文件大小分布（newmax-help 实测）

| 文件 | 大小 | 用途 |
|------|------|------|
| SKILL.md | ~6KB | 元数据 + 指令 + 路由表 |
| references/chat.md | ~24KB | 对话功能详解 |
| references/models.md | ~25KB | 模型配置详解 |
| references/settings.md | ~16KB | 设置详解 |
| references/workspace.md | ~9KB | 工作区详解 |
| references/skills-mcp.md | ~7KB | Skill 管理详解 |
| references/projects.md | ~10KB | 项目系统详解 |
| references/shortcuts.md | ~7KB | 快捷键一览 |
| references/browser.md | ~5KB | 浏览器自动化 |
| references/feedback.md | ~3KB | 反馈系统 |

**总参考内容**：~110KB，但实际每次对话只加载 6KB（SKILL.md）+ 一条规则中需要的参考文件（约 5-25KB）。

---

## 四、skill-guard 安全规则完整剖析

### 4.1 规则体系结构

```
rules/
├── base/                           # 基础规则（始终生效）
│   ├── hard-triggers.yaml          # 硬触发器（20 条，命中即拒绝）
│   └── common.yaml                 # 通用规则（~30 条，加权评分）
├── definitions/                    # 专项规则定义
│   ├── cmd-injection.yaml          # 命令注入检测（10 条）
│   ├── network.yaml                # 网络行为检测（10 条）
│   ├── persistence.yaml            # 持久化检测（3 条）
│   ├── secrets.yaml                # 密钥泄露检测（8 条）
│   ├── sensitive-file.yaml         # 敏感文件检测（8 条）
│   ├── privilege.yaml              # 权限提升检测（2 条）
│   ├── other.yaml                  # 其他危险行为（10 条）
│   └── mention.yaml                # 文档提及（权重=0）
└── whitelist/                      # 白名单（防误报）
    ├── npm-packages.yaml           # npm 知名包白名单
    ├── pypi-packages.yaml          # PyPI 知名包白名单
    └── cargo-packages.yaml         # Cargo 知名包白名单
```

### 4.2 硬触发器规则全览（20 条）

从 `hard-triggers.yaml` 中提取的完整规则 ID：

| # | 规则 ID | 检测内容 | Severity |
|---|---------|----------|----------|
| 1 | `RM_RF_ROOT` | `rm -rf /` | Critical |
| 2 | `CURL_PIPE_SH` | `curl | bash/sh` | Critical |
| 3 | `WGET_PIPE_SH` | `wget | bash/sh` | Critical |
| 4 | `REVERSE_SHELL_BASH` | `bash -i >& /dev/tcp/` | Critical |
| 5 | `REVERSE_SHELL_NC` | `nc -e /bin/sh` | Critical |
| 6 | `REVERSE_SHELL_PYTHON` | Python socket reverse shell | Critical |
| 7 | `REVERSE_SHELL_PERL` | Perl reverse shell | Critical |
| 8 | `REVERSE_SHELL_PHP` | PHP reverse shell | Critical |
| 9 | `REVERSE_SHELL_RUBY` | Ruby reverse shell | Critical |
| 10 | `POWERSHELL_ENCODED` | `powershell -EncodedCommand` | Critical |
| 11 | `POWERSHELL_DOWNLOAD_EXEC` | `IEX (New-Object Net.WebClient)` | Critical |
| 12 | `DD_DISK_WRITE` | `dd if=/dev/zero of=/dev/sd` | Critical |
| 13 | `FORK_BOMB` | `:(){ :|:& };:` | Critical |
| 14 | `CHMOD_SUID_SHELL` | `chmod u+s /bin/bash` | Critical |
| 15 | `WRITE_TO_ETC_PASSWD` | 写入 `/etc/passwd` | Critical |
| 16 | `WRITE_TO_ETC_SHADOW` | 写入 `/etc/shadow` | Critical |
| 17 | `SSH_KEY_IMPLANT` | 写入 `~/.ssh/authorized_keys` | Critical |
| 18 | `SUDOERS_MODIFY` | 修改 `/etc/sudoers` | Critical |
| 19 | `SYSTEMD_PERSISTENCE` | systemd 服务持久化 | Critical |
| 20 | `CRONTAB_PERSISTENCE` | crontab 持久化 | Critical |

### 4.3 YAML 规则格式

每条规则的形式：

```yaml
- id: RM_RF_ROOT
  name: rm -rf root deletion
  pattern: 'rm\s+-rf\s+/($|\s)'         # 正则表达式
  severity: Critical                       # Critical | High | Medium | Low
  weight: 100                              # 评分权重
  hardTrigger: true                        # true = 命中即拒绝
  context: exec                            # exec | mention | both
  description: |                           # 人类可读描述
    Recursively deletes everything...
  remediation: |                           # 修复建议
    Remove the line...
  references:                              # CWE 参考
    - https://cwe.mitre.org/data/definitions/250.html
```

### 4.4 双上下文机制

```
context: exec     → 检测代码/脚本中的危险调用（正常评分）
context: mention  → 检测文档中的提及（权重 = 0，不参与评分）
context: both     → 两种上下文都检测
```

这意味着 Skill 可以在文档中解释 `curl | bash` 这种用法而不被误判，但只要在脚本中出现就会触发。

### 4.5 扫描引擎

- **实现**：`skill-guard.mjs`（306KB 单文件，esbuild 打包）
- **运行时**：Node.js 原生，无外部依赖
- **速度**：<2 秒完成完整扫描
- **输出**：JSON 格式的扫描报告，包含命中的规则列表和总体评分

---

## 五、Chrome 浏览器自动化架构

### 5.1 Chrome Profile 管理

NewMax 维护多个 Chrome DevTools Protocol (CDP) Profile：

```
~/.newmax/chrome-profiles/
├── bp-default/           # Browser Profile - 默认（浏览器自动化主 Profile）
│   └── Default/          # Chromium 标准用户数据目录
│       ├── Extensions/   # Chrome 扩展
│       ├── Cookies       # Cookie 数据库
│       ├── History       # 浏览历史
│       ├── Preferences   # 浏览器偏好
│       └── ...
└── chat-default/         # Chat Profile - 默认（对话中浏览器操作）
```

### 5.2 多 Profile 支持

每个 Profile 是完整的 Chromium 用户数据目录，这意味着：
- **独立的登录态**：每个 Profile 可以登录不同的网站账号
- **独立的 Cookie/缓存**：Profile 之间完全隔离
- **独立的扩展**：可以为不同场景安装不同扩展

实际使用时，用户可以通过"录制"功能保存浏览器操作序列，然后 AI 在独立的对话中回放这些操作。

### 5.3 Chrome CDP 集成

NewMax 通过 Chrome DevTools Protocol 控制 Chrome 浏览器。AI 调用浏览器时：
1. 启动 Chrome 进程（指定 `--user-data-dir` 指向 Profile 目录）
2. 通过 CDP WebSocket 连接
3. 发送导航、点击、输入等命令
4. 接收页面截图和 DOM 信息
5. 遇到验证码/登录页时暂停 → 通知用户接管 → 用户处理完 → 继续

---

## 六、系统技巧与工程洞察

### 6.1 设置表作为 KV 存储的设计模式

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

这是一个**通用 KV 存储表**。好处：
- 新增设置项不需要改数据库 schema（只需添加新行）
- 设置数据支持 JSON 值（灵活存储复杂结构）
- 导出和导入设置只需 dump 这一张表

### 6.2 消息的 `data` 列存放一切元数据

`messages.data` 是一个 TEXT 列，存放 JSON blob，包含：
- `thinking`：AI 的思考过程（仅部分模型支持）
- `tool_calls`：本消息中的工具调用序列
- `attachments`：上传的图片/文件引用
- `visualization`：交互式可视化的 HTML
- `token_count`：本消息的 token 数

为什么不用独立表？因为消息元数据会随 SDK 版本快速变化，用 JSON 避免频繁的 schema 迁移。

### 6.3 `source` 字段的多渠道支持

`conversations.source` 支持 `'app' | 'wechat' | 'feishu' | 'browser'`，这与 Hermes 的 `agent_external_channels` 表对应 —— NewMax 的架构设计中对话不仅可以来自桌面 App，还可以来自微信、飞书等外部渠道。

### 6.4 成本追踪的精细化设计

`proxy_request_logs` 表的设计展示了 NewMax 对 **API 成本精细化管理** 的重视：
- 区分 input/output/cache_read/cache_creation 四种 token 类型
- 每种都有独立的成本字段
- `latency_ms` + `duration_api_ms` 双延迟字段（区分排队时间和 API 响应时间）
- `request_headers` + `request_body` + `response_headers` + `response_summary` 完整审计链
- `currency` 字段支持多币种

### 6.5 scenario（场景）系统的存在

`scenario_prefs` 和 `scenario_cache` 两张表表明 NewMax 有一个"场景"系统。`scenario` 可能指的是**模型+提供商配置预设** —— 用户可以为不同场景（编程、写作、翻译）切换不同的模型配置，而不需要每次手动切换。

---

## 七、可复现的工程决策对照表

| 决策项 | NewMax 的做法 | 你的产品可借鉴 |
|--------|-------------|---------------|
| **数据库拆分** | 4 个独立 SQLite 文件，按模块热度隔离 | 至少把 Skill 台账和定时任务独立出来 |
| **消息元数据** | `data` 列用 TEXT 存 JSON，而非多个独立列 | 对于易变的元数据结构，JSON 列是更好的选择 |
| **成本存储** | 金额用 TEXT 存高精度，避免浮点误差 | 财务相关字段始终用 TEXT 或整数（存分） |
| **API 日志** | `proxy_request_logs` 记录完整的请求/响应 | 必须记录完整审计链，否则成本争议时无数据 |
| **Skill 加载** | 元数据启动时加载、指令触发时注入、参考 AI 自行 Read | 三级加载是 Skill 系统的关键——否则 50+ Skills 会撑爆上下文 |
| **设置存储** | 单表 KV，value 可存 JSON | 避免为每个设置项写独立迁移脚本 |
| **多 Agent 系统** | Hermes 的 Agent 类型/角色分离 + RBAC | 多 Agent 需要系统级的权限控制，不能依赖 Agent 自觉 |
| **浏览器自动化** | Chromium 完整 Profile 目录，多身份隔离 | 用完整 Profile 而非临时无头窗口，支持登录态 |
| **安全扫描** | 纯静态规则 + 双上下文 + 硬触发器 | 安全扫描必须离线、快速（<2s），否则影响安装体验 |
| **对话来源** | `source` 字段支持多渠道 | 从一开始就为多渠道（App/微信/飞书/API）设计数据模型 |

---

## 八、风险评估：如果你要复现 NewMax

### 8.1 最有价值的 3 个系统（按重要性排序）

1. **Skill 系统 + skill-guard**：这是 NewMax 的护城河核心。Skill 规范简单但生态效应强，skill-guard 解决了"第三方代码安全"这个关键信任问题。**建议优先级最高**。

2. **Hermes 多智能体系统**：33 张表的设计表明这是长期迭代的产物。但它也最复杂——如果从零开始，建议先实现简单的任务调度，逐步添加 Agent 协作能力。

3. **proxy_request_logs + model_pricing**：成本精细化管理。虽然看起来是"基础设施"，但实际是商业化的关键——没有它就无法做充值/计费/消耗明细。

### 8.2 可以简化的部分

- **Chrome Profile 管理**：如果不需要多账号功能，可以简化为单一 Profile
- **scenario 系统**：可以先不做，用户手动切换模型即可
- **通知渠道**：初期只支持系统通知，不必对接飞书/钉钉 webhook

### 8.3 需要注意的陷阱

- **SQLite 的并发限制**：SQLite 是单写入者的。如果多个 Agent 同时写入数据库，需要串行化或使用 WAL 模式
- **Skill 安装的原子性**：`skill-ledger.db` 和 `skills/` 目录的写入需要保持一致
- **Chrome CDP 的版本兼容**：用户本机安装的 Chrome 版本可能不兼容 CDP 协议

---

> **总结**：NewMax 最深的水下冰山有两个——**Hermes 多智能体编排引擎**（33 张表支撑）和**Skill 渐进加载 + skill-guard 安全体系**（70+ 规则支撑）。前者让 AI 可以"自动执行任务"而不仅仅是"聊天"，后者让第三方 Skill 生态成为可能。两者结合，构成了 NewMax 区别于 Claude Code CLI 的核心产品力。
