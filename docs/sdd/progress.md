# Leemo Phase 0 SDD 进度台账
计划: E:\幸运鹿AI\...\07-Phase0-实施计划.md（简报/报告/diff 均在本目录 task-N-*.md/txt）
仓库: E:\Leemo

Task 1: complete (root commit 5e8134f, review Approved)
  - 遗留→用户: gh CLI 未装, GitHub 私有仓未建未推; 补救: gh auth login 后 gh repo create leemo --private --source E:\Leemo --push
  - Minor 备忘: 拷贝文档哈希仅执行者自证; 02 清单含历史 Lulu 字样(豁免)

Task 2: complete (commits 869cb05 + fix 598b79a, re-review Approved)
  - 修复: console 脱敏(Critical)/阈值≥4/arg回退/check提示/loadEnv去引号/计划修订记录
  - Minor 备忘(留待顺手): 带引号空值('' /"")会写入空串(无功能影响); fixer 的 Fix3 验证证据无效(复审者读码确认)
  - 阻塞: .env 无 key → Task 3/4 实跑步骤延后; gh 未装 → 远程仓未建(已告知用户)

Task 3: complete (commits 8aeadc6 + hardening 0cdcdb9, re-review Approved)
  - 加固: 夹具无数字/短语+数字断言/token不可猜/10min abort超时/compact归因指引
  - 实跑清单(⚠️带入 Task 5): streaming阈值分片敏感; subagent计数人工核details.answer; compaction全FAIL先验/compact触发路径; 任何check触10min超时=acceptEdits覆盖面不足证据
  - 残留 nitpick: /3|三/ 无词边界(概率已降); timer未clearTimeout(unref兜底)
Task 4: code landed fe5a90b, review=Needs fixes (1 Important: probes.mjs 缺超时加固) → fixing
  - P2 真实数据已到手: AnySearch 国内直连 www 200/579ms, api 404/522ms → 06号§四默认源初步成立

[2026-07-20 下午] 状态推进:
  - Task 4 超时加固修复 dc336e3, 复审已发(后台)
  - 用户已填 .env(四家全SET: deepseek-chat/glm-5.2/kimi-k2.5/中转站niubiapi+gpt-5.6-luna); GitHub 仓库已建 CheaperjamRen/leemo
  - origin 已配置; push 失败(直连443不通,需用户开代理后重试)
  - DeepSeek 实跑(5 checks逐项+probes)后台进行中 → live-deepseek-report.md
  - 备忘: Task4 修复者曾暂移用户 .env 复现无key路径(SHA256校验复原,已请复审者评价该行为)
  - 下一步: 两个后台任务归来 → Task 5(GLM/Kimi 矩阵+报告, Opus 实施)

Task 4: complete (commits fe5a90b + dc336e3, re-review Approved; .env暂移行为获谨慎评价+预防建议.gitignore改.env*)
[2026-07-20 晚] GitHub push 成功: 公司 PAC 代理探明(<token>.proxy.baidu-int.com:8891, HTTPS型), 配置仓库级 git http/https.proxy, main 已上 CheaperjamRen/leemo
DeepSeek 实跑(live-deepseek-report.md): 3/5 PASS(streaming 58ev/tools Read+Write/multiturn 4turns) + subagent&compaction FAIL + probes: resume✅ anysearch✅ relay✅(niubiapi原生Anthropic协议!gpt-5.6-luna 200) canusetool❌
三 FAIL 诊断假设(均指向 harness 侧): ①subagent工具名非'Task'(activity=5证明子agent真跑了) ②/compact流式输入不走命令解析(字符串prompt+resume是正路,d.ts佐证) ③canusetool大小写断言(Hello vs hello)
→ Opus 修复agent后台进行中(diag+fix+复跑三项) → 完成后复审 → Task 5(GLM/Kimi矩阵+报告)

[2026-07-20 深夜] Opus 诊断修复 adb44d6: DeepSeek 5/5 PASS + 4探测全OK (满血制达成, 待复审确认)
  - 三诊断: 工具真名'Agent'(init列表'Task'双名) / compact=resume+字符串'/compact'+需堆~23k上下文 / canusetool根因=模型臆造绝对路径(\root\probe.txt)写出cwd外
  - 两 concern: compaction堆料在GLM/Kimi或有flakiness; 模型越界写路径=产品级发现(审批/工作区隔离设计输入, 进Phase 0报告+06风险表)
  - 复审已发 → 过审后 Task 5 (GLM/Kimi 矩阵 + phase0-report, Opus)

[第三轮复审] adb44d6: subagent/compaction 两修复过审; canusetool 判 Critical(实锤假阳:无Write只Read陈旧文件也ok=true) → cc1b1ff 证据链重建(绑定本轮Write+路径命中+writtenInCwd/preExisted字段+cwd外残留清理), 复跑 ok=true(模型第三次臆造路径 \Users\AZ\advent.2024\probe.txt, writtenInCwd=false) → 第四轮复审中
[排程输入] compaction 三段式最坏 30min/provider(3×10min abort), Task 5 时间预算按此计

[第四轮复审] cc1b1ff 判定语义/范围/复跑全过, 但独立磁盘取证抓到: ①unlink 缺 preExisted 守卫(Critical, 可能删他人预存文件) ②早期遗留两处 probe.txt 在 E:\Users\admin\... 与 E:\Users\neuger\...(模型臆造Unix家目录路径, Windows解析到E盘根真实建了目录树——工作区隔离发现严重度提级)
[修复] fdbce8d: !write.preExisted 守卫 + 两遗留定点清理(删前内容核验=精确hello 5bytes, 只删文件, 全盘扫描归零) + 清理用语收敛 → 第五轮终判中

[第五轮终判] fdbce8d Approved — harness 判定逻辑/证据完整性/工作区隔离/挂死防护/清理安全全维度达标
Task 3+4 (含全部实跑修复): COMPLETE (最终 HEAD=fdbce8d)
→ Task 5 开跑: 三端点全矩阵@HEAD(DeepSeek 也重跑求证据一致性) + phase0-report.md + DeepSeek满血制判定 (Opus, 后台)

Task 5: complete (report commit 598f71b, 已 push)
  - 矩阵: DeepSeek 5/5+4/4 PASS; GLM 5/5+4/4 (满血零降级, 一线候选); Kimi 0/5 全401(凭证级, 端点可达, 待用户换key)
  - **Phase 0 判定: PASS (DeepSeek 满血制达标)**
  - 验收复跑(设计负责人亲跑): DeepSeek 5/5 一致(44ev/obsidian-7413/42/Agent+计数3/23718→2856+88召回) ✓
  - GLM streamEvents=13(粗分片但≥5); GLM assistantTurns=2 vs DS=4
[收官] 全分支终审(Opus)后台进行 → 完成即本批关闭; 下批=02规格v2.0+网关竖切(+Kimi key复跑)

[全分支终审] Ready to close — 三交付物全✅ 无必须现在修; 报告数值逐条溯源吻合; 无密钥泄漏; 未择优挑数(复跑批数值不同同PASS佐证稳健)
[下一批带走 6 项] ①.gitignore 补 .env.* + !.env.example 豁免(高优先,网关批前必做; 裸.env*会误伤example) ②runner --strict 退出码开关(接CI用) ③subagent 断言改结构化计数 ④Bridge 层读 result.total_cost_usd ⑤Kimi 换 key 复跑补矩阵 ⑥E:\Users 空目录壳可选清理
== Phase 0 批次 CLOSED (7/20) ==

== 第二批开工 (7/20) ==
02 v2.0 规格: 定稿 68edca1 (用户四块全确认) — 前端唯一权威
网关计划: docs/plans/2026-07-20-gateway-slice.md (G1-G4), briefs=gw-g*-brief.md
G1 (底座+vendor迁入): DONE 14fd5e6 (Opus, 3×LEEMO-PATCH 上游类型bug/+json5/TS钉5.9.3/3垫片+tsconfig妥协清21错) → 复审中(gw-g1-diff.txt 850行, 重点=patch等价性/tsconfig妥协面/垫片窄度/fastify垫片vs约束/json5边界/文件面)
G2 next: 转换核心 13 坑 TDD (brief=gw-g2-brief.md, 依赖 G1 别名与 vendor)
[新会话交接] 用户嫌上下文贵(530k cache), 已建议里程碑一会话; 本会话收到 G1 复审即到切换点; 新会话读 MEMORY.md+06/08/02+gateway-slice 计划+本台账即可满血接管

G1: complete (commit 14fd5e6, review Approved)
  - 复审确认: 19 文件精确匹配清单/核心1069行R100零改动/3 patch运行时等价/json5合理/fastify仅垫片无真依赖/openai垫片宁窄勿宽(ChatCompletionChunk宽松但零调用点)/smoke未碰
  - **G2 前置条件(复审 Important, 必须写进 G2 派卡)**: 拆 tsconfig——tsconfig.vendor.json(lib:DOM+useUnknownInCatchVariables:false, 只含vendor树) + 根tsconfig(lib:ES2022, 严格catch, 含自研目录); typecheck脚本改两条命令; vitest不受影响
  - G2 brief=gw-g2-brief.md; G3=gw-g3-brief.md; G4=gw-g4-brief.md(RELAY2_*值向用户要)
== 本会话到此为切换点: G1 收官, G2 待派 ==

== 工作区迁移 (7/20 晚) ==
Claude Code 工作区正式切到 E:\Leemo; CLAUDE.md 已建(角色/文档链/铁律/状态入口)
台账与 G2-G4 简报从旧会话 scratchpad 迁入 docs/sdd/ (本文件即台账正本, 后续会话直接续写)
下一步: G2(拆 tsconfig 前置 + 13 坑 TDD, brief=docs/sdd/gw-g2-brief.md) → G3 → G4(要 RELAY2_*)

G2-PRE (拆 tsconfig): complete (commit 438bf23, review Approved; brief=gw-g2pre-brief.md, report=gw-g2pre-report.md)
  - 结构: tsconfig.vendor.json(DOM+宽catch, declaration emit→dist/vendor-types) + 根tsconfig(ES2022+严格catch, exclude vendor, paths 指 .d.ts); typecheck=两条命令(vendor emit 先行, && 顺序硬约束); vitest alias 仍指真实 .ts 不变
  - 验收证据全过: 严格catch RED 探针 TS18046 / --listFiles 零 vendor .ts / 增强合并 + 负对照 TS2339 / 零 LEEMO-PATCH
  - Minor 备忘: ①@gateway/* 映射含 vendor 子树=潜在防火墙旁路(自研代码勿 import @gateway/vendor/**, G2 派卡已带此约束) ②IDE/裸 tsc -p tsconfig.json 需先跑一次 npm run typecheck 生成 dist/vendor-types(gitignored)
→ G2 正卡: Opus 执行, BASE=438bf23

G2: complete (commits b8603aa + fix 898fa16, re-review Approved; report=gw-g2-report.md §修复轮)
  - 交付: core/{translate,normalize,provider-opts,tokens}.ts + 13 坑测试文件(58/58 绿) + fixtures + 恰 2 处 LEEMO-PATCH(reasoning gate line~192 / server-tool observable strip)
  - 修复轮(复审 Important): server-tool 判定统一为 normalize.isServerTool 单一活跃源(type-based, 忽略 input_schema); facade anthropicToOpenAI 先于 vendor 剥离并返回 {result, stripped}——G3 经 translate 即拿剥离列表, 不触 vendor; pitfall-09 预算断言钉字面值(4000/12000/24000/40000/60000/16000)
  - **G3 消费契约: anthropicToOpenAI 返回 {result: OpenAIChatBody, stripped: AnthropicTool[]}(AnthropicToOpenAIResult), 非裸 body**
  - 验收方亲跑: 13 坑测试名齐全 PASS + typecheck 两段 exit 0 ✓; 抽读①②⑨⑫断言实(复审确认非空转, ⑫快照配独立结构断言)
  - Minor 备忘(留待收官终审 triage): ①vendor 备份谓词无测试覆盖(活跃路径已由 facade 预剥离, 死代码低危) ②谓词双文本副本靠注释互指同步(单一"活跃"源非单一文本源) ③双 structuredClone 微开销 ④⑧图片-only tool_result 留占位文本/⑩⑫尾 usage 依赖 SSE framing/o200k 近似——三项 G4 live 复核
→ G3 派卡: 网关薄壳, BASE=898fa16

G3: complete (commit be3d32d, review Approved; report=gw-g3-report.md)
  - 交付: server.ts(startGateway, 127.0.0.1:0, 全路由面)+registry.ts(内存Map+fromEnv+脱敏logger)+dev.ts+server.test.ts(12 用例, mock 上游全链路); 69/69 绿+typecheck 两段绿
  - 密钥隔离/abort/不缓冲三大断言复审确认非空转: 真key只出现在mock上游收到的头(响应+日志扫描无key); abort=mock侧req close实证(ac.abort()承重); SSE双时间戳断言(缓冲实现两条都必挂)
  - 计划外新增(复审裁定合理非蔓延): src/gateway/alias-hook.mjs——tsx/node 不读 tsconfig paths, dev.ts 需运行时别名解析; hook 仅 dev.ts 自注册, vitest 零加载零干扰; 冻结配置(tsconfig/vitest.config)未碰
  - Minor 备忘(留待收官终审 triage): ①backpressure+断连竞态可悬挂 drain promise(上游已由 abort 释放, 仅 promise 泄漏) ②stripped 非空日志行为已实现未测试 ③alias-hook 依赖 tsx 先注册补 .ts 扩展(裸 node --import 会挂, 仅 dev 入口用) ④上游 401/403 映射为客户端 401 语义略歧
  - 验收方亲跑: 69/69 + typecheck exit 0 + closedEarly/authorization 断言存在 ✓
== G4 门口: 需用户提供 RELAY2_*(OpenAI 协议端点)才能开跑 ==

[7/21] RELAY2_* 已配(用户选中转站 niubiapi: BASE=https://www.niubiapi.com/v1, MODEL=gpt-5.6-luna, key 由 .env 内复制, 未出对话)
G4: complete (commit befcbb8 已 push, review Approved; report=gw-g4-report.md)
  - **网关竖切 Live 验收 PASS (5/5)**: streaming✅ tools✅ multiturn✅ subagent✅(Agent 工具) compaction✅(boundary+召回) via 网关→niubiapi(gpt-5.6-luna)
  - 设计: 子进程边界=密钥边界(runner 不读 .env, SDK 子进程 env dump 实证只有 leemo-gw:relay2 占位); 复审确认无 soft-pass 路径, §七数值与 results JSON 逐项吻合, 泄漏扫描零命中
  - 验收方亲跑复跑: 5/5 一致(streaming 14ev/tools obsidian-7413/multiturn 蓝色鲸鱼42/subagent Agent+activity7/compaction 21650→2766+紫色大象88) + 泄漏扫描零命中 ✓
  - **零 usage 疑点(留 follow-up 卡)**: 流式 message usage 全零(直连时有值); 但验收复跑 compaction pre_tokens=21650 非零(执行者轮为 0, 有波动)→count_tokens 链路通, 问题聚焦流式 usage 映射(坑⑩ live)。复审给出决定性首查: 抓 relay 原始 SSE 看是否有带 usage 的 data 帧——无帧=上游不发(需 count_tokens 兜底), 有帧=网关透传 bug
  - Minor 备忘: saveResult 的 env 基 redact 在本 runner 为 no-op(安全实际来自进程隔离+泄漏扫描, 非 redact 层)
== 网关竖切 G1-G4 全部完成, 收官全分支终审进行中 ==

[7/21] 网络环境变更(用户通知): 公司网络弃用→私人 VPN(127.0.0.1:10801, 仅外网用)
  - 仓库级 git http/https.proxy(baidu-int)已删; GitHub 直连验证 OK
  - niubiapi 直连 403 事件(G4 验收后复跑失败)诊断: Node fetch 被拦(疑 Cloudflare TLS 指纹, PowerShell 能 200), 非代码回归; 解法=NODE_USE_ENV_PROXY=1+https_proxy=VPN+no_proxy=127.0.0.1(保 SDK→网关直连), streaming 复跑 PASS 3.8s; 已写进 CLAUDE.md git 条目
  - 上批遗留① (.gitignore 补 .env.*+!.env.example) 核实: 工作区迁移时已带上(.gitignore 现含三行), 关闭
