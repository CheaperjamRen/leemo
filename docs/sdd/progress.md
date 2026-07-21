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

[全分支终审] (Opus, 68edca1..befcbb8; 首派遭 API 中断, 续跑完成) **Ready to close: Yes** — 69/69+typecheck 复跑绿; 类型防火墙(三腿别名各自解析一致)/密钥纪律(零 key 形字面量+上游错误体不回显)/vendor 纪律(恰 5 LEEMO-PATCH: G1×3 类型级+G2×2 行为级)/命名全分支达标; live 5/5 无 soft-pass
  - **Important×2(非本批阻塞, 判为 Bridge 前置, 下批开卡)**:
    ①流式 usage 全零≠仅成本问题——CC 自动 compaction 依赖 input token 计数, message_start 硬编码 0(vendor anthropic.transformer ~471)可能致自动压缩经网关永不触发(手动 /compact 已验通); 首查=抓 relay 原始 SSE 看有无 usage 帧→无帧则网关以本地 count_tokens 回填 message_start, 有帧则查透传
    ②ProviderOpts 全表经产线入口死路——registry.fromEnv 硬编码 opts:{}, flattenSchemas/maxTokensField/reasoningInjection 等已测但无法配置; 接第二 provider(GLM)前必须 fromEnv 增 per-provider opts 或 Bridge 自建 registry
  - Minor triage: 修凑手×3(G3 drain 竞态一行 race+一测试 / stripped 日志一断言 / 谓词孪生一锁定测试喂 divergent shape 直打 vendor 路径, 可合并进下批任一网关卡); accept-as-is×5(vendor 备份谓词未测/双 structuredClone/⑧图片占位+o200k 近似/alias-hook 依赖 tsx 序/saveResult redact no-op——安全由进程隔离结构性保证); follow-up 低优×1(上游 401/403→客户端 401 语义混淆, Bridge 侧宜区分 502)
  - Bridge 层建议: 先解流式 usage 再读 result.total_cost_usd(上批遗留④); 自动 compaction 经网关列为下批显式测试目标
== 网关竖切批次 CLOSED (7/21) — 下批: Bridge 层(带走 Important×2 + 凑手 Minor×3 + 低优×1) ==

== 第三批开工 (7/21): Bridge 竖切 ==
计划: docs/plans/2026-07-21-bridge-slice.md (B0-B4, commit 8f3f8a2); 用户计划评审拍板: NewMax usage 模式(流末提取→四维→价目×price/1M 六位精度 TEXT)/余额官方 API 拉取(B2 balance.ts, DeepSeek 必做)/今日七天汇总契约预留实现 Phase 1/permanent 档钩子外置/o200k 回填标 estimated
简报: br-b*-brief.md; 报告: br-b*-report.md

B0 (网关欠账清偿): complete (commit f268f84, review Approved; report=br-b0-report.md)
  - **诊断关键发现(relay-sse-probe)**: 上游确发真 usage 帧(4399/10/cached 3840), 但与 finish_reason 同一网络读——vendor break-on-finish 内循环(anthropic.transformer:923)读不到, safeClose 终 delta 拿到空 usage→全零。根因非上游不发!
  - 修复全自研零 vendor 改动: sniffer(vendor 前扫帧存 sink)+rewriter(vendor 后改写终 message_delta); 真 usage 透传无标记, 无上游 usage 时 o200k 回填标 leemo_estimated:true(B2 estimated 通道); message_start 恒 o200k 估值(真值只在流末, 不缓冲拿不到——复审判合理偏差, **消费方不得把 message_start.input_tokens 当权威, B2 只从终 delta 提取**)
  - 同卡: RELAY2_OPTS JSON env 通道+构造路径测试 / drain-close 竞态修 / stripped 日志断言 / pitfall-02 vendor 直打锁定测试 / 401/403→502 api_error
  - 85/85 绿(69→85), typecheck 绿; 同读批帧回归测试已钉(THE bug 的镇仓测试)
  - Minor 备忘: ①passthrough 热路径 outputText 恒累积(仅内存开销) ②RELAY2_OPTS 畸形 JSON 会致整 provider 不可用(fail-fast 设计, 爆炸半径备忘) ③B4 须 live 验证自动 compaction 经网关真触发(message_start 估值是否够 CC 计数)
→ B1 派卡: 会话池, BASE=f268f84

B1: complete (commits d1c884c + fix 701fe09, re-review Approved; report=br-b1-report.md §修复轮)
  - 交付: providers.ts(buildConversationEnv 纯函数+sanitizeHostEnv 剥密)+pool.ts(createBridge/ConversationHandle 生命周期); 119/119 绿(85→119)
  - sdk.d.ts 核实(防臆造): abort=options.abortController(无 signal 字段)/env 语义=全量替换子进程环境(必须自 spread)/resume?: string
  - 修复轮(复审 Important, 高价值发现): process.env spread 曾架空密钥隔离——宿主 env 的 RELAY2_API_KEY 及兄弟 provider key 会进 SDK 子进程(子进程可跑 bash=printenv 泄漏面), 且原泄漏测试恰空转(fixture key 只在 provider 对象不在 process.env) → sanitizeHostEnv(/_API_KEY$|_AUTH_TOKEN$|_SECRET(_|$)|_ACCESS_KEY/i+ANTHROPIC_API_KEY) 先剥宿主 env 再铺会话自身 token(自伤路径已验防); 泄漏测试 stubEnv 注入真实路径 RED 过
  - 同轮: 并发 send 防护(running 时抛)/mid-stream throw 测试/6 槽位对齐 Phase 0(+OPUS+SMALL_FAST)+DISABLE_NONESSENTIAL_TRAFFIC=1
  - 复审运维备注: 原复审者 transcript 过长致三连 524 超时, 冷启动新复审者自包含派单解决——**长 transcript 复用是超时诱因, re-review 材料本自包含, 卡住即冷启动重派**
  - Minor 备忘: /_ACCESS_KEY/ 未锚定(偏安全侧)/state 提前翻 running(B2 caller 契约微紧)
  - **B2 消费契约: send 透传 SDK 原消息(TMessage 泛型=B2 包装点); registryFactory 占位 B4 定型; streaming-input(Query.interrupt/setModel)=B4 接线点**
  - 验收方亲跑: 119/119+typecheck 绿+泄漏断言(stubEnv RELAY2_API_KEY→undefined)存在 ✓
→ B2 派卡: 事件规范化, BASE=701fe09

B2: complete (commits d34e12b + fix 0b8128e, review Approved; report=br-b2-report.md; 执行=Sonnet 5 首次降档卡)
  - 交付: bridge/{events,pricing,balance}.ts; 164/164 绿(119→164, +45)
  - events.ts: normalizeSdkStream → LeemoEvent 11 variant 判别联合(conversation.started/text.delta/thinking.delta/text.final/tool.started/tool.finished/subagent.activity/compact.boundary/usage.final/run.finished/error); 结构事件映射逐字段比对 checks.mjs 真实形状(复审证实非臆造); subagent 判定认 parent_tool_use_id 存在不认工具名(Agent/Task 双名坑规避); text.delta 防御式可选链(stream_event 形状未 live 佐证)
  - UsageRecord: 字段面⊇proxy_request_logs; cost=NewMax 模式(total_cost_usd>0→sdk / 查表→local-pricing tokens×price/1e6 toFixed6 / 无→unpriced); tokensEstimated 读 leemo_estimated; costSource 三分支+estimated 两分支复审证实非空转
  - pricing.ts: 占位表 DeepSeek $0.14/$0.28/$0.0028(官方 USD) + GLM ¥8/28/2 + Kimi ¥4/21/0.70(官方 CNY @6.7669 换算, 出处 URL+日期入报告); relay2 gpt-5.6-luna 故意不进表(中转站转售价不可查→unpriced, 不编价)
  - balance.ts: DeepSeek(必做)+Kimi 官方端点; GLM supported:false(无公开端点); fetchFn 注入零 live; 错误路径不抛+redact key
  - within-cwd 逃逸检测: resolved===cwd || startsWith(cwd+sep)(复审证 C:\workspaceEVIL 不误判); key redact 复审证网络错误路径无 key 泄漏
  - 修复轮(复审 Important): Kimi 余额 available_balance 是 CNY 错标 totalUsd(虚高 6.8×)→改 totalCny+断言锁币种(0b8128e)
  - 验收方亲跑: 164/164+typecheck 绿+Kimi 断言已翻(totalCny 设/totalUsd undefined) ✓
  - **待 B4 live 验证的假设(执行者标注)**: ①stream_event delta 内部形状 ②leemo_estimated 是否流穿到 result.usage
  - Minor 备忘: within-cwd Windows 大小写敏感(安全方向, 过度告警非漏报); CNY/USD 汇率硬编码快照(Phase 1 清理)
  - **用户 7/21 provider 面提醒(进记忆 provider-extensibility-constraint)**: 未来 20+ provider(官方API/OAuth订阅/中转站/coding plan/自定义)——B3 契约冻结须留 authMode/kind/capabilities 扩展轴, balance.ts 的 id 硬编码是 Phase1 占位不得冻进契约, 09 文档明写"加 provider=加数据不改契约"
→ B3 派卡: 交互桥+IPC 契约冻结(高风险=Opus 4.8), BASE=0b8128e

B3 复审(Opus): Needs fixes — 零 Critical(安全边界干净: ProviderSpec 及全 channel payload 无 apiKey, 扩展轴 authMode/kind/capabilities 是真类型字段), 3 Important 冻结前必修:
  - #1 ConversationConfig re-export 透传 apiKey(经内嵌 Provider)且注释误标"as-is 过 IPC"——非活跃泄漏(无 channel 绑它, createConversation 用无 key 的 CreateConversationRequest)但冻结契约里摆个带 key 的进程内类型是陷阱 → 撤 re-export + 订正注释
  - #2【设计方拍板】审批 allow-conversation 对 dangerous 档过度缓存: 批准 rm -rf /tmp/data 后 format C: 同键(Bash::dangerous)自动放行。**Leemo 设计决定: dangerous 档只给 allow-once, 禁 conversation 缓存也禁 permanent**(把 06 §2.9"dangerous 永不 permanent"补全为"dangerous 永不任何缓存")。理由: 破坏性操作命令特异, 批准一个不得授权另一个。补测试。此决定冻结前会在 09 契约过目节点告知用户可否决。
  - #3 未知/畸形 host decision fail-open(allow-once 与 default 同走 allow): IPC payload 是运行时不可信数据, 安全门必须 fail-closed → default 改 deny
  - Minor: inputSummary 非真脱敏但 09 文档/注释称"脱敏"(命令原文截断展示给用户审批是对的, 措辞夸大)→ 软化措辞; channel↔type XOR 测试靠手维护键集(accept)

B3: complete (commits 30b4745 + fix 6a61e48, re-review Approved; report=br-b3-report.md §修复轮; 里程碑 5 契约冻结件)
  - 交付: interact.ts(ApprovalBroker 三档+危险降档 + createAskUserMcp)+contract.ts(全类型汇总+扩展轴)+docs/specs/09-Bridge-IPC契约-v1.0.md; 206/206 绿(164→206, +42)
  - sdk.d.ts 核实(执行者纠正简报 3 处推测): canUseTool=(toolName,input,{signal 必需,toolUseID,requestId,…})=>Promise<PermissionResult|null>(broker 永不返 null); createSdkMcpServer/tool 如简报
  - 安全边界复审硬验通过: ProviderSpec 及全 channel payload 无 apiKey(密钥永不过 IPC); 扩展轴 authMode/kind/capabilities 是真类型字段(contract.test 类型级钉)
  - 修复轮(复审 3 Important): ①撤 ConversationConfig re-export(内嵌 Provider 持 key) ②【设计负责人拍板补全 06§2.9】dangerous 档只 allow-once,禁 conversation 缓存禁 permanent(rm-rf 批准不授权 format C:) ③审批 default fail-closed deny(IPC 不可信数据); Minor: inputSummary 措辞软化
  - 复审证回归陷阱双清: 非 dangerous 缓存仍工作(moderate seen===1)、happy-path allow-once 仍 allow(独立 case 非 default)
  - 验收方亲跑: 206/206+typecheck 绿+关键断言存在(format C: 再问 seen===2 / 非危险缓存 seen===1 / permanent auto-allow seen===0) ✓
  - **⏸ 用户定稿节点(待过目)**: 09 契约要点——①provider 扩展轴 ②危险命令审批收紧(dangerous 只 allow-once)是否认可
  - **NewMax 对照(用户要求)**: 核心机制平齐; 当场验 usage 缓存扣减无重复计费 bug(网关 input=prompt−cached, pitfall-⑩ 钉); 3 可吸收增强进 backlog(memory newmax-gateway-borrowables): max_tokens 撞400降级重试/定价模糊匹配+名称标准化/能力预检可配置; 审批安全层 NewMax 无=我们增量
[用户 7/21 签字前修订] 用户推翻 B3 严格审批设计 + 要求 provider 对齐 NewMax(读 NewMax-预置Provider全量整理: 33 provider/本地Ollama/OAuth订阅/双协议):
  - 审批哲学修订: 绝大多数用户不审批(觉得危险也不拒, 还要模型干活), 反复弹卡=麻烦非安全; 默认低摩擦, 危险可选放行/一轮一卡, 别老烦 → 宪法 06§2.9 被用户修订(默认安全, 用户可选放开)。记忆 approval-ux-philosophy
  - provider 对齐: authMode 加 none(本地无key), capabilities 加 local/protocolSwitchable/multiKey/requiresProxy 对齐 NewMax 便捷特性(全量目录+设置UI=Provider里程碑)。记忆 provider-extensibility-constraint 更新

B3-R (契约修订): complete (commit 2db6c8a, re-review Approved; brief=br-b3r-brief, report=br-b3r-report)
  - 交付: ApprovalBroker 策略化(PermissionPolicy 驱动) + contract 加 PermissionMode/authMode none/capabilities 轴 + 09 修订; 215/215 绿(206→215, +9 纯新增)
  - 硬 3 行为(复审逐条门控验证): ①bypassPermissions 短路(mode 严格门控, 在 classify/transport/whitelist 之前, 危险也零卡, 默认策略绝不误撞) ②dangerousCommandCaching 开关(默认 false=B3 严格逐字保留, true=危险可缓存, 读 policy 非硬编码, 两档对称) ③fail-closed default 逐字保留
  - plan/acceptEdits 仅契约留位(Phase-1 执行语义), broker 暂按 default, 未臆造工具分类
  - 默认策略 {acceptEdits, dangerousCommandCaching:false}=安全, 有回归测试证省略 policy 仍严(seen===2 双危险再问)
  - 复审证非削弱: interact.test 零删除行(危险默认严/fail-closed/并发/三档逐字未动), contract.test 仅拓宽 authMode union(+none, 原成员仍断言)
  - 主控默认值决定(设计方): acceptEdits 起步 + bypass 明显可选, 未默认零卡(留"agent 尊重我"信号); **用户可改默认为 bypassPermissions 零卡(已告知, 契约已支持, 仅默认档选择)**
  - Minor(accept): acceptEdits 现等价 default(Phase-1 翻转自动放行时须重访默认); 报告 BASE 头 cosmetic 误标
  - 验收方亲跑: 215/215+typecheck 绿 + bypass/toggle/none 断言存在 ✓
== 09 契约含 7/21 修订, 待用户最终签字(两点已按用户意见落地: 扩展轴 + 审批哲学) ==
→ B4 派卡(唯一打真网 live=Opus 4.8): DeepSeek 直连+relay2 网关并发, BASE=2db6c8a, 跑前 VPN 三件套

B4 (Bridge live E2E): complete (commit fef5f4c 已 push, review Approved; 中断一次已恢复; report=br-b4-report.md + phase0-report §八)
  - **核心 7/7 全过**: c1 双接线事件流 / c2 usage 非零(DeepSeek in=21821 $0.162483, relay2-经网关 in=18828 $0.094465) / c3 tokensEstimated 结论 / c4 密钥隔离(relay2 子env=leemo-gw:relay2 占位, 无兄弟key) / c5 审批 live(canUseTool×2 真往返) / c6 resume 召回(MOMO-7413) / c7 CONFIG_DIR 隔离
  - **三待验证假设结清(B4 核心目的)**: ①text.delta **确实产出**(直连43/网关9, events.ts 防御式映射工作) ②**tokensEstimated=false**(leemo_estimated 不流穿到 SDK result.usage, 被剥离, 最终=真值 costSource=sdk)——B2 risk#2 有答案 ③compaction 自动未触发(需10万+token, 手动经网关早在 §七证, 记观测)
  - balance live PASS(DeepSeek totalCny≈25.5, balance.ts 响应形状假设真端点验通)
  - 复审证 c4 修复收窄非掏空(首跑 artifact 证真key断言恒绿, 修复只排短配置值撞正则如 glm-5.2; 真 sk-key 40+字符仍抓; 且名基兄弟key断言独立于形状启发式)
  - **live 逼出的真问题(执行者按纪律没就地修, 报回)**: 经网关对话 costSource 错解析为 sdk——relay 模型伪装 claude- 前缀, SDK 按内置 Anthropic 价算出成本($0.094465 非中转站真转售价), events.ts 规则①"官方端点"前提对网关接线不成立 → **Phase-1/B2 成本准确性 gap**(用量看板本就 Phase-1, 归后续修)
  - Minor(smoke harness, accept): c1 有恒真子条件(text.final 未真断言, 但 started+success+tool-round 承重) / c3 gate 薄 / c6 /7413/ 兜底松
  - 验收方: 复审逐条 artifact 核对 + 泄漏扫描零命中 ✓
== Bridge 竖切 B0-B4 全部完成, 收官全分支终审进行中 ==
