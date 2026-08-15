# r11 本地定时任务发布验收

日期：2026-07-31
结论：**Implemented / Integrated / Release-verified 均成立。** 本轮使用隔离 HOME、userData、工作区与本机 loopback 模型；没有读取用户真实 `~/Leemo`，没有调用外网或付费模型。

## 1. 三层状态

| 层级 | 已证明内容 |
|---|---|
| Implemented | 一次/每天/每周日历模型、SQLite 任务与运行记录、主进程本地时钟、暂停/继续/立即运行/编辑/删除、漏跑恢复 |
| Integrated | 定时任务复用现有工作区、会话、模型、工具、权限、通知和持久化链路；自动运行不会抢走当前页面 |
| Release-verified | 打包应用真实走过可见创建、到点自动执行、打开结果、重启恢复、终态对话恢复、退出期间漏跑、跳过后持久化 |

## 2. 用户路径结果

`node scripts/verify-scheduled-tasks.mjs` 共通过 9 条打包态断言：

- 用户在页面填写任务、一次运行时间和结果工作区并保存，不依赖测试脚本直接写数据库。
- 到点后 loopback momo 返回 `R11_SCHEDULED_OK`，运行记录为已完成。
- 自动运行期间仍停留在定时任务页，没有强行切换到结果对话。
- 结果对话可从任务行打开；重启后任务、运行记录和结果对话均恢复，终态仍为“已完成”。
- 通过受控 IPC 只注入一个已过期的一次性任务作为重启故障条件；重启后页面显示“回来后有 1 次任务需要处理”。
- 用户选择跳过后，该漏跑记录跨刷新保持已处理。
- renderer 捕获错误 0；验收结束后带隔离标记的 Leemo 进程 0。

结构化事实：`docs/research/audit-shots/r11-scheduled-tasks-facts.json`。

## 3. 视觉验收

| 状态 | 视口 | 结果 | 证据 |
|---|---:|---|---|
| 自动任务完成 | 1440x900 | 页面、任务行、结果入口与最近运行完整；横向溢出 0 | `audit-shots/r11-scheduled-tasks.png` |
| 启动后发现漏跑 | 720x640 | 漏跑说明、补跑/跳过、任务列表和最近运行均可见；横向溢出 0 | `audit-shots/r11-scheduled-tasks-missed-720x640.png` |

两种视口的主内容都在窗口内，截图非空；紧凑视口没有通过隐藏核心操作换取几何通过。

## 4. 包体基线

| 指标 | r11 外部工作区基线 | 本轮最终 | 变化 |
|---|---:|---:|---:|
| NSIS 安装器 | 185,205,228 B | 185,221,264 B | +16,036 B |
| win-unpacked 文件数 | 315 | 315 | 0 |
| win-unpacked 总大小 | 731,951,862 B | 732,051,223 B | +99,361 B |
| app.asar | 72,437,752 B | 72,537,113 B | +99,361 B |
| 小于 4 KiB 的文件 | 未单列 | 144 | 无新增解包文件 |

安装器：`E:\Leemo\dist-package\Leemo Setup 0.0.1.exe`

SHA-256：`1C43456709B0C4A0B24A4D3A1F6DF887DA35C992AD84FCE422196321A8848D0F`

本轮没有新增运行依赖，也没有为每条任务创建小文件。主 renderer chunk 仍超过 Vite 500 kB 提示线，是已有的按需加载性能债；当前不为消除警告做高风险架构重写。

## 5. 自动验证

```powershell
npm test
npm run typecheck
npm run build
npm run build:main
npm run electron:pack

node scripts/verify-scheduled-tasks.mjs
node --check scripts/verify-scheduled-tasks.mjs
git diff --check
```

定时任务相关目标回归共 112 项通过；最终全量为 146 个测试文件、2064/2064 通过。三套 TypeScript typecheck 0 错，renderer 与主进程构建成功，验收脚本语法和 `git diff --check` 均通过。

## 6. 发现并修复的数据风险

原持久化会在对话变化后等待 300 ms 批量写入。定时任务刚结束时若立刻关窗，最终文本和完成状态存在丢失窗口。本轮把“运行从有值变为终态”定义为用户数据的耐久边界并立即落盘，同时在 renderer 清理前冲洗其他未写变化；打包验收新增“重启后打开结果对话仍显示已完成”的断言。

## 7. 明确未做

- Leemo 完全退出后不执行任务；下次启动显示漏跑并让用户补跑或跳过。
- 不做云端调度、Windows 计划任务、系统服务或托盘常驻；没有真实用户证明前，这些会增加权限、运维和故障心智。
- 不提供 cron、时区专家选项、模型/Skill/执行器字段；任务沿用用户当时可用的 Leemo 能力。
- 设备休眠、系统时间/时区跳变采用“回来后漏跑”语义；更复杂的跨时区日程留待真实使用反馈。
