# r11 Skill 库与本地来源管理发布验收

日期：2026-07-31，2026-08-02 按真实 Skill 库方案重做并复验。

结论：**26 个通用精选 Skill 与 4 个 Office Skill 已完成 Implemented / Integrated / Release-verified。旧的 40 个生成式占位模板已经删除。** 用户最终看到 30 张卡片、默认启用 12 个；`claude-api` 不再打包或展示。本次打包验收使用隔离 userData、工作区与本机 loopback 模型，没有读取用户真实工作区、访问外网或消耗付费模型。

## 1. 产品与目录边界

- `bundled-skills/default-enabled` 与 `bundled-skills/optional` 只供 Leemo 开发者在打包前投放和分组，不是安装后用户操作的目录，也不代表用户后续开关必须保持开发者初始选择。
- 构建时把两组 Skill 与 `catalog.json` 一起收进 `app.asar`；启动后按内容版本原子展开到应用数据目录的只读运行时缓存，并合成一个 `leemo-library` 插件。
- 运行时缓存包含完整 26 个通用 Skill，SDK 每轮只收到用户当前启用的稳定触发名；中文展示名与英文命令名分离，界面改名不会破坏调用。
- 用户自行安装、复制或由 momo 安装的 Skill 统一落在当前 Leemo 工作区的 `.leemo/skills`。旧 `.claude/skills` 只做一次无覆盖迁移，不再向用户暴露 Claude 的产品心智。
- 4 个 Office Skill 继续走独立离线 bundle；因此技能中心总数为 `26 + 4 = 30`，默认启用数为 `8 + 4 = 12`。

## 2. 打包态用户路径

`node scripts/cdp-skills-r11-verify.mjs` 通过 15 组检查：

- 技能中心展示 30 张名称唯一的卡片，使用简洁中文名称、真实来源标签和用途说明。
- `claude-api` 在目录、卡片和安装包中均不存在；未指定供应商的任务继续遵循当前对话模型与 Leemo 的模型路由。
- 搜索、动态分类、启停和斜杠菜单走可见界面；斜杠菜单只展示当前启用集合。
- `/frontend-design` 的真实 Skill 正文进入模型请求，不是只显示一张卡片；中文“Excel 表格”映射到 `/xlsx`，Office Skill 正文同样进入请求。
- 关闭“前端设计”、开启“平面设计”后，页面、斜杠菜单与 SDK allowlist 热同步；完全重启 Leemo 后状态仍一致。
- 26 个通用 Skill 全部进入内容版本缓存，安装包外没有散落的内置 Skill 文件。
- renderer 捕获错误为 0，四个窗口尺寸的页面、主区与搜索框均无横向溢出。

结构化事实：`docs/research/audit-shots/r11-skills-facts.json`。

## 3. 构建门禁

`npm run verify:bundled-skills` 在打包前检查：

- 两个开发者投放目录和每个 `SKILL.md` 的结构；
- 目录名、触发名与展示名均不可重复；
- `catalog.json` 不得引用幽灵目录，展示名称和说明必须有效；
- 禁止符号链接、`.git`、`node_modules`、`__pycache__`、`.pyc` 与超过 10 MiB 的单文件；
- 输出可复核的文件数、总字节数和内容 SHA-256。

当前通用库为 26 个 Skill、560 个打包源文件、8,482,320 B，内容哈希为 `9a7c08ec6ea2a3b2f841dbdeb7281a0e48bf111e12f9c4563bdffa9369902a2b`。

## 4. 视觉与窗口

| 视口 | 结果 | 证据 |
|---:|---|---|
| 1440x900 | 双列清单，来源、说明、分类和开关完整 | `audit-shots/r11-skills-1440x900.png` |
| 1280x720 | 双列紧凑布局，分类按空间换行 | `audit-shots/r11-skills-1280x720.png` |
| 1024x768 | 双列布局，无文字或开关遮挡 | `audit-shots/r11-skills-1024x768.png` |
| 720x640 | 单列清单，分类完整换行，核心操作可见 | `audit-shots/r11-skills-720x640.png` |

四个视口的横向溢出均为 0。分类不再依赖隐藏的横向滚动手势，窄窗口会直接换行展示全部选项。

## 5. 包与性能

| 指标 | 最终值 |
|---|---:|
| NSIS 安装器 | 190,113,755 B |
| SHA-256 | `E86FAD9EBE848FF906B4BC81353609FA16C0780734F2E937906467ADFCC5E2AD` |
| win-unpacked | 498 个物理文件 / 756,587,635 B |
| app.asar | 93,570,026 B |
| 松散通用 Skill 文件 | 0 |
| 通用 Skill 运行时缓存 | 552 文件 / 8,291,690 B |
| 隔离环境首次启动 | 2.922 s |
| 隔离环境重启 | 1.507 s |
| 验收时工作集 | 241,090,560 B |

Skill 源文件被收进 `app.asar`，没有把数百个小文件直接摊在安装目录；首次启动只建立一份按内容版本复用的本地缓存。后续内容未变化时不重复复制。

## 6. 自动验证

```powershell
npm run verify:bundled-skills
npx vitest run
npm run typecheck
npm run build
npm run build:main
npx electron-builder
node scripts/cdp-skills-r11-verify.mjs
```

最终全量为 **163 个测试文件、2248/2248 通过**；三套 TypeScript typecheck 0 错；renderer、主进程、win-unpacked 与 NSIS 构建成功；打包 Skills 用户路径 **15/15**。

## 7. 明确边界

- MVP 不运营在线 Skill Hub：没有账号、评分、推荐流、云端托管或目录服务。
- “社区可信”是客户端内置的静态下载清单；浏览不联网，用户点击安装时才向固定上游来源发起单次请求。
- GitHub / skill.sh / ZIP / 文件夹可直接安装。未知来源默认不强制内容扫描，也不因扫描结论拒绝用户；路径穿越、符号链接和覆盖等结构性检查仍强制。
- 内置 Skill 的方法正文已离线可用，但部分上游脚本仍可能要求网络、API 凭据、系统程序或额外运行库；本轮不把“Skill 被加载”夸大为所有第三方依赖均离线自包含。
- 默认只开启 12 个，避免为了数量观感让普通对话承担不必要的上下文和能力噪声。
- `claude-api` 不是 Leemo 的底层兼容层，而是一份把通用 LLM 任务导向 Claude API 的工作流。它会破坏当前对话模型选择和 Leemo 自有心智，因此明确不进入内置库；底层 SDK/CLI 兼容实现继续留在不可见基础设施中。
