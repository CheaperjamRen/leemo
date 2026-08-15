# 交接：启动轮 1 步 1 — Electron 承重墙

> 2026-07-24 ／ 出自：Fable 5 主控会话（第八批通电竖切收官）
> 给：Opus 4.8 xhigh 新主控窗口
> **监督体制变更：Comate 为常设监督者**（只读核验，产物在 `comate/`），验收以其清单为准，主控不得与其口径打架。

---

## 0. 一句话现状

通电已实证并**落盘**（代码 `409f116` + 文档 `d9b2aba`，clean checkout 即得 71 files / 591 tests 绿 + typecheck 三段 exit 0）：浏览器里搭子输一句 → WS → src/host → 真 SDK → DeepSeek 直连 → 真流式回界面，momo 人格占位 prompt 生效、审批/ask_user 往返可用。你的任务：**把 WS 传输换成 Electron IPC，浏览器变桌面 App，key 进 safeStorage**。

## 1. 先读（按序）

1. `CLAUDE.md` — 角色/权威链/铁律/模型分档
2. 本文件全文
3. `docs/sdd/progress.md` **末尾两条**（第八批 + 补账条：需求覆盖表 + 收工定义修正）
4. `comate/04-通电核验报告-2026-07-24.md` — 监督者的核验方式，你的汇报会被这样查
5. 需要时才读：`docs/superpowers/plans/2026-07-24-power-on-vertical-slice.md`（含已核实签名速查表）、`docs/sdd/host-a-report.md` / `host-b-report.md`

## 2. 任务（Comate 派卡原文，逐字执行）

启动轮 1 步 1：Electron 承重墙。边界：
- 引入 electron 依赖 + electron-builder，建 main 进程入口
- 建 preload，用 contextBridge 暴露 IPC 通道；新建 `IpcBridgeClient` 替换 `WsBridgeClient` 作为 Electron 内默认（走 ipcRenderer/ipcMain）
- 主进程装配现有后端库（**复用 `src/host/bridge-host.ts`，只换传输边**）
- safeStorage 加密 API key（替换 .env 明文路径）
- **不做 SQLite**（步 2），conversations 仍内存态

**验收标准（Comate 核验 + 主控实机目验，全项必过）：**
① `npm run electron:dev` 起桌面 App ②搭子输一句 → DeepSeek 真流式回界面（IPC 传输，非 WS）③key 走 safeStorage，.env 不再是运行必需 ④typecheck 三段 exit 0 ⑤**commit hash + 需求覆盖表** ⑥git clone 后能跑通测试 ⑦主控 devtools/实机亲验 + 截图存证（`docs/sdd/evidence-*.png` 先例）

## 3. 技术底牌（上会话核实过的事实，直接信，别重新考古——上上会话死于反复读签名）

- **`src/host/bridge-host.ts` 是传输无关的组装核**：`createBridgeHost({catalog, dataDir, sandboxDir, push, queryImpl?}) → {handleInvoke(channel, req), dispose, inspect}`。Electron main = 复用它 + 把 `ws-server.ts` 换成 ipcMain。**ws-server/dev.ts 不删**（保留为浏览器 dev 通道 + smoke 用）。
- **契约冻结不需要改**：`src/bridge/contract.ts` 的 14 channel 本来就是按 IPC 设计的。推荐接法：ipcMain.handle 一条多路复用通道收 `{channel, req}` → `host.handleInvoke`；推送用 `webContents.send(channel, payload)`；preload 只暴露 `{invoke(channel, req), on(channel, cb)}`。`IpcBridgeClient` 抄 `ws-client.ts` 的形状（实现 `BridgeClient` 接口），比它还简单（ipcRenderer.invoke 天然返回 Promise，不用自己管 pending map）。
- **renderer 客户端选择**：`window.leemoBridge` 存在 → IpcBridgeClient；否则 `VITE_LEEMO_LIVE=1` → WsBridgeClient；否则 fixture。现有 opt-in 逻辑在 `App.tsx`。
- **SDK 在 Electron main 里能跑**（它就是 Node，spawn 子进程；Phase 0 在纯 Node 验过 5/5）。dev 模式沙盒/数据目录沿用 `.leemo-workspace/`；打包态换 `app.getPath("userData")`（本步只要求 dev 跑通）。
- **中国网络装 electron**：先设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再 npm install，否则二进制下载会卡死。
- **main 进程构建**：tsx 不能直接当 electron 入口。可选 esbuild 打包 `src/main/**` → `dist-electron/`（轻）或 electron-vite（重）。选轻的，理由写报告。tsconfig：`src/main` 会被根 tsconfig.json 自动覆盖（include=src 减 renderer/vendor），补 electron types 即可。
- **safeStorage 范围克制**：本步最小闭环 = 首次启动读 .env 迁移 → `safeStorage.encryptString` 存 userData → 之后从加密件读、喂 `buildCatalog`。设置页输入 key 的完整 UI 是后续卡，别顺手做。
- **杀进程按端口**（血泪教训，见 memory）：`Get-NetTCPConnection -LocalPort 8787,5173 → OwningProcess → Stop-Process`，重启必验新 PID。可能有两个旧 PowerShell 窗口还开着 bridge:dev/vite，先清。

## 4. 铁律（新增项加粗）

- 执行者≠验收者；主控亲跑测试+typecheck+实机目验，不信执行者报告（本项目执行者谎报 3 次前科）
- **收工定义 = 测试绿 + typecheck + 实机亲验截图 + commit hash + 需求覆盖表。缺一不许说"收工/完成/修好"**（7/24 用户+Comate 确立，见 memory `definition-of-done-commit-gate`）
- 密钥零明文出现在代码/日志/commit；safeStorage 迁移时尤其注意日志
- 模型分档：主控 Opus 4.8 xhigh；规格写死卡=Sonnet 5；高风险+复审=Opus 4.8。派卡显式指定 model
- 用户非技术背景，只管产品体感；技术决策主控自己拍，简述理由即可，别让他在看不懂的选项里纠结
- git：commit 要有意义的批次粒度；不 push（无 origin）

## 5. 已知未做清单（别在汇报里漏，别顺手做）

Skills 触发（MOCK）/ 按对话选模型（面板占位）/ 人设卡话风接线（settings 有数据 host 不读）/ memory 分层（settingSources:[]）/ 附件进对话（契约无字段）/ SQLite（步 2）/ **momo 人格 prompt 06 §7.2 五件套组装器（已承诺的专门卡，prompt 文本须用户亲审，排序听 Comate/用户）** / 工作台 InputArea 统一 / 每轮 21.7k 入参 tokens 优化（CC 全量工具下发，搭子纯聊可裁）

## 6. 起手式

1. 读 §1 清单 → 2. 清旧进程（按端口）→ 3. 写本步实施计划（含文件清单/验收命令，可派卡可亲做，Electron 装配这种高风险缝合建议主控亲做+Sonnet 打下手）→ 4. 施工 → 5. 全项验收 → 6. commit + 需求覆盖表 + 报 Comate 核验 → 7. 用户目验过 → 进步 2（SQLite）
