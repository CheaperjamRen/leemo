# R11 搜索来源与联网用户路径验收

日期：2026-07-31
范围：豆包搜索、AnySearch、arXiv、秘塔/Google 配置边界、联网开关、重启恢复、权限体验、打包视口。

## 结论

搜索链已达到内测前的可用门槛：免 Key 的 AnySearch 与 arXiv、临时配置的豆包搜索均取得真实结果；关闭联网后工具结构性移除；重新打开后下一轮恢复；只读搜索连续三轮没有审批卡；设置和长对话输入区在四个目标视口没有横向溢出或裁切。

本轮还修复了一个真实的体验缺陷：Leemo 自己的通用搜索与 arXiv MCP 原先被权限代理当作未知第三方 MCP，导致每次搜索弹出“允许一次”。现在它们和原生 `WebSearch` 由同一个可信联网能力组管理，并跟随每个对话的生效开关；任意用户第三方 MCP 仍按原策略询问。供应商只是这个组下面的搜索适配器，新增供应商不会再新增权限工具名。

## 真实来源探针

探针脚本：`scripts/probe-search-providers.mjs`
事实文件：`docs/research/audit-shots/search-r11-live-probe-facts.json`

| 来源 | 状态 | 命中 | 说明 |
|---|---:|---:|---|
| AnySearch | `ok` | 2 | 免 Key 默认源 |
| 豆包搜索 | `ok` | 2 | 仅使用本次测试输入，凭据未写入代码、日志、截图或事实文件 |
| arXiv | `ok` | 2 | 公共学术接口 |
| 秘塔搜索 | `not_configured` | 0 | 本次没有提供凭据 |
| Google Custom Search | `not_configured` | 0 | 本次没有提供 API Key 与 CX |
| Tavily / Bocha | `not_configured` | 0 | 本次没有提供凭据 |

探针输出只包含来源、状态、命中数、延迟和错误分类；写盘前会扫描输入凭据子串。

## 打包用户路径

脚本：`scripts/cdp-search-r11-verify.mjs`
事实文件：`docs/research/audit-shots/search-r11-packaged-facts.json`
截图：`docs/research/audit-shots/search-r11-user-path.png` 与四张 `search-r11-<viewport>.png`

- 隔离 userData 与工作区启动，首次启动 1.324 秒，重启 1.185 秒。
- 设置页保存临时凭据后不在 DOM 回显；重启后不回填；清除后状态恢复为可选。
- 关闭联网并重启：总开关、子开关和禁用态持久化；模型请求收到 0 个搜索工具；时间线无搜索工具。
- 打开联网后空查询：出现 1 个可见的搜索错误工具节点，最终结果明确完成。
- 同一对话下一轮真实 AnySearch：搜索工具状态为 `ok`，8 条结果；没有重复审批。
- `readOnlyApprovalEvents = 0`，renderer 错误为 0。
- 视口 `1440x900 / 1280x720 / 1024x768 / 720x640`：设置窗在视口内、内容无横向溢出、来源分组顺序正确、输入区文本框/容器/区域/发送按钮均在视口内。

## 包与自动验证

- Windows 解包目录：315 个文件 / 732,054,989 B；`app.asar` 72,540,879 B；renderer 主 chunk 717,128 B。
- NSIS：185,222,396 B，SHA-256 `622EA1BAEAE9B07F47C4C6BA99A2C9A7E24604195FBA3EBF0BDA8E4161631076`。
- `app.asar` SHA-256：`CAEFA483A7616AD2BBDB1E3D8196A9F2AD7F350C6009E240B8191C802647044D`。
- 完整测试：146 个文件、2068/2068；三套 TypeScript typecheck 0 错；renderer、main、win-unpacked 与 NSIS 构建成功。
- Windows 原生进程树测试 5/5；打包验收退出后没有 Leemo/Electron 残留进程。

## 证据边界

- 秘塔与 Google 只验证了“未配置时诚实呈现”，没有凭据时不做假通过声明。
- 真实搜索结果受上游实时内容影响；验收只依赖来源、命中数、工具状态和错误语义，不把具体标题当稳定快照。
- 本轮未把视觉风格评为最终完成。截图显示功能布局已稳，但设置行层级偏同质、灰阶过多、保存回执略抢眼；这些进入内测前独立的整机视觉收口卡。
