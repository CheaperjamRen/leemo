# 交接 · 轮 6（轮 5 打包已 CLOSED）

> 用途：新会话开窗即用。**下一轮做什么由用户在 prompt 里直接给**，本文只交接
> 「现在站在哪儿 + 踩过哪些坑 + 铁律」，不预设任务。

## 起点（都已核实，不是回忆）

- **BASE commit**：`21cc248` `feat(pack): Windows NSIS 安装包 + 打包态原生 CLI 显式寻址 + 修白屏`
- 分支 `main`，**未 push**（用户选本地合）。跟踪文件零改动。
- 仓库长期有一批**先前就在的**未跟踪件（`.kimi/` `.claude/` `comate/` `openspec/`
  `findings.md` `progress.md` `task_plan.md` 等）。**别 `git add .`**，只加本卡文件。
- **门禁现状**：`npm test` → **1455 passed / 112 files**；`npm run typecheck` → 三段
  exit 0；`npm run build` / `npm run build:main` → 干净。
- **轮 5 交付物**：`dist-package/Leemo Setup 0.0.1.exe`，**188.77 MB**（gitignored）。

## 必读（按顺序，别跳）

1. `CLAUDE.md` —— 项目铁律、分工、密钥纪律、命名规范。
2. `docs/sdd/progress.md` **第 1054 行起「轮 5」整节** —— 技术抉择表、asar 与原生 CLI
   的坑、白屏真 bug、**验收器返工四次**那节、三层验收证据、需求覆盖表、明确未做。
3. `comate/15-待目验清单-2026-07-25.md` —— **7 项攒着等用户目验**（见下）。
4. 五份权威规格见 `CLAUDE.md` 里的清单（06 产品设计 / 02 前端规格 为主）。

## 轮 5 落了什么（一句话版）

三件承重：① `src/main/cli-binary.ts` 的 `resolveCliBinary` 显式把原生 CLI 路径经
`pathToClaudeCodeExecutable` 交给 SDK（打包后 SDK 自己解出的是 asar 内部路径，
`existsSync` **为真**但 `spawn` 必然失败）；② `vite.config.ts` 加 `base: "./"`
（默认 `"/"` 让 `file://` 下 JS/CSS 双双 404 ⇒ 纯白窗口 + 控制台**零错误**）；
③ `electron-builder.yml` 的 `asarUnpack` 摊开 `claude.exe`(241MB) 与 `better-sqlite3`，
`npmRebuild: false`。

验收脚本留仓可复跑：
- `scripts/verify-r5-packaged.mjs <exe>` —— 打包产物三趟（bootstrap / encrypted /
  freshuserdata），轮 5 实测 **24/24**
- `scripts/verify-r5-installer.mjs` —— 真安装包：静默装→跑装出来的 App→卸干净，**7/7**
- `scripts/probe-file-protocol.mjs` —— **40 秒**验 `file://` 能不能挂上界面（不用等
  8 分钟打包）
- `scripts/probe-fresh-home.mjs` / `scripts/probe-github-shasums.mjs` /
  `scripts/http-trace.cjs` —— 三个诊断探针

## 攒着等用户目验的 7 项（`comate/15`，越攒越难判）

1. **momo 聊感**（卡 A / comate/11）
2. **AskUserCard 视觉**（卡 D / comate/14）
3. **搭子态历史抽屉**（真对话列表，非假字符串）
4. **Skills 触发视觉**（卡 E / comate/16）
5. **Provider 设置页视觉**（轮 3 卡 F / comate/17）
6. **本子=目录手感**（轮 3 卡 G / comate/18）
7. **三层联网开关 + 预览区 + 成果页**（轮 4 收尾 / comate/21）

轮 5 之后又多一项可看的：**打包后的真界面**（装出来的 App，不是 dev）。
目验时我只负责把窗口摆好 + 截图存证，判断归用户。

## 未做 / 欠账（别当成没发现）

**轮 5**：
- 安装包**未签名** ⇒ SmartScreen 会警告。要签名得先买证书（**等用户拍板花钱**）。
- **图标是 Electron 默认的**（没有 Leemo 图标资源）。
- **188.77MB 有 40-50MB 重复**：`pdfjs-dist`(36MB)/`react`/`zustand` 等**纯渲染端**依赖
  既被 vite 打进 `dist/`、又作为生产依赖进 asar。挪去 `devDependencies` 可省，但
  **排错依赖会让 App 起不来**（`build-main.mjs` 是 `packages:"external"`，运行时真要从
  node_modules 解析）。要做就配 `verify-r5-*` 全跑一遍再收。
- 自动更新未接（`latest.yml` 已产出，无 publish 配置）；mac/linux 仍 `target: dir`。
- **`~/Leemo` "从空目录首次创建"未在打包态实测**（Windows 上 `app.getPath("home")` 不认
  环境变量，详见下方坑 5）。创建逻辑由单测覆盖，台账记为**部分完成**。

**轮 4 留的**：
- 设置页仍没显示"这次搜索是谁供的货"（`stats().byLayer` 已分三格，界面没读）。
- PDF 只渲染前 30 页（`MAX_PAGES`）；GB18030 等非 utf8 中文判成"不能预览"。

**Phase-1 老账**：store 订阅生命周期、fixture default-case（见
`docs/sdd/progress.md` 与记忆 `fe-slice1-phase1-gates`）。

## 会再撞的坑（轮 5 实测，已进记忆）

1. **打包要代理，跑 App 要清代理**。`npm run electron:pack` 在本网络不设
   `https_proxy=http://127.0.0.1:10801` 会挂 600s 报
   `Timeout awaiting 'request' for 600000ms`；卡的**不是** `github.com`，是 302 之后的
   `release-assets.githubusercontent.com`。而**跑 App / 实机验收前必须把代理变量清掉**
   —— 模型端点是国内直连。
2. **中途杀掉打包会留 `%TEMP%\eb-dl-*.lock.lock`**，下次打包**零网络、零 CPU 干等约
   10 分钟**，症状和坑 1 一模一样但成因完全不同。重跑前先清。
3. **验收跑过后 `win-unpacked` 会被占**（`EBUSY: rmdir`），杀进程也不一定立刻释放。
   别较劲，换输出目录：`npx electron-builder --config.directories.output=dist-packageN`。
4. **判据必须锚到"这一次输入"**。轮 5 验收器返工四次，四次都是判据在骗人：
   `kind:"assistant"` **这个 kind 不存在**（是 `{kind:"text", role:"momo"}`）；
   `conversations[0]` 常是**上一趟的旧对话**（`loadAll` 按 `last_activity_at DESC`）；
   持久化形状是 `{meta:{id}, timeline}`（**不是 `c.id`**）；**CDP 的 `returnByValue` 把
   `undefined` 序列化成 `null`** ⇒ 排除条件恒真；搭子态**复用同一个对话** ⇒ 只锚对话
   仍读到上一趟。正确锚点 = **`runId`**（`run-${++runSeq}`）+ 问句拼一次性 nonce。
5. **Windows 上 `app.getPath("home")` 不认 `USERPROFILE`/`HOME`**（走系统 profile API；
   注意 Node 的 `os.homedir()` **是**读 env 的，两者不同）。三个变量全改会让打包 App
   崩 `0x80000003`。隔离 userData 用 **`--user-data-dir`**（有效）。
6. **流式在库里结构性测不到**：`persistence/sync.ts` 防抖落盘且每次 store 变化都
   `cancelPending?.()` 重置计时器 ⇒ 流式期间**一次都不写库**。要判流式看 DOM 的
   **`.leemo-caret`**（只在 `item.streaming` 为真时渲染）。
7. **窗口被遮挡会停 rAF**，渲染类判据会假失败。实机跑必须带
   `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`，
   并先确认 rAF 活着。
8. **Tailwind v4 无 `@theme` 块**：`text-ink-2` 这类类名**静默不生成 CSS**，必须
   `text-[var(--leemo-ink-2)]`。

## 铁律（违反过，都付过代价）

- **完成的定义** = 测试绿 + typecheck + 实机亲验 + **commit 落盘有 hash** + 需求覆盖表
  （做了 / 部分 / 没做逐项列）。缺任何一项不许说"收工/完成/修好"。
- **测试+typecheck 一绿就立刻 commit 并给出 hash**，不等确认、不先写总结。**禁止问
  "要我 commit 吗"** —— 用户的核验流程建立在 commit 之后，不提交等于卡住他。
- **报数字前从磁盘/命令输出回读**，别凭记忆写台账。本轮就出过：说了一个**不存在的
  commit hash**、说"记忆文件已落盘核验"而**文件不存在**、说"9/9 安装包验收"而**根本没
  跑过**。台账和交接是给用户当事实用的，写错比不写贵。
- **报 PASS 之前读一眼旁证**：t+1s 出结果、回复答的是上个问题、id 是 `undefined`
  —— 任何一条对不上就当没过。一屏全绿完全可以是假的。
- **密钥**：key 只经 `.env`（已 gitignore）。任何文件/日志/commit 不得有明文 key。
- **技术选型主控自己拍**，简述理由即可，别让用户在看不懂的选项里纠结；产品体感/视觉
  归用户。
- **Windows 杀进程按端口或 PID 验证**，别按进程名。
- **命名**：Leemo / momo。禁用"幸运鹿/LuckyDeer/Lulu"。名词预算 2 个（本子、成果）。

## 下一轮任务

<!-- 用户会把轮 6 的任务直接写在 prompt 里。此处留空，不预设。 -->
（本文不预设任务。）
