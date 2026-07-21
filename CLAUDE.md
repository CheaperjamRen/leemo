# Leemo — Claude Code 工作区指引

Leemo（人格：momo/默默）= 基于 claude-agent-sdk 的桌面 AI 工作台+搭子（Electron+React+Vite+Tailwind+Zustand，CC SDK **锁 0.3.210** 不逐版跟随）。你在本仓库的默认角色：**设计与验收负责人**（设计文档/任务卡/system prompt 亲写，全部验收把关）。

## 权威文档链（冲突时后者覆盖前者；新会话按需读，别全读）

1. `docs/specs/02-已定决策清单.md` — 宪法（7/16 拍板，不得重开）
2. `docs/specs/06-Leemo-产品设计文档-v1.0.md` — 修订宪法（7/19 brainstorming 定稿）
3. `docs/specs/08-交互可视化与NewMax吸收增补-v1.0.md` — 06 增补（可视化 A 档+问询卡进首发）
4. `docs/specs/02-前端设计规格-v2.0.md` — **前端唯一权威**（视觉基准=`docs/design-audition/k3/` 两张 HTML）
5. `docs/reports/phase0-report.md` — Phase 0 实证事实（PASS；工具双名 Agent/Task、compact 机制、模型臆造路径等硬发现，设计必须引用）

## 当前执行状态

- **台账：`docs/sdd/progress.md`**（历史进度+审查记录+下一步，接手先读这个）
- 进行中：网关竖切 `docs/plans/2026-07-20-gateway-slice.md`（G1 ✅ 过审 14fd5e6；**G2 待派**，简报=`docs/sdd/gw-g2-brief.md`，**前置条件：先拆 tsconfig**——vendor 用 lib:DOM+宽 catch、自研用 lib:ES2022+严格，详见台账）
- G4 需向用户要 RELAY2_*（OpenAI 协议端点）配置

## 铁律（每次派卡/验收都适用）

- **执行者≠验收者**。分工：K3=前端视觉/组件卡（Kimi Code CLI，无头 `kimi -p` 驱动，只做视觉层不碰 store/IPC）；GLM5.2=规格写死的自包含逻辑卡；Opus4.8=高风险+对抗审查；本会话=设计+验收。
- TDD 边界：Bridge/IPC/store/MCP/**网关**=严格 TDD；前端视觉=用户目验；前端逻辑（reducer/store）要测试。
- 任务卡自包含：文件清单+禁改清单+验收命令；验收只认可复现证据。
- 密钥纪律：key 只经 `.env`（已 gitignore）；任何文件/日志/commit 无明文 key。
- 命名：Leemo/momo；新内容禁"幸运鹿/LuckyDeer/Lulu"。
- 名词预算=2（本子/成果）；新想法先过通用性检验（删掉"学习"还成立吗）再进 backlog；已拍板决策不劝改。
- `smoke/` 是 Phase 0 已验收资产：跑可以，改需专门立卡。
- git：公司代理已弃用（仓库级 http.proxy 已删）；GitHub 直连可用。用户私人 VPN 代理=`http://127.0.0.1:10801`，**仅**外网访问（Google/web search 等）时设 `http_proxy/https_proxy`；模型端点均为国内直连不走代理。⚠️ niubiapi 中转站从本网络会 403 掉 Node fetch（PowerShell 能过）——跑 `smoke/gateway-live.mjs` 需先设 `NODE_USE_ENV_PROXY=1` + `https_proxy=http://127.0.0.1:10801` + `no_proxy=127.0.0.1,localhost`（已验证 PASS）。
- 用户偏好：**AskUserQuestion 选项卡提问（每轮≤4 问）**；用户会在 Other 里写高质量补充，逐句认真读；里程碑一会话（省上下文成本）。
- 会话成本纪律：**里程碑/批次收官时主动产出新会话交接 prompt**（自包含、指向文档不内联长文，便宜起步）；平时每到阶段节点评估一次"续本会话 vs 新开"的成本（上下文已积多大、台账/简报是否足以让新会话满血接管），主动告知状况+建议。用户目标=又便宜又好又高质量。
- 模型分档纪律（7/21 拍板）：**主控会话=Opus 4.8**（Fable 仅在撞真正架构僵局时经用户同意临时升档）；执行者按卡分档——规格写死/纯 TDD 实现卡=Sonnet 5，高风险卡（契约冻结、live 验收、vendor patch）=Opus 4.8；**复审者/终审者一律 Opus 4.8 不降档**（钱花在不可逆判断点，省在可返工执行点）。派 subagent 时必须显式指定 model。

## 旧工作区（只读参考）

`E:\幸运鹿AI\` = 旧仓库（背景文档/NewMax 逆向报告在 `E:\Leemo\docs\NewmaxAI逆向报告\` 已有拷贝；更深背景才回去查）。旧自研引擎/fable5 全封存。
