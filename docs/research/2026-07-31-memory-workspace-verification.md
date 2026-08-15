# r10 默认工作区与记忆治理发布验收

日期：2026-07-31
结论：**Implemented / Integrated / Release-verified 均成立。** 本轮验收使用隔离 HOME、userData、工作区和本机 OpenAI 兼容 mock；没有读取用户真实 `~/Leemo`，没有调用外网或付费模型。

## 1. 三层状态

| 层级 | 已证明内容 |
|---|---|
| Implemented | 默认工作区路由；全局/本子时序账本；预算化当前视图；敏感与未确认推测过滤；迁移；查看、搜索、编辑、pin、删除、历史、来源与 undo |
| Integrated | SDK 原生 Auto Memory、Leemo memory MCP、host 路径/权限治理、typed Bridge、renderer store、设置页和消息页脚轻回执共用同一真源 |
| Release-verified | 打包应用真实完成写产物、记住、召回、撤销、关闭、替代、重启恢复、跨本子隔离和旧数据副本迁移；不是只测组件或字段 |

## 2. 用户路径结果

`node scripts/verify-memory-workspace.mjs`：

- 无当前本子时，`r10-global-artifact.md` 只出现在 `默认工作区`；工作区根目录没有同名副本。
- 当前本子为“记忆验收”时，`r10-notebook-artifact.md` 留在该本子。
- 显式“请长期记住”后，momo 消息页脚出现轻量回执；撤销成功后，新对话召回为空。
- 关闭“momo 记得的”后，再次要求记住不会新增记录。
- 全局作用域只有 `MEMORY.md` 和 `ledger.jsonl`；普通产物 prompt 不含账本路径、消息 ID 或来源元数据。
- mock 请求 9 次，外部 API 调用 0，renderer 控制台错误 0。

`node scripts/verify-memory-restart.mjs`：

- “目前在读书”被“已经毕业、目前在工作”替代；旧值不会在重启后复活。
- 当前全局记忆跨重启保留，并可在本子会话中使用。
- “春招”本子的模拟面试目标不会泄露到“课程”本子。
- 普通研究产物与旧 `memory/research-ai-memory.md` 都进入默认工作区；迁移清单分别记录 1 条归档映射与 1 条普通产物移动映射。
- 全局与本子各固定两个运行文件；mock 请求 14 次，外部 API 调用 0，renderer 控制台错误 0。

当次隔离迁移副本位于 `%TEMP%\leemo-e2e-r10-memory-restart-QdJrfL`，脚本成功后已按校验过的前缀自动清理。失败调试副本只有显式设置 `LEEMO_KEEP_AUDIT=1` 才会保留。

## 3. 视觉验收

| 状态 | 视口 | 结果 | 证据 |
|---|---:|---|---|
| 当前记忆与历史 | 1440x900 | 设置窗口、历史、来源和操作完整；横向溢出 0 | `audit-shots/r10-memory-history-1440x900.png` |
| 长中英文编辑 | 720x640 | 设置窗口在视口内，正文横向溢出 0 | `audit-shots/r10-memory-editor-720x640.png` |
| 聊天轻回执与 composer | 720x640 | composer 完整；左右侧栏各 180px；对话区 360px，超过 320px 验收下限 | `audit-shots/r10-memory-receipt-720x640.png` |
| 撤销后的空态 | 720x640 | 空态文案与筛选可见，横向溢出 0 | `audit-shots/r10-memory-empty-720x640.png` |
| 重启后召回 | 原生窗口 | 对话、文件树与输入区可用 | `audit-shots/r10-memory-restart.png` |

五张 PNG 均做尺寸与采样像素检查，采样颜色数为 103–323，非空白采样为 1,424–11,518；没有空白截图。布局事实保存在 `audit-shots/r10-memory-workspace-facts.json`，重启事实保存在 `audit-shots/r10-memory-restart-facts.json`。

目验曾发现：720px 下两侧固定 260px 虽未让 composer 越出视口，却把对话压到约 200px，页脚逐字换行。修复后两侧各 180px，输入区缩小内边距并隐藏非必要快捷键提示；打包脚本新增“对话区至少 320px”断言，避免几何假通过。

## 4. 包体与性能

| 指标 | r9 同口径基线 | r10 最终 | 变化 |
|---|---:|---:|---:|
| NSIS 安装器 | 185,150,863 B | 185,183,652 B | +32,789 B |
| win-unpacked 文件数 | 315 | 315 | 0 |
| win-unpacked 总大小 | 731,601,270 B | 731,812,266 B | +210,996 B |
| app.asar | 72,087,160 B | 72,298,156 B | +210,996 B |
| 首次启动到输入框可用 | 1,576 ms | 1,323 ms | -253 ms |
| 重启到输入框可用 | 1,946 ms | 1,243 ms | -703 ms |
| 空闲进程工作集 | 4 / 745,447,424 B | 4 / 540,012,544 B | -205,434,880 B |

安装器：`E:\Leemo\dist-package\Leemo Setup 0.0.1.exe`
SHA-256：`AB18469841B7F37CE463AAAC6C296D00C753DB30CB416E46BAC73E775FA14ACD`

本轮没有新增运行依赖、数据库、embedding 模型或按条目拆文件。主 renderer chunk 为 675.91 kB（gzip 197.55 kB），仍有 Vite 的 500 kB 警告；它是明确性能债，但当前没有启动、内存、文件数或安装器体积回退，不为消除警告做高风险重构。

## 5. 自动验证

```powershell
npx vitest run
# 134 files / 1945 tests passed

npm run typecheck
# vendor + host/main + renderer: 0 errors

npm run build
npm run build:main
node node_modules/electron-builder/cli.js --dir
node node_modules/electron-builder/cli.js

node scripts/verify-memory-workspace.mjs
node scripts/verify-memory-restart.mjs
node --check scripts/verify-memory-workspace.mjs
node --check scripts/verify-memory-restart.mjs
git diff --check
```

## 6. 明确未做

- 遗忘曲线：已批准进入 backlog；后续只调整召回优先级，不自动删除事实。
- 后台 LLM 定时整理：已批准进入 backlog；必须默认不静默耗费额度、成本与频率可见、结果可撤销。
- 语义向量库、云同步、记忆图谱：没有真实用户规模证明本地账本与关键词检索不足前不做。
- 真实供应商付费组合矩阵：本轮没有消耗用户额度；证明的是打包 Leemo 到兼容端点、工具、记忆和文件系统的完整产品路径。
