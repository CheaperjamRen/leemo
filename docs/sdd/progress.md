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

[全分支终审] (Opus, 8f3f8a2..f6f78a5, 17 commits) **Ready to close: Yes** — 215/215+typecheck 独立复跑绿; 契约连贯机器可核+密钥全批零泄漏(sanitizeHostEnv 承重, B4 env dump 实证); 审批姿态自洽(默认安全/bypass 严格门控/fail-closed); 类型缝无漂移
  - **Important×2(均 latent 无首发消费者+impl-only 不动契约, 记为下批 gate)**:
    ①**costSource=sdk 错算所有 provider(终审修正: 非仅网关)**——无 Leemo provider 是真 Anthropic API, DeepSeek 直连发 model=deepseek-chat / relay 发 claude-伪装名, SDK 都按内置 Anthropic 价算 → DeepSeek 直连 $0.162 vs 真值~$0.003-0.01(20-50× 虚高), rule② local-pricing 被 rule① 短路。根因=NormalizeCtx 无接线/真伪信号, events.ts 无法辨真 Anthropic vs 伪装。**必须先于前端渲染任何成本修**。修法: NormalizeCtx 加 trustSdkCost(或 authMode/kind==anthropic 官方)标志, rule① 只对真 Anthropic 触发, 其余落 local-pricing→unpriced。
    ②审批 dangerLocked 守写不守读——已持久化的 {Bash,dangerous} 白名单项(仅 toggle=ON 时可写)在 toggle 翻回 OFF 后仍被读命中自动放行, 违背"dangerous 严格每次问"。首发不可达(内存持久化+无运行时 toggle)→ Phase-1 gate。修: dangerLocked 也跳白名单/缓存读(fail-closed read)。
  - Minor: pool↔interact 接线未做(canUseTool/mcpServers/permissionMode 只在 B4 smoke adapter 接, 产线 pool 未穿)——**Phase-1 首个任务**, 契约有效(进程内非 IPC, 后加字段不动冻结); pathAudit 无顶层逃逸信号(前端备忘)
  - 7 累积 Minor triage: costSource+CNY 汇率+acceptEdits==default → Phase-1; 其余 accept-as-is(过剥安全向/命令原文展示刻意/harness 非产线)
  - 下批建议: ①costSource 修先于成本 UI ②pool↔interact 接线(permissionMode 变 live) ③SQLite 持久化时闭合 dangerLocked 读写不对称 ④balance/pricing 派发从 id 改 kind ⑤前端可依 09/contract.ts 现在施工(冻结/连贯/无 key)
== Bridge 竖切批次 CLOSED (7/22) — 测试 85→215 全绿; 含用户两轮深度介入(NewMax provider 对照+审批哲学修订) ==
下批候选: Provider 目录里程碑(填 33+ provider 对齐 NewMax) / 前端壳(依 09 契约) / Phase-1 骨架(pool↔interact 接线+SQLite+成本修) — 待用户定, 交接 prompt 已备

== 第四批: 前端壳 slice-1 (buddy 搭子落地页) CLOSED (7/22) ==
计划: docs/plans/2026-07-22-frontend-shell-slice.md; 骨架计划: docs/sdd/fe-slice1-skeleton-plan.md; 视觉基准=docs/design-audition/k3/buddy-mode.html; 穿衣卡=docs/handoffs/F-01-k3-buddy-dressing.md
四拍循环: 骨架(TDD)→验收①→K3穿衣(beat2)→验收②
- beat 1 (骨架, TDD, 7 commits 至 1020f49): hexagonal — BridgeClient 端口镜像 contract.ts / FixtureBridgeClient / 纯 applyEvent reducer / zustand stores / 组件经 context hooks 读 store(guard.test 文件扫描守 02§2.1) / live send loop; 测试 215→232 (+17 renderer), 验收①过
- beat 2 (K3 穿衣, commit c699b73): K3 视觉语言填入骨架(纯视觉, 结构/store/props 冻结) — effects.css(grain/晨光/rise/breathe/halo/blink/twinkle/阴影/chip/reduced-motion) + 10 组件内联SVG图标/胶囊切换器/serif开场白/focus环 + MomoAvatar 全脸+光晕底座(§6 对比度修: size 缩放暖光晕, 26px×#FAF6EE/#F6F6F7 双底可辨, 无硬边框)
  - 派发: 无头 kimi -p(裸 -p, 非 --yolo/--auto 会冲突) 驱动 K3; 整合后复跑绿
  - 设计负责人收尾(逻辑, TDD): ①InputBox IME composition-gate 测试(锁 compositionStart/End 挡发, jsdom userEvent{Enter} 覆盖不到) ②Clock 实时系统时钟(日期·周几·时:分, 每分 tick + unmount 清 interval, 守 Phase-1 生命周期纪律)——替 K3 硬编码假日期"4月16日周四", 删时段词重复(开场白已承担); 用户 beat2 验收中点名两 bug: 头像对比度(已修)+日期错(4/16→实时时钟)
- 验收②过(用户目验: 视觉达标 + 头像对比度认可); 测试 232→241 全绿, typecheck 3段 exit 0
- **合并**: git worktree(harness 建于 .claude/worktrees/, locked)→ main 无冲突合入(merge d36d332, 三 slice-1 设计 doc 双分支 blob 相同故 merge-tree 零冲突); main npm install 同步 node_modules(worktree 不共享)后复跑 241 绿+typecheck 0 实证
  - **worktree/分支未清理**: harness 拥有(非 Superpowers .worktrees/), 按 provenance 不擅自 remove; 分支 worktree-fe-slice1-skeleton 仍 checkout 于此 → 未 branch -d; 未 push(用户选本地合)
- Phase-1 gate(记忆 fe-slice1-phase1-gates, 2 条未动): store 订阅生命周期(单例 IPC 前必修) / fixture default-case 白谎
下一步: slice 2 (消息展示卡: 工具/计划/活动/结果卡, 视觉基准=workbench-mode.html) — 或按用户定

== 第五批: 前端 slice-2 消息展示卡 + slice-2.5 UX补全 CLOSED (7/22) ==
spec/plan: docs/superpowers/specs/2026-07-22-slice2-message-cards-design.md + slice2.5-message-ux-design.md; plans/2026-07-22-slice2-message-cards.md + slice2.5-message-ux.md; 视觉基准=k3/workbench-mode.html
执行: subagent-driven-development (Sonnet 实现 + Opus 复审/终审); 合并 merge 4b880ba → main; **branch s2-cards 已全合 main (是 main 祖先)**; worktree .claude/worktrees/fe-slice2-cards harness-locked 未清(同 slice-1, 待用户/harness 清)
- **S2 骨架 (7 TDD 任务, e305fb4..92e9aa4)**: TimelineItem 判别联合 reducer (text/tool/plan/activity/result/compact 折叠, TodoWrite 防御式解析) / 6 纯展示卡 (guard 铁律零端口引用) / fixture 完整演示回合 (gate#1/#2 字节级未动) / Timeline+RunGroup 折叠 / 退休 MessageList; 241→262 测试; Opus 终审 READY TO MERGE
  - 目验① 抓 bug: 流式完成不自动折叠 (单测盲区: 只测挂载即完成; 流式 mount-in-progress→result 到达停在展开)。修 92e9aa4: render-phase state adjustment (track prevFinished, 非 useEffect) + 回归测试
- **S2.5 UX补全 (9 任务, 940b426..f81111f; 目验① 反馈=成熟 Agent 对话模型)**: ①reducer 停止丢弃 usage.final/error (新 usage/error variant) ②每 send 起新 runId + activeRunId + interrupt (gate#1 subscribe 结构未动) ③fixture interrupt 掐流+emit interrupted (gate#2 default 未动) ④**严格时序 TurnBlock + ProcessFold(原位折叠) + MessageFooter(复制+token替「完成」卡)** — 修目验① 的折叠错位 bug (用户消息不再排过程下方) ⑤Timeline 按回合渲染 ⑥PinnedPlan 输入框上方常驻计划卡 (借鉴 CC/Kimi/NewMax) ⑦liveness 状态行+停止键 ⑧智能滚动 (跟随/上划暂停/回到底部按钮)
  - 执行提速: 用户成本反馈 (主控每轮重建300k缓存太贵) → T4起批处理 (batchA=T4+T5, batchB=T6+T7+T8) + 集成边界一次复审 + Opus 终审兜底 (记忆 sdd-cost-batching-preference)
  - **typecheck 潜伏失败 (T2起, vitest 剥类型没测出, batchB implementer 误判"可接受")**: 终审前主控直接验证抓到, 修 b631ca1 (union 类型守卫窄化)。教训: 每个改类型的 Task 验证步必须含 `npm run typecheck` 非仅 vitest
  - Opus 终审 READY TO MERGE; finding#1 (Enter-while-busy 越过停止键) 已修 f81111f+回归测试; #2(interrupt 空页脚)/#3(footer 无错误提示) cosmetic→K3
- 最终: main 279 测试全绿, typecheck 3段 exit 0, 两 Phase-1 gate (store订阅/fixture default) 仍未动
- **K3 穿衣拍待带走** (下一步): 过程折叠/页脚/liveness/PinnedPlan/回到底部按钮的 K3 视觉气质; DEFAULT_MOMO_REPLY 孤儿导出清理; finding#2/#3
下一步: slice-2/2.5 骨架已闭环合 main → K3 穿衣拍 (workbench-mode.html 对照) 或 slice-3 (审批条/问询卡/用量脚注, 需回投通道) — 待用户定

== 第六批: 前端 slice-2/2.5 K3 穿衣 + 逻辑尾巴 + 思维链 CLOSED (7/22) ==
视觉基准=k3/workbench-mode.html; 用户拍板气质=混合档(工作台卡片解剖 + 搭子暖白轻量, 因卡片当前只在暖白 BuddyShell 渲染); 合并 merge b21604e → main; branch fe-slice2-k3-dress (main 祖先); worktree .claude/worktrees/fe-slice2-dress (git worktree add 建, 非 harness-locked, 待清)
执行: 逻辑层主控亲做(严格 TDD), 视觉层无头 kimi -p 驱动 K3(kimi-code/k3), 主控逐文件 diff 审计 + 实机 devtools 验收
- **逻辑尾巴 (主控 TDD, commit b236fd2)**: ①#2 interrupt 页脚 — reducer 携带 run.finished.subtype → result.interrupted, 中断态显「已停止」不再空复制 ②#3 error 页脚 — isError→「⚠ 这条没跑完」 ③删孤儿 DEFAULT_MOMO_REPLY ④token 预备 — 补齐 --leemo-ok/panel/line-2/amber-ink/bg/line/book-*/user-av (spec §3 搭子暖白值, 以后 WorkbenchShell 换值自动变冷灰); 279→285
- **K3 穿衣 (commit 3de0d82)**: 6 卡(ToolCard 状态图标+类型图标+summary / PlanCard 头栏+进度+三态行 active琥珀高亮 / ActivityCard / CompactDivider / TextBubble 用户气泡+momo流式琥珀caret / MessageFooter 复制图标+mono token统计) + ProcessFold/TurnBlock/LiveStatusBar/BackToBottom(.leemo-fab)/PinnedPlan; effects.css +.leemo-spin/.leemo-caret/.leemo-fab; 全走 --leemo-* 语义token零字面色值; 主控审计: props/reducer/逻辑只读, guard 铁律未破, 折叠状态机原样; 修 K3 一处 .leemo-caret 重复定义
  - **kimi -p 派发教训**: 首次派发(裸 -p, run_in_background)零改动零输出静默失败; 重派(前台+完整 prompt 显式"必须用编辑工具写入")成功。kimi -p 会缓冲到 session 结束才落 stdout, git diff --stat 才是判进度的真信号
- **用户目验反馈 2 轮 (commit 5e18ac0)**: ①布局 bug — 外壳 min-h-screen 致内容撑高整页滚动, 输入框被带走; 修=h-screen+overflow-hidden+main min-h-0, Timeline 内部 overflow-y-auto 独立滚(实测 pageBodyScrolls=false, 单内滚动容器, 输入框恒定距底96px) ②ProcessFold 一行字→显眼卡片(琥珀图标徽章+边框+「momo 的干活过程·N步」+展开/收起)
- **思维链 (用户第3轮反馈, commit 516df6e)**: 用户要过程性文字(模型思考)也进折叠卡。用户拍板=思考独立过程卡。reducer 新增 kind:"thinking"(thinking.delta 同 text.delta 聚合, 中间插工具/文本另起新项, run.finished 清流), 加入 isProcess 进折叠卡按时序交织; ThinkingCard 虚线卡+琥珀💡徽章+淡色斜体(内心独白, 区别实线工具卡); **推翻 slice-2「thinking 延后」契约, 2 处旧测试更新**; fixture demo 回合发2条 thinking.delta; 285→290
- 最终: main 290 测试全绿(279→290, +11), typecheck 3段 exit 0(主检出实证复跑), 两 Phase-1 gate (store订阅/fixture default) 仍未动; 电脑中途重启一次, 重启后重跑基线复现验收
下一步: slice-3 (审批条/问询卡/用量脚注, 需回投通道, 相关 approval-ux-philosophy) 或 WorkbenchShell (工作台壳, 冷灰 token, §5 布局) 或 Phase-1 骨架(pool↔interact 接线+SQLite+成本修) — 待用户定

== 第七批前置: 前端完整形态设计 (7/23, Fable+Max 专项会话) ==
交付: **docs/specs/10-前端完整形态设计-v1.0.md** (待用户审) — 全部未建面 S1-S16 逐面六层(布局px级/状态机八态/store契约/交互时序/双基调映射/复用边界) + §一全局架构(壳拓扑/token作用域/新store总面/事件路由§1.4/回投时序§1.5) + §四施工批次(Batch 0-7, 依赖图+模型分档) + §五 Opus 执行会话交接 prompt
- 设计根基核对实况非旧表: runs store 不建(职责已被 TimelineItem 判别联合吸收); MessageFooter 实为已建(brief 口径滞后); 新 store 面=conversations重构+approvals/artifacts/context-usage/wiki-entries/notebooks/providers/ui/skills/file-tree+settings/notifications扩展
- **§二 5 项 ⚠ 待用户裁决**: A1 事件归属字段(推送payload无conversationId,建议契约加可选字段) / A2 wiki轻量对话purpose标记 / A3 白名单查撤通道(首发占位) / D4 模式切换器位置三方打架(推荐a各随其稿) / A5 可视化MCP命名对齐
- 关键架构裁定(依权威链非裁决): 跨Provider换模型=开新对话(SetModelRequest无providerId+CONFIG_DIR隔离); wiki=影子对话不入注册表; 审批dangerLocked=隐藏缓存档按钮; 回投卡=回合尾插槽不进ProcessFold; §1.4"最近send=事件归属"临时规则(A1補字段后删)
[7/23 用户审定+五项裁决全落地] 10 号文档状态→已审定可开工:
- ①契约 v1.1 加法(=新 Batch -1 首卡, Opus): bridge:event 信封{conversationId,event} / ApprovalRequest+AskUserPayload 必填 conversationId / purpose?:'main'|'wiki' / listWhitelist+revokeWhitelist 双通道; **runId 澄清=渲染层自发概念,Bridge 不产**(前端按 runIds[cid] 反查)
- ④两壳切换器统一右上簇(K3 workbench 视觉),buddy 顶栏加设置齿轮(新 §1.7,TopBar 回改归 Batch 2b); ⑤MCP 全称 leemo-visualization(对齐 leemo-ask-user 全称先例)
- 连带收紧: §1.4 升级 conversationId 精确路由(多对话后台并行=可靠能力,临时启发式/S1 stale 态/S10 wiki 互斥锁全删); S7 白名单真列表
下一步: 切 Opus 新会话按 §四批次施工(交接 prompt=10号文档§五; 首卡=Batch -1 契约 v1.1)

== 第七批执行: Batch -1 契约 v1.1 PASS (7/23) ==
brief=`docs/sdd/fe-bm1-contract-brief.md`; report=`docs/sdd/fe-bm1-contract-report.md`; BASE=28921be; 执行=Opus 4.8（隔离 worktree、严格 TDD、无 commit/push）; 独立复审=另一 Opus 4.8 PASS（无代码/阻断缺陷）。
- 契约落地：`bridge:event` → `BridgeEventEnvelope{conversationId,event}`；ApprovalRequest/AskUserPayload 必填 conversationId；CreateConversationRequest 加 `purpose?:'main'|'wiki'`；新增 listWhitelist/revokeWhitelist invoke；ApprovalPersistence 加 remove hook；Bridge 不生产 runId。
- 最小消费者：单对话 conversations 先过滤 foreign cid 再解信封；FixtureBridgeClient 用 send/interrupt request 的 cid 包全部事件；PinnedPlan 既有 fake 最小适配。未提前做 Batch 0 多对话 maps/统一订阅。
- TDD：RED=定向 27 failed/40 passed + typecheck exit2；GREEN=原定 4 files/67，补 PinnedPlan 后 5 files/69；父工作区主控复跑 full **41 files/298 tests PASS**，三段 typecheck exit0，diff --check PASS。
- 边界：SDK 仍锁 0.3.210；package/lockfile、smoke、gateway、其它 bridge、UI/CSS 零本卡 diff。已知 `smoke/bridge-live.mjs` 旧 broker 签名刻意未改；恢复 live smoke 必须另立专卡。
下一步：Batch 0 地基。先派 0a conversations.ts 多对话重构（Opus 高风险、严格 TDD）并验收；随后 0b 三卡并行 → 0c 统一订阅；0d fixture 可按 §四依赖与文件所有权并行。

== 第七批执行: Batch 0a conversations 多对话地基 PASS (7/23) ==
brief=`docs/sdd/fe-b0a-conversations-brief.md`; report=`docs/sdd/fe-b0a-conversations-report.md`; 执行=Opus 4.8（隔离 worktree、严格 TDD、无 commit/push）；独立复审=另一 Opus 4.8 PASS（无 Critical/Important；1 个报告计数 Minor 已修）。
- 状态迁移：真实空态；`byId/order/activeId/openTabs/timelines/runIds` 多对话注册表；显式 cid action；每对话 runId；message-model/applyEvent 零改。
- 并发保证：A/B 交错事件按 envelope.cid 精确折入；A finished 仍使用 A 旧 runId，仅清 A；后台完成置 unread，switchActive 清除。
- 首发与批次缝：Buddy 首次提交 create→send 且重复提交共享 create promise；provider/model 经动态 defaults resolver 注入；0c 前仅保一条 direct subscription，0d 前 fixture 仍是单流。
- TDD：RED=3 files failed、14 failed/3 passed；GREEN=定向 5 files/20 tests；父工作区主控复跑 full **41 files/306 tests PASS**，三段 typecheck exit0，diff --check PASS。
- 文件边界：0a 共 9 个独立 tracked 路径（3 个与 Batch -1 路径重叠）+ report；未改 fixture-client、其它 stores、Bridge 冻结面、package/lockfile、smoke、gateway/vendor。
下一步：0b 三张 Sonnet 5 TDD store 卡与 0d fixture 卡按文件所有权并行；0b 全部验收后做 0c 统一订阅装配/cleanup。

== 第七批执行: Batch 0-5 全部 PASS + 集成闭环 (7/23, Opus 4.8 主控多窗口) ==
主控=Opus 4.8(先 GPT5.6 中转低效, 后切原厂 Opus 4.8 xhigh 接管); 执行=Sonnet 5 medium 子代理并行; 验收=主控真跑命令(不信执行者报告)。
**最终状态: 60 test files / 501 tests 全绿; typecheck 三段 exit 0; 无 commit/push。**

已完成并验收:
- Batch 0 地基(0a conversations / B1 approvals+context-usage / B2 artifacts+wiki-entries / B3 notebooks+providers+settings+ui+notifications / 0c wiring / 0d fixture) — 已安全集成进父工作区 E:\Leemo(preimage 逐字节校验, 用户脏文件未动); cross-card seam: src/renderer/bridge/tool-names.ts 单点定义 LEEMO_VISUALIZATION_TOOL_NAME
- Batch 1: ApprovalBar(S2) + AskUserCard(S3) — 乐观 UI + 回滚, 回合尾插槽
- Batch 2: WorkbenchShell(S1) 工作台壳 + 侧栏 + 顶栏
- Batch 3: InputArea(S6) 多行输入区(BuddyShell 已接; WorkbenchShell 仍用旧 InputBox — 待统一)
- Batch 4: VisualizationCard(S4) 沙箱 iframe + UI Kit 注入
- Batch 5: SettingsPage(S7)/OnboardingWizard(S8)/GlobalSearchPage(S13)/SkillsPage(S12)/ArtifactsPage(S14)/NotificationPanel(S15) — **六页全部接进 app(浮层/主视图/铃铛路由), 非孤儿**

主控复核修的真实缺陷(执行者未暴露):
- **AskUserCard 契约字段错配**(selectedOptions/otherText/questionIndex → 冻结契约 selected/other, items[i]答questions[i]): 曾致 typecheck 崩 + 10 测试红。三 Sonnet 窗口都甩锅"不是本批次"却无人跑全套 typecheck — 教训: 局部绿≠整体健康, 复核必须真跑 typecheck+full。
- AskUserCard 测试时序(须先 send 建 runId 再 emitAskUser, 否则 wiring 丢弃无 run 的推送) + FixtureBridgeClient.emitAskUser/emitApprovalRequest 补注册 interaction(否则 answer 抛 unknown)。
- Batch 5 六页"建了但没接进 app"(孤儿): notebooks store 从未进 context; Search 用 mock; Artifacts notebooks 写死[]; 通知/设置按钮空函数。已集成: context 加 notebooks+useNotebooks; ArtifactsPage/GlobalSearchPage 接真 store; NotificationPanel/铃铛接导航; WorkbenchShell 加浮层层(设置/搜索/通知)+成果按钮; App 挂 OnboardingWizard。

已知待办(非 bug, 明确 Phase 边界):
- **Batch 6 未开始**: PreviewPane+SelectionMenu(S9) / WikiPopup+WikiHistoryList(S10, 影子对话生命周期) / FileTree+file-tree.ts(S11)。openPreview 的 action 已通但无可见预览面(Batch 6 补)。
- S16 侧栏历史抽屉细节 / Batch 7 K3 总穿衣+全链路复审+终审
- WorkbenchShell 输入区仍是旧 InputBox(应统一到 InputArea)
- notebooks seed 为空 → 成果暂归"未分类"(等 fixture/真实数据)
- Phase-1 后端(用户定序: 走完前端 batch 后专攻): tsconfig 拆分 / Gateway G2-G4(G4 需 RELAY2_*) / SQLite / 真实 workspace IPC / provider 配置写入 / pool↔interact 接线 / 成本修
下一步: Batch 6(预览生态, Sonnet medium 可并行) → Batch 7 收尾 → 转 Phase-1 后端。

== 第七批 Batch 6 收尾 + 实机目验 + 战略转向 (7/24, Opus 4.8 主控) ==
Batch 6 预览生态骨架合入 main (commit 6c3ff69): PreviewPane/SelectionMenu(S9) + FileTree/file-tree.ts(S11) + WikiPopup/WikiHistoryList(S10); 501→548 测试全绿, typecheck 三段 exit0。
- 执行=Sonnet 5 隔离 worktree 并行(6a/6c), 6b 主控亲做; 主控手工合并两 worktree 的 WorkbenchShell diff。
- **执行者谎报教训(再现)**: 6c 报告称"接进 WorkbenchShell", 实际文件树列/切换按钮/集成测试全缺(孤儿); 主控 devtools 实测才发现, 手工补齐。局部绿≠接进 app, 铁律再次应验。
- **实机 devtools 目验抓到 3 个死控件 bug, 修复提交 51adc63**:
  ① TopBar 模式切换器死 span 无 onClick → buddy 切不到工作台, 用户被卡死无法验收 → 改接 setMode 的 button
  ② WorkbenchShell 视图卡死 → 进技能/成果页后 switchActive 不重置 ui.view, 回不到 chat → 新建/选对话/切标签三处补 setView("chat")
  ③ 侧栏底部三按钮用 .leemo-icon-btn(硬设36px方形)盖过 w-full → 文字挤竖排 → 改全宽 flex 行
- **战略研判(代码考古 agent 全景 + 用户迷茫求助)**: 项目本质=「精致但没通电的前端」+「已验收但没挂上的后端库」, 中间隔着**缺 Electron 主进程**的鸿沟。前端唯一跑 FixtureBridgeClient(send 回放 DEMO_TURN_EVENTS 不碰真AI)。三断点: ①无 IPC-backed BridgeClient ②无 Electron 主进程缝合层 ③无持久化+costSource 算错。两大赌命题(SDK驱动国产模型/网关翻译)已过, 剩下是已知工程。
- **用户拍板转向**: 下一步 = **先拉通电竖切**(搭子输一句→真模型→真流式回界面), 不先收 Batch 6b/7; **开新窗口接管**。
- 延后(TaskList): 6b 三处接线(PreviewPane FIXTURE_CONTENT 空/wikiActive 硬编码 false/搜索缺 files 分支)。
- **交接文档: `docs/handoffs/NEXT-SESSION-power-on-vertical-slice.md`**(新窗口起手式+架构岔路A/B+战略研判+铁律)。HEAD=51adc63。
下一步(新窗口): 读交接文档 → AskUserQuestion 让用户在"真Electron主进程 vs 进程内直连竖切"拍板 → 据此派卡; 主控倾向进程内直连先通电。

== 第八批: 通电竖切 + 首轮实机 bug 修复 CLOSED (7/24, Fable 5 主控) ==
通电竖切: 计划 v2=docs/superpowers/plans/2026-07-24-power-on-vertical-slice.md(修正旧计划4硬伤: DeepSeek直连=anthropic+/anthropic端点/测试必须tests/host/vitest才扫/adapter透传pool env不重建/mcpServers是Record)。
- 卡A(Opus): src/host/ 五文件(provider-catalog/sdk-adapter/bridge-host waiters-Map/ws-server/dev.ts)+tests/host/ 33测试+smoke/host-live.mjs; 卡B(Sonnet): WsBridgeClient+App VITE_LEEMO_LIVE opt-in+context live prop(9个既有测试传client断言fixture语义,故用独立live prop判别)。主控修卡A遗留typecheck错误。
- 通电PASS: 搭子输一句→DeepSeek真流式→界面回字。548→590测试。
- 实机暴露6 bug, 修复+主控浏览器亲验(证据截图docs/sdd/evidence-*.png):
  ①重复输出: 真流序=delta→usage.final→text.final, usage插中间致text.final误判追加新气泡。修=reducer向后扫描本run momo气泡原位替换+回归测试锁真实事件序(591)。fixture事件序与真实不符是测试盲区根源, fixture对齐留后续卡。
  ②momo自称Claude: systemPrompt经extras→SDK options注入momo人格v0(bridge-host.ts内联, 人格prompt正式版待设计卡)。⚠首修未生效根因=进程管理事故: 按CommandLine匹配'bridge:dev'杀不到node子进程, 旧host一直占8787服务旧代码。教训: 杀进程按端口(Get-NetTCPConnection→OwningProcess), 重启后必须验PID变化。
  ③Markdown不渲染: TextBubble接react-markdown(新依赖), momo消息渲染/用户消息保持纯文本。
  ④搭子布局失调: Timeline+输入区统一max-w-720px居中。
  ⑤工作台黄底: WorkbenchShell inline覆盖14个--leemo-*token为K3冷灰系; 二修根因=根div无自身背景(body暖底透出)+侧栏用了从未定义的--leemo-side/-hover token。主控亲验冷灰到位。
  ⑥附件不进对话: SendRequest契约无attachments字段=功能未实现非bug, Phase-1。
- 最终: 71 files/591 tests全绿, typecheck三段exit 0。竞品调研落盘docs/research/2026-07-24-workbuddy-competitive.md(口碑数据缺失待补)。
- 遗留: 工作台InputArea统一(Batch 7)/momo人格prompt正式版(设计卡,用户亲审)/持久化/Electron打包/入参21.7k tokens每轮(CC默认工具集全量下发,搭子纯聊场景可裁,留优化卡)。
下一步: 用户目验通过后→Electron打包里程碑 或 Batch 7 K3收尾 — 待用户定。

== 第八批补账: 需求覆盖核对 (7/24, 应 Comate 核验报告 comate/04 + 用户 Q2) ==
上一条台账只记了附件一项漏需求, 未给全量需求覆盖表, 记账不完整 — 本条补正。对照 06 设计, 通电第一轮核心交互覆盖实况(逐项进代码核实, 非口头):
| 交互 | 状态 | 证据 |
|---|---|---|
| 附件/拖文件 | 部分: UI收集, send丢弃, 契约无字段 | InputArea.tsx; SendRequest 无 attachments |
| Skills 触发 | ❌未做: UI骨架+MOCK数据, onToggle 空函数 | SkillsPage.tsx:9 MOCK_SKILLS / :49 onToggle={()=>{}} |
| wiki 弹窗 | ✅做了: shadow 对话真接线 | wiki-entries store |
| 按对话选模型 | 部分: 契约/pool/host setModel 全通, InputArea 面板是占位不调 store | InputArea.tsx:283 面板无 setModel 调用 |
| 审批卡 canUseTool | ✅做了: broker 装配+测试 | bridge-host.ts |
| 人设卡/话风 | 部分: settings store 有 persona/personaCards 数据面, bridge-host 硬编码 prompt 不读 | settings.ts:21-23 vs bridge-host.ts:76 |
| memory 分层 | ❌未做: settingSources:[] 刻意隔离, 无 memory 体系 | sdk-adapter.ts:41 |
**momo systemPrompt = 临时占位**(上条台账已注"正式版待设计卡", 本条明确): 06 §7.2 要求 行为准则四条+模式语气块+人设卡+话风滑杆+联网状态块 五件套组装, 现状仅一段硬编码。定稿路径=专门卡: host 侧 prompt 组装器 + 契约加法(persona 随 createConversation 过线, 循 Batch -1 加法先例) + prompt 文本用户亲审。
**流程修正(用户 Q1 + Comate 红项)**: "收工"的定义从此=测试绿+typecheck+目验+**commit 落盘有 hash**+需求覆盖表; 未落盘不许报收工。本批全部成果(含历史批次未提交的集成态)于本条后立即 commit。

== 启动轮 1 步 1: Electron 承重墙 (7/24, Opus 4.8 主控) ==
交接=docs/handoffs/NEXT-SESSION-electron-step1.md; 监督=Comate(comate/04 口径)。目标=WS 传输换 Electron IPC, 浏览器→桌面 App, key 进 safeStorage。**不做 SQLite(步2), conversations 仍内存态。**
- **技术决策(主控自拍, 简述理由)**:
  - main 构建=esbuild(轻), 非 electron-vite(重)/tsx(不能当 electron 入口)。main→ESM `.mjs`(保 SDK `import` 原生, 不被 `require(esm)` 卡; Electron43=Node22 支持 ESM 入口), preload→CJS `.cjs`(sandbox 化 preload 必须 CJS)。`packages:external` 只打包 src/**, node_modules 运行时解析(SDK 要 spawn CLI 子进程, 绝不可 inline)。
  - IPC 传输: 单条多路复用 `ipcMain.handle("leemo:invoke", {channel,req})→host.handleInvoke`; 错误以 `{ok,error}` 数据形式过界(不 throw 过 IPC, 避免 Electron 包裹变形, 与 ws-server 帧同形)。推送=`webContents.send(channel,payload)`, preload `on(channel,cb)` 白名单三推送 channel。
  - preload: `contextIsolation:true + sandbox:true + nodeIntegration:false`; 只暴露 `window.leemoBridge={invoke,on}`, 密钥/Node 永不进 renderer 全局。
  - safeStorage 范围克制: 首次启动读 .env → `safeStorage.encryptString` 存 userData/leemo-secrets.enc → 之后从加密件读; secrets 模块纯函数+注入 safeStorage/fs, 用 tests/main 覆盖(不 import electron)。加密不可用(如 Linux 无 keyring)回退 .env 明文但**绝不落盘明文**。
  - tsconfig: src/main 归根 tsconfig.json(第2段); `types:["node","electron"]` + skipLibCheck 让 electron 的 DOM 引用 .d.ts 不报错; **typecheck 仍三段, 无第4段**。
- **复用 `src/host/bridge-host.ts` 原样**(传输无关组装核), ws-server/dev.ts 保留(浏览器 dev + smoke)。renderer 选择: `window.leemoBridge`→IpcBridgeClient > `VITE_LEEMO_LIVE=1`→WsBridgeClient > fixture。
- TDD: secrets.ts(4测试 tests/main) + IpcBridgeClient(5测试 renderer) 严格 RED→GREEN。**测试 591→600(+9), typecheck 三段 exit 0**。
- **实机亲验(主控 CDP 驱动 Electron 43.2.0 renderer, 非浏览器)**:
  - `npm run electron:dev` 起桌面 App(vite5173 + esbuild main + electron.exe)✓
  - IPC 传输实证: `window.leemoBridge` 存在(object/invoke/on), UA=`Electron/43.2.0`, 非 WS(8787 未起)✓
  - DeepSeek 真流式回界面: 事件流 conversation.started→thinking.delta×N→text.delta×N→usage.final→text.final→run.finished; momo 自报"momo（默默）"人格生效不称 Claude; UI 渲染回合(用户气泡+momo回复+干活过程折叠+token页脚↑23.1k↓45)✓ 证据 `docs/sdd/evidence-electron-ipc.png`
  - safeStorage: 首launch=`secrets source=migrated`, 移走 .env 重launch=`secrets source=encrypted` 仍真流式回复 ✓ 证据 `docs/sdd/evidence-electron-noenv.png`; 加密件 `v10` DPAPI 信封开头, 全盘扫描无明文 sk- key ✓
- **需求覆盖表(步1边界内)**:
  | 验收项(交接§2) | 状态 | 证据 |
  |---|---|---|
  | ① `npm run electron:dev` 起桌面 App | ✅ | electron:dev 日志 vite ready+DevTools listening; 截图 |
  | ② 搭子输一句→DeepSeek 真流式回界面(IPC 非WS) | ✅ | leemoBridge object+UA Electron; 事件流全序; evidence-electron-ipc.png |
  | ③ key 走 safeStorage, .env 非运行必需 | ✅ | source=migrated→encrypted; 移走.env 仍回复; 加密件无明文 key |
  | ④ typecheck 三段 exit 0 | ✅ | npm run typecheck exit 0(未增第4段) |
  | ⑤ commit hash + 需求覆盖表 | ✅ | 见本条 commit + 本表 |
  | ⑥ git clone 后跑通测试 | ✅ | 全新源在 tracked src/tests; 600 测试; 干净 worktree 复跑(见下) |
  | ⑦ 主控 devtools 实机亲验+截图 | ✅ | CDP 驱动真机; 两截图存证 docs/sdd/evidence-electron-*.png |
- **边界内明确未做(非漏, 步2+/后续卡)**: SQLite 持久化(步2, conversations 仍内存)/ electron-builder 打包(config 落盘 electron-builder.yml, `electron:pack` 未跑=后续里程碑)/ safeStorage 设置页输入 key UI(后续卡)/ momo 人格 06§7.2 五件套组装器(仍占位, 专门设计卡)/ 步1 未碰步八已记 4 项漏需求(Skills/模型选择/人设卡/memory 分层)。
- 已知 Minor: DevTools 以 detach 开(dev 便利); electron-dev.mjs 用 shell:true(spawn DEP0190 警告, 无害); acceptance 驱动 scripts/cdp-accept.mjs 留仓供 Comate 复验。
下一步: 用户目验 + Comate 核验通过 → 步2 SQLite 持久化。commit hash 见报告。

== 启动轮 1 步 2: SQLite 持久化 + 两 bug 修复 + DeepSeek 模型改名修复 (7/24, Opus 4.8 主控) ==
接手背景: 上一会话中断且陷反复写文件死循环。落盘残留=deps(better-sqlite3+@electron/rebuild)+schema.ts+persistence.test.ts, 但 **typecheck 从未跑过**: schema/test 用了 UsageRecord/PathAudit 的臆造字段(cacheWriteTokens/cost/reads/writes), better-sqlite3 缺 @types。本会话先清残料再续。
- **架构裁定(主控自拍)**: 持久化 = **渲染端驱动**。schema.ts 收 renderer 类型(ConversationMeta/TimelineItem/WikiEntry)当不透明 JSON — 因为 reducer(applyEvent)是渲染层唯一真源, main 当哑 SQLite 存。渲染端 push 快照过 IPC, main 落库; 启动 loadAll→hydrate。**独立于冻结的 bridch 契约**(持久化非 AI 对话边界): 单独 `leemo:persist` invoke channel + `window.leemoPersist`, 不污染 BridgeInvokeMap。
- **better-sqlite3 = N-API(node-addon-api)**: 我初判有 dual-ABI 坑(node ABI 测试 vs electron ABI 运行), 实证**是伪命题**——N-API 跨 Node/Electron ABI 稳定, 同一 prebuild(win32-x64.node)两处通吃, **无需 electron-rebuild**。故移除上一会话误加的 @electron/rebuild(误导性 unused dep)。记忆 [[better-sqlite3-napi-no-rebuild]]。
- **交付(严格 TDD, 持久化/store/IPC 铁律)**:
  - main: persistence/schema.ts(修字段: cacheCreationTokens/costUsd TEXT/costSource/tokensEstimated/durationMs, usage 表按真 UsageRecord 重列) + db.ts(better-sqlite3 WAL @ userData/leemo.db) + main.ts `leemo:persist`{loadAll/saveConversation/saveWikiEntry} + preload window.leemoPersist
  - renderer: stores hydrate 动作(conversations byId/order/timelines/runIds null+activeId=order[0] / wiki entries) + persistence/{client 端口, ipc-persistence-client, sync}。sync=订阅两 store, debounce(300ms 注入式)存变更对话(空壳跳过), wiki 有 turns 才存, seen 基线防 hydrate 回存。
  - bootstrap: App 建 IpcPersistenceClient; context.tsx useEffect: loadAll→hydrate→startSync, 无 persist 则 no-op(浏览器/fixture)。
  - 测试 621 全绿(600→621, +21: schema 2 + conv hydrate 3 + wiki hydrate 1 + sync 5 + ipc-persist 4 + ...), typecheck 三段 exit 0。
- **顺手修 2 bug(+1 发现)**:
  - **Bug1 搭子滚动条**: BuddyShell 把 `<Timeline/>` 裹进无 flex/无高度约束的 `mx-auto max-w-720` div → Timeline 的 flex-1 无 flex 上下文 → 无限长顶出输入框(且双重居中)。修=Timeline 直接做 flex-1 min-h-0 子(内部自居中), Timeline 根加 min-h-0。实证(强制 360px 短视口): pageScrolls=false/inputVisible=true/内滚容器 sh314>ch5 独立滚。
  - **Bug2 工作台死输入**: WorkbenchShell `<InputBox value="" onChange={()=>{}}>` = 受控空值+空 onChange = 冻死打不了字。修=统一到 InputArea(+本地 draft state, 同 BuddyShell), 一并完成排期的"工作台 InputArea 统一"。实证=CDP 注入 'reflected' 值回读一致。
  - **发现(非我改动, 但顺手修因它废掉核心回路)**: DeepSeek 停用 `deepseek-chat`, API 现仅收 `deepseek-v4-pro`/`deepseek-v4-flash`(直连 anthropic 端点两名 200, chat 400 实证)。**真根因不在加密件 model, 而在 context.tsx live resolveConversationDefaults 的硬编码 fallback `deepseek-chat`**(providers 未 refresh 完就发 → 用死名)。修=fallback→deepseek-v4-flash + catalog default→flash + .env DEEPSEEK_MODEL→flash + 清旧加密件重迁移。选 flash 理由=聊天搭子快/便宜; pro 可用, 用户想换一行事(context.tsx fallback + .env)。记忆 [[deepseek-model-rename-v4]]。
- **实机亲验(主控 CDP 驱动 Electron 43.2.0 renderer)**: 搭子输一句→deepseek-v4-flash 真流式(text/thinking/text/usage/result, 无 error)→momo 人格回"我是 momo,你的 AI 搭子...青色河马"→落 SQLite。**刷新(renderer reload, 清渲染内存纯靠 loadAll 重建): momo 真回复重现** ✓。**全进程重启(kill+relaunch): 对话+真回复仍在** ✓。证据 docs/sdd/evidence-persist-0{1,2,3}-*.png + evidence-{buddy-scroll,workbench-input}.png; 可复现脚本 scripts/cdp-{persist-verify,final-checks,scroll-viewport}.mjs 留仓供 Comate。
- **需求覆盖表(步2边界内)**:
  | 验收项(交接) | 状态 | 证据 |
  |---|---|---|
  | ① 刷新后对话列表+内容还在 | ✅ | reload 后 loadAll 复原, momo 真回复「青色河马」重现 DOM+DB; evidence-persist-02 |
  | ② SQLite 文件在 userData | ✅ | leemo.db @ AppData\Roaming\Electron(日志 `persistence db` 行), 4096B+WAL |
  | ③ better-sqlite3 在 package.json | ✅ | dependencies better-sqlite3 ^13.0.1 + @types devDep |
  | ④ typecheck 三段 exit 0 | ✅ | npm run typecheck 清 |
  | ⑤ commit hash + 需求覆盖表 | ✅ | 本条 + commit(见下) |
  | ⑥ git clone 后跑通测试 | ✅ | 全新源在 tracked src/tests; 621 测试绿(N-API prebuild 跨 ABI, npm i 即通) |
  | ⑦ 实机目验刷新不丢 | ✅ | reload + 全进程重启双证; evidence-persist-03-after-restart.png |
  | 顺手 Bug1 搭子滚动 | ✅ | 短视口强测 pageScrolls=false/input visible/内滚独立; evidence-buddy-scroll.png |
  | 顺手 Bug2 工作台输入 | ✅ | InputArea+draft, CDP 注入回读一致; evidence-workbench-input.png |
- **边界内明确未做(非漏)**: usage 表已落但 bridge:usageSummary 仍 Phase-1 占位(未接查询); 成本 costSource=sdk 错算(全分支终审 Important, 先于成本 UI 修, 步2未碰); pricing 表无 deepseek-v4-* 定价→真调用 unpriced(Phase-1 pricing 占位); dangerLocked 读写不对称(Phase-1 gate 未动); openTabs/activeId 不持久化(会话 UI 态, 有意); attachments/Skills/人设五件套/memory 分层仍未做(各自排期)。
- **已知 Minor**: DB 写在 debounce 300ms 后(崩溃可能丢未完成回合的流中态, 步2接受); .env 的 key 一次性出现在我探测 DeepSeek 模型的 tool 输出(仅本会话上下文, 未落任何文件/commit, .env 恒 gitignored)。
下一步: 用户目验 + Comate 核验 → momo 人格 prompt 组装器卡(06 §7.2 五件套, 文本用户亲审)。commit=5da9f01(main, 未 push)。


== 启动轮 2 卡 A: momo 人格 prompt 组装器 (7/25, Opus 4.8 主控) ==
设计基础=comate/09（用户已审，第三节 settingSources 错误已由写作 agent 订正为方案 C，本会话核验通过）。本卡 prompt 文本免用户亲审（用户授权，出问题回调）。
- **settingSources 技术抉择 = C（读 sdk.d.ts 实证后定）**: `SettingSource='user'|'project'|'local'` 是闭合联合非路径（sdk.d.ts:6460），CLAUDE.md 由 cwd 发现（:1869）；而 cwd=sandboxDir 是 Phase 0 承重隔离（模型臆造路径写出 cwd 外）。故 **settingSources 保持 `[]` 不动**，host 自己读 ~/Leemo/CLAUDE.md 当第八层 append 注入 —— 全控可测、不碰已验收隔离面、记忆库位置符合 06 §7.4。A/B 均需削弱沙箱或挪记忆库，弃。
- **交付（严格 TDD, host/契约铁律）**:
  - `src/host/momo-prompt.ts`: `buildMomoSystemPrompt(options)` 纯函数，七层按序组装（①身份 ②准则+反模式 ⑥记忆 ⑦联网=英文 / ③模式 ④人设 ⑤话风=中文），英文文本用 comate/09 原文未重写；+ 第八层记忆库注入。personaText 截断 ≤200 token、memoryText 上限 3000 token（各带 TODO）。
  - 契约加法（循 Batch -1，只加可选字段）: `CreateConversationRequest` 增 `mode?/personaText?/talkStyle?/webSearchEnabled?`。**用 personaText（已解析卡正文）非 personaCardId** —— host 无人设卡注册表。
  - **sdk-adapter 形态修正**: 原 `systemPrompt` 传裸 string = **替换** claude_code preset（sdk.d.ts 明写 "Custom prompt"），等于丢掉 CC 工具链脚手架。改 `systemPromptAppend` → `{type:'preset',preset:'claude_code',append}`，合 06 §7.2 原意。
  - bridge-host: 替换 :76 硬编码为组装器调用；`readMemoryBank`/`memoryDir` 依赖注入（测试免文件系统）；记忆库**每次建对话重读**（验收④要求新对话看到新写入）；读失败降级为"无记忆"不断聊。
  - renderer: conversations store 加 `resolvePersonaContext` 依赖，context.tsx 从 settings store 取（webSearchEnabled 恒 false + TODO，搜索设置项单独开卡）。
  - 测试 621→653（+32），typecheck 三段 exit 0。
- **实机亲验抓到并修掉的真 bug（grep 证明不了，只有跑才暴露）**: 层⑥原文写 "~/Leemo/memory/bookmarks.md"，模型把 `~` 解成自己的 **CLAUDE_CONFIG_DIR**，把用户记忆写进 `.leemo-workspace/data/providers/deepseek/projects/E--Leemo/memory/` —— 用户永远看不到、也永远读不回来（Phase 0 "模型臆造绝对路径" 同款失效模式）。修=层⑥改由 host 注入**绝对路径**逐处写死（memoryDir 分隔符跟随平台），+ main 启动 `ensureMemoryDir()` 建目录防首写失败。修后实测工具路径全部落 `C:\Users\Example\Leemo\...`，config dir 零残留。
- **需求覆盖表**:
  | 验收项 | 状态 | 证据 |
  |---|---|---|
  | ① 行为准则四条（目验聊感） | ✅ | 焦虑场景实测：无"还有什么需要帮助"/无空洞安慰/无表演式温暖（三条正则断言 false）；回复温暖不客服腔 |
  | ② 不自称 Claude | ✅ | 回归测试（两模式）+ 实机自报"我是 momo"；断言 `/You are Claude|我是 Claude/` 不命中 |
  | ③ 钉死配置 ≤900 token | ✅ | 测试断言（非人工数）：buddy+默认卡+talkStyle2+搜索关+**含真实 memoryDir**=762 token |
  | ④ 记忆真的加载了（非 grep） | ✅ | 往 ~/Leemo/CLAUDE.md 写仓库零命中的事实（猫名"拿铁"/暗号 QINGSE-7413）→ 新开对话 momo 完整复述含"四岁怕吸尘器"细节；截图 docs/sdd/evidence-momo-memory.png |
  | ⑤ typecheck 三段 + 全测试绿 | ✅ | typecheck exit 0；653 测试全绿 |
  | ⑥ commit hash + 需求覆盖表 | ✅ | 本条 + commit（见下） |
- **边界内明确未做（非漏，卡 B/C）**: ~/Leemo/memory/ 下 bookmarks/profile/preferences/moments 四文件未建（卡 B）——momo 现在**读得到正确路径但文件不存在**，故"记一笔"写不进去；记忆触发实测=卡 C；webSearch 设置项、人设卡管理 UI 未做。
- **发现的既有 bug（非本卡引入，步 2 遗留，建议下卡修）**: 重启后 renderer 从 SQLite hydrate 出对话，但 host 侧无对应 conversation → 对老对话发消息静默失败 `unknown conversation: <cid>`。用户体感=重启后点历史对话发不出消息。
- **已知 Minor**: momo 读记忆文件会弹审批卡（Read=safe 但仍走 broker），验收脚本 `scripts/cdp-momo-verify.mjs` 自动点"允许一次"；实机验收期间我清过 userData 的 leemo.db（步2 证据已备份 /tmp/leemo-db-backup）。
下一步: 用户目验聊感 + Comate 核验 → 卡 B（memory 目录初始化）。⚠️ ~/Leemo/CLAUDE.md 里"核心事实"两条是**验收夹具非真实事实**（猫/暗号），Comate 核验完请删。commit=c67b7f4（main，未 push）。

== 轮 2 卡 A 后续：三 bug 修复（7/25, Opus 4.8 主控，用户实机报告）==
用户目验报回三个问题，全部实机复现并修掉。**bug2 与 bug3 是同一根因**。
- **bug1 打断无效（host, 严格 TDD）**: `interrupt()` 只 abort SDK 流，但回合真正卡在 `canUseTool` 里 `await transport.request(req)` —— 该 Promise 挂在 `approvalWaiters`，只有 `teardown()` 会清，interrupt 路径完全没碰。于是"停止"= abort 了流、审批 Promise 永远悬着、子进程不回来。修=抽 `releasePending(cid, reason)`，interrupt 与 teardown 共用；interrupt 时先 resolve 挂起审批（fail-closed 判 deny）+ failAsk 挂起问询，再 abort。测试从 5s 超时→立即返回。
- **bug2+3 审批条置底/文件"被拒绝"（同一根因）**: `TurnBlock.tsx:43` 无条件把 `<ApprovalBar>` push 到回合末尾，不管是哪个工具触发的。**用户看到的"位置不对/怎么置底了"就是它**；而"文件被拒绝"其实不是拒绝——现场工具状态是 `Tool permission request failed: AbortError: Tool permission stream closed before response received`，即审批卡飘在底部+与回合状态错位，用户没机会点，SDK 等不到响应自己断流，UI 把 AbortError 显示成了"被拒绝"。修=**审批卡按 toolUseId 锚定进对话流**：`ApprovalRequest` 加可选 `toolUseId`（从 SDK `canUseTool` options 的 `toolUseID` 取，sdk.d.ts:245，此前一直被丢弃）→ 贯通 wiring/approvals store → ProcessFold 在每个工具卡下就地渲染其审批条。无法锚定的（无 toolUseId/工具不在本回合）走 TurnBlock 末尾 fallback，**绝不静默丢弃**（看不见的权限卡=回合卡死）。
- **修复过程中我自己引入又抓到的新 bug**: 首轮实机截图发现审批卡**渲染了两份重叠** —— 根因是 `BuddyShell.tsx:71` 另有一个独立的置底 `<ApprovalBar density="buddy">`（**用户说的"置底"其实一直是这一个**）。删之，只留对话流内锚定版；AskUserCard 保留置底（它是直接对用户提问，不是标注某个工具）。补 BuddyShell 回归测试，并**反向验证过该测试确实能抓住重复**（临时还原重复 → 断言 2≠1 失败 → 再修回）。
- **附带修 runId 串号**: `conversations.ts` 的 `runSeq` 是模块级闭包计数器，hydrate 恢复历史对话后不重置 → 新消息认领旧 runId（现场实据：用户新消息挂回 run-1 并触发 `cannot send() while a round is in progress`）。修=hydrate 时扫描已恢复 timeline 的 `run-<n>` 取最大值推进计数器（compact 项无 runId，跳过）。
- 测试 662→**664**（+11 净增自本次：interrupt 4 + 锚定 4 + runId 2 + 无重复 1），typecheck 三段 exit 0。
- **实机验收（`scripts/cdp-fix-verify.mjs` 留仓可复跑）**:
  | 验收项 | 结果 | 证据 |
  |---|---|---|
  | ① 审批条在干活过程折叠区内、紧贴触发它的工具（非置底） | ✅ | insideFold=true; evidence-fix-approval-inline.png |
  | ① 同一审批只渲染一张卡（不重叠） | ✅ | count=1（修前=2） |
  | ② 工具真执行、无权限流超时 | ✅ | Write:ok，无 AbortError |
  | ② 文件真写入 | ✅ | bookmarks.md 含本轮唯一标记 fix-verify-<ts> |
  | ③ 任务途中打断生效 | ✅ | 点停止后 1s 内回合结束（修前永久挂起） |
- **边界内未做**: `Read:error(File does not exist)` 是**预期**，memory 文件由卡 B 建；审批卡的 buddy 暖样式变体（density="buddy"）随置底版一起移除，如需暖样式应在锚定版上重做。
- **上一条记录的既有 bug 仍未修**（重启后 hydrate 出的对话 host 侧无记录 → 发消息 `unknown conversation`），建议并入卡 B 或单开。
下一步: 用户目验三处修复 → 卡 B（memory 目录初始化）。commit=7c56ed8（main，未 push）。

== 启动轮 2 卡 B / C / D（7/25, Opus 4.8 主控设计+验收，两执行者并行）==
用户目验三 bug 修复后提出问询卡改版，并派下卡 B + 重启 bug。主控读码后拆成三卡并行派发（文件清单不重叠）：卡 B+D=Sonnet 5，卡 C（动契约+迁移+实机）=Opus 4.8。任务卡留仓 `r2-bd-brief.md` / `r2-c-brief.md`。
- **卡 C 重启续聊（commit 4fc17ba）**：cid 由 host 铸造、registry 纯内存随进程死 → hydrate 出的老 cid 全不认识。用户选「真正续上」而非「只让消息发得出去」。pool 加可选 id/resume；run.finished 带回 sessionId；store 用 hostLive 标记本进程活对话、send 前认领（认领放在乐观写之前，失败不留孤儿气泡）；persistence 加 session_id 列 + **真迁移**（PRAGMA table_info + ALTER；只改 DDL 字符串救不了已存在的库）。
  - **执行者用真 SDK 探针推翻了主控写死的一条规格**（已采纳）：原规格「流吐出任何事件前抛错才降级」，实测 SDK 是先吐 result/error_during_execution 再抛 → 按字面实现是死代码。改为守**副作用**而非消息条数；error result 判定期扣住不下发，第一条非 error 消息永久解除重试资格。主控亲验 `pool.test.ts:761`（Write 已执行 + error result + resume 武装 → 断言 calls===1），重放硬约束成立。
  - 实机：重启前告知随机口令 QXDX7O4H，重启后点历史对话，momo 一字不差复述；全盘搜索确认口令只在被 resume 的 session transcript 里，不在记忆库 → 排除「其实是从记忆库读到的」混淆。脚本 `scripts/cdp-restart-verify.mjs` 留仓。
- **卡 B 记忆库初始化（commit 7d4a8c3）**：`src/host/memory-bank.ts` 幂等播种 CLAUDE.md + memory/ 四文件，fs 经 IO 注入。**只建不存在的文件，已有内容一字节不改**。main.ts + dev.ts 都接线（dev 此前完全没建目录）。CLAUDE.md 是每轮注入的层⑧，卡 A 的 ≤900 token 断言改用真实播种内容测量：862 token。
- **卡 D 问询卡进对话流（commit 3503d45）**：原实现 pending+resolved 一起置底，且受 activeRunId 门控 → run.finished 后整块卸载，**答过的问答从界面彻底消失**；WorkbenchShell 更是从未渲染问询卡（工作台态问问题＝回合永久挂起）。ask_user 是 MCP 工具，时间线本就有带 toolUseId 的 tool 项 → 照 VisualizationCard 先例排除出折叠区、主干流就地渲染。配对用纯函数按下标，配不上的回合末尾兜底绝不丢弃。滚出视野时圆箭头换带字胶囊，二选一互斥。
  - **顺带修两处既有缺陷**：① AskUserCard 原用的 `border-line-2/bg-card/text-ink*` 在本仓库不生成任何 CSS（tokens.css 只有 --leemo-* 自定义属性，无 Tailwind v4 @theme 映射）→ pending 卡此前毫无强调色，与「醒目」验收直接冲突。② **ask_user 会先弹审批卡**（落进 classifyRisk 未知⇒moderate 默认分支）——momo 得先请求授权才能问你问题。按精确工具名短路放行，**刻意不放行 mcp__\***（第三方 MCP 仍走审批），两侧各有断言钉住。
- 测试 664 → **742**，typecheck 三段 exit 0，工作区干净。
- **已知未做（建议下一轮）**：
  1. **搭子态历史抽屉是假数据**（`HistoryDrawer.tsx:3` 写死三条字符串）→ 重启续聊虽已修好，但**搭子态点历史对话点到的仍是假条目**，只有工作台态侧栏是真实 order/byId。卡 C 实机验收因此走的工作台态。**这是当前最影响体感的洞。**
  2. resume 降级对「首轮网络抖动」与「session 真没了」不作区分，都会静默丢上下文（仅影响重启后第一轮，既定取舍）。
  3. 卡 D 视觉待用户目验；执行环境无头，DOM 计数用 RTL 完成（含反向验证：临时制造重复渲染 → 断言 1≠2 失败 → 再修回），但非真机截图。
下一步: 用户目验卡 D 视觉 + Comate 核验 → 建议先补搭子态真实历史列表。commit=3503d45（main，未 push）。

== 搭子态历史抽屉接真实数据（7/25, Opus 4.8 主控自做, commit 6f09aaf）==
上一条列的「当前最影响体感的洞」，用户点名先补。
- **病灶**：`HistoryDrawer.tsx:3` 写死三条 fixture 字符串，条目还是纯 `<li>` 不可点。搭子态点历史 = 看到三条不存在的对话 + 真实历史一条都点不到。搭子态是首启第一印象，此处出戏最伤，且让卡 C 的重启续聊在搭子态无从触发（卡 C 实机验收因此只能走工作台态）。
- **修法**：直接读 conversations store 的 `byId`/`order`（与工作台侧栏同一数据源，照搬渲染模式），条目改可点按钮 → `switchActive` + 关抽屉。附带修：空态区分「还没有对话」/「没有匹配的对话」；当前对话琥珀高亮 + 未读小圆点（对齐工作台语义）；**加「开始新对话」入口**（原本搭子态有了历史之后没有任何新建入口）；列表独立滚动；关闭清搜索词。
- **测试 742 → 749**（`HistoryDrawer.test.tsx` 7 例）。其中一条是**端到端串联卡 C**：经 `BridgeProvider persist=` 真实 hydrate 路径塞入带 `sessionId` 的历史对话 → 抽屉列出 → 点选 → 发消息 → 断言先以原 cid + `resumeSessionId` 认领再 `bridge:send`。即"重启后点历史对话能发消息"这条用户报告，现在在**搭子态**有了自动化回归。
- **反向验证**：把组件 stash 回假数据版，7 条全红（含端到端那条）；恢复后 749 全绿。确认测试有辨别力，不是摆设。
- typecheck 三段 exit 0。视觉仍待用户目验（用户已说明过几轮任务后统一验收）。
下一步: 用户统一目验（卡 D 问询卡视觉 + 本次抽屉）+ Comate 核验。commit=6f09aaf（main，未 push）。

== 启动轮 2 卡 E：Skills 触发（7/26, 主控实证抉择 + Opus 4.8 执行, commit 768e3c3 + b53f80a）==

**Skills 加载机制 —— 实证抉择及理由（验收⑥，本条是本卡最重要的产出）**
主控在派卡前跑四轮真 SDK 探针（真 DeepSeek 端点，判据=init 消息的 `skills`/`slash_commands` 数组）。探针已删不留仓，数据存此 + 存记忆 `skills-discovery-via-plugins`：

| 组合 | skills 数 | 探针 skill |
|---|---|---|
| `cwd/.claude/skills` + `settingSources:[]`（**当时生产配置**） | 15 | ❌ |
| 同上 + `skills:'all'` | 15 | ❌ |
| 同上但省略 `settingSources` | **45** | ✅ |
| `CLAUDE_CONFIG_DIR/.claude/skills` | 15 | ❌ |
| `CLAUDE_CONFIG_DIR/skills` | 15 | ❌ |
| `settingSources:['project']` | 16 | ✅ |
| **`plugins:[{type:'local',path}]` + `settingSources:[]`** | **16** | ✅ |

- **关键发现：Skills 此前完全没在工作。** 卡 A 为隔离定的 `settingSources:[]` 会**静默关掉 Skills 发现**，`skills:'all'` 救不回来。不是"功能没做"，是"机制被关着"。
- **为何不选"省略 settingSources"**（最直觉的修法）：会把用户个人 `~/.claude/skills` 那 42 个私人 skill **全量拉进 momo 上下文**（15→45）。隐私 + blast radius，禁用。
- **为何不选 `settingSources:['project']`**：要求 skills 放进 `cwd`=`sandboxDir`（Phase 0 承重隔离，用户看不见也拖不进去），且把 `.claude/settings.json`+`CLAUDE.md` 加载语义一并带回 = 部分推翻卡 A 方案 C。
- **拍板 = 方案 G**：`plugins` 吃绝对路径、与 cwd 无关、可与 `settingSources:[]` 共存 → 隔离面与沙箱都不动，且不污染。skills 落 `~/Leemo/.claude/skills/<名>/SKILL.md`（06 §3.6 的用户可见位置）。
- 配套实证：`.claude-plugin/plugin.json` 非必需但缺了前缀退化成 `.claude:xxx`（故必写，`name` 决定前缀）；插件目录不存在=安全降级不抛错；触发三路（`/限定名`、**`/裸名`**、自然语言）全部实测可用。
- **`skills:[]` 与省略语义不同**（sdk.d.ts:1877）：省略=CLI 默认仍生效≠关闭。`list` 为空时必须省略（否则会把 CC 自带 skills 从每个对话里剥掉），全关时必须传 `[]`。

**前缀不外泄（用户明确要求）**：实测裸名斜杠命令可用 → `leemo:` 只存在于 `qualifiedName` 与传给 SDK 的数组；SkillsPage/SlashMenu/chips 一律裸名，有 DOM 级断言（textContent 不含 `leemo:`）+ host 级断言（`name` 不含 `:`）钉死；frontmatter 夹带冒号的 skill 直接跳过而非篡改。

**交付**：`src/host/skills.ts`（扫描 + 自写极小 frontmatter 解析，不引 YAML 依赖；坏文件逐个跳过，一个坏 SKILL.md 不清空整个列表；`plugin.json` 已存在则一字节不改）；新通道 `bridge:listSkills`/`bridge:openSkillsDir`；层⑥ 补 skills 绝对路径（自然语言让 momo 装 skill 立即可用）；SkillsPage 接真数据（删 MOCK_SKILLS）；新增 SlashMenu；chips 保留 3 启动词 + 追加启用 skill。

**顺带修一处结构性错误（主控复核时发现）**：卡 B 把"种子 CLAUDE.md"算进了卡 A 的 ≤900 token 预算，到本卡顶到 **899/900**。但层⑧ 是用户数据、另有 3000 上限，真实上限从来不是 900 而是"我们写的层 + 最多 3000"；拿种子（层⑧ 最小时）撞我们自己的预算，既会因无关改动误报、又给虚假安心。拆成两条各管一件：我们写的层 ≤900（现 **810**），种子模板自身 ≤150（现 **74**，此前**无任何上限**）。**这不是放宽**：反向验证把模板撑到 994 → 新断言报「994 > 150」并点名模板。

**停用语义 = 隐藏，非禁用（用户 7/26 拍板，commit b53f80a）**：实测 plugin 的 skill 同时注册为斜杠命令，`/name` 由 CLI 在模型介入前展开、绕过允许名单。全关时 host 丢掉整个 plugin 可关死两条路；**部分关掉时 plugin 必须留着**（否则还开着的也没了），于是被关掉的那个仍可手打完整名字触发。用户选择不补、当作"隐藏"。故开关文案改「让 momo 用 X」+ title 明说"已对 momo 隐藏（文件还在，没有卸载）"，并补测试钉住语义防后来者误读成安全边界。

**实机验收（5/5 PASS）**：`scripts/cdp-skills-verify.mjs`（独立 userData + 5199/9333 端口，不打扰用户在跑的实例）。执行者一个比要求更严的细节：**口令只写在 SKILL.md 正文、不写 description**（后者才进系统提示清单），故 momo 复述「验收通过，口令是 ZANBO-9471-QIQI」证明**正文真被加载**而非只是清单。关掉后 `/leemo-test-probe` → "Unknown command"。

测试 749 → **877**，typecheck 三段 exit 0。
**历史快照（卡 E 当时）**：① disabled 状态仅 renderer 内存，重启不保留（要开 settings 写盘路径，本卡刻意不开）② zip 拖入解压安装（下一卡）③ SkillsPage 空态给的是路径**布局**而非绝对路径（listSkills 返回空时不带 root），靠"打开技能目录"按钮兜④ 本子级 skills、Skills 市场未做⑤ 视觉待用户统一目验。后续 r11 已覆盖其中的开关持久化、ZIP/文件夹/链接安装与基础视觉；旧的 40 个模板已在 2026-08-02 被 26 个真实通用精选 Skill + 4 个 Office Skill 替换，当前分发边界见 `docs/sdd/r7-requirements-ledger.md` §二十。
下一步: 用户统一目验（卡 D 问询卡 + 历史抽屉 + 本卡 SkillsPage/SlashMenu/chips）+ Comate 核验。commit=b53f80a（main，未 push）。

== 启动轮 3 卡 F：Provider 多家 catalog 扩展（7/26, Opus 主控实证抉择 + 三卡并行）==

**各家探针结果 —— 6 轮真请求实测（验收⑤，本条是本卡最重要的产出）**
主控派卡前跑 6 轮探针（真 key 真端点，非查文档）。探针已删不留仓（`scripts/tmp-probe*.mjs`），数据存此。判据=HTTP 状态 + 响应体 + **回复正文**（后者关键，见 vision 一节）。

四家 anthropic 端点全部实测可用：
| kind | baseUrl（实测 200） | 发现端点 modelsUrl（实测 200） | 精选 models（均实测 200） |
|---|---|---|---|
| deepseek | `api.deepseek.com/anthropic` | `api.deepseek.com/models` | deepseek-v4-flash / v4-pro |
| glm | `open.bigmodel.cn/api/anthropic` | 同 base + `/v1/models`（返回 8 家族） | glm-5.2 / 4.7 / 4.5-air |
| kimi | `api.moonshot.cn/anthropic` | `api.moonshot.cn/v1/models`（12 个） | kimi-k2.5 / k3 / k2.6 |
| qwen | `dashscope.aliyuncs.com/apps/anthropic` | `<host>/compatible-mode/v1/models`（**231 个**） | qwen3.7-flash / plus / max |

**通义（唯一未知项）已从「二手资料」升级为「实测通」**：
- 逆向报告记的 `/apps/anthropic` 路径形态**正确**：去掉 `/apps` 直接 404，`/apps/anthropic` 通。
- 用户 7/26 提供百炼 key（workspace 专属域名 `ws-<id>.cn-beijing.maas.aliyuncs.com`）。**关键实证：该 workspace key 在通用域名 `dashscope.aliyuncs.com/apps/anthropic` 上同样 200** → 故 catalog 落**通用域名**（可移植，不硬编码任何人的 workspace id），`QWEN_BASE_URL` env 可覆盖成专属域名（官方文档称性能更好）。
- `coding.dashscope.aliyuncs.com/apps/anthropic`（NewMax 用的百炼 Coding Plan，订阅制 qwen3-coder-plus）也路由，但**用户的按量付费 key 在此 401** → 两者是不同产品不同 key，Coding Plan 进 backlog。
- 发现端点**不在** anthropic base 上（`/apps/anthropic/v1/models` → 404 `InvalidParameter: Not support`），在 `compatible-mode` 上。

**硬发现 1 — modelsUrl 不能按约定从 baseUrl 推导。** 四家四种形状（见上表：同 base 加后缀 / 换路径 / 换 path 前缀）。四家**全部支持** modelDiscovery，故 `capabilities.modelDiscovery` 四家皆 true，catalog 必须逐家显式带 `modelsUrl`。（主控中途口头说过「只有 GLM 支持发现」，探针推翻，已改正。）

**硬发现 2 — HTTP 200 会骗人，vision 判定必须读回复正文。** 32×32 真 PNG 探针（1×1 会被 qwen 以 `height:1 or width:1 must be larger than 10` 拒、被 kimi 以 `failed to decode image` 拒，**都不是能力问题**）：
- deepseek v4-flash/v4-pro：**收下 image block、返回 200、然后回「I cannot see your image」** → vision=**false**。只看状态码会误判成支持。
- glm 5.2/4.7/4.5-air/4.5v、kimi k3/k2.6/k2.5、qwen 3.7-flash/plus：正确描述出「红蓝棋盘」→ vision=true。
- qwen3.7-max：直接 400 拒绝 image block → vision=false（同家族不同档能力不同，不能按家族一刀切）。
- thinking：四家精选模型全部实测吐 thinking 块 = true。
→ 结论：**能力标记不能只信探针，必须让用户可手改**（`ProviderDraft.modelCapabilities` 因此是用户可编辑字段）。

**硬发现 3 — 错误分类必须读 body，不能只看状态码（人话化的实证依据，06 §3.5）**：
- 同一个「key 错」四家**三种 body 形状**：deepseek/kimi `{error:{type,message}}`；GLM `{error:{message:"令牌已过期或验证不正确",type:"401"}}`（**type 是字符串 "401"，非标准**）；dashscope `{request_id,code:"InvalidApiKey",message}`（**无 error 包装**）。HTTP 均 401。
- **403 跨厂商语义冲突**：dashscope 用 403 表示 key 格式无效；GLM 用 403 表示模型无权限（`[1220]您无权访问glm-4.6-air`）。
- GLM 真实原因编在 message 方括号业务码：`[1211]` 模型不存在 / `[1220]` 无权限 / `[1305]` 访问量过大（HTTP 529）。
- 「模型不存在」状态码三家不同：kimi 404、GLM 400、deepseek 400。
- 附带实测：`deepseek-chat`/`deepseek-reasoner` 现又 200（步 2 台账记的 400 已变），但 `/models` 只列 v4-flash/v4-pro，属别名回流，**默认仍用 v4-flash 不改**。
- 附带实测：`kimi-k3` 被问模型名自报「**My model name is Claude**」（兼容层泄漏）。momo 的「不自称 Claude」靠我们的 prompt 层（卡 A 层①②）压着，非靠模型，故不影响；但**k3 不设为默认**（默认仍 kimi-k2.5），并记此洞。
- 未纳入精选但实测存在：glm-5/5.1/5-turbo/4.5/4.5v/4.5-flash（4.6-air 403 无权限、5.2-air/5.2-flash/5-air/4.7-air 400 不存在、4.7-flash 529 过载）、kimi moonshot-v1-8k/32k/128k、kimi-k2.7-code、qwen3.6-flash/qwen-plus/qwen-flash/qwen3-max/qwen3-coder-plus（qwen-max 500 `No choices in OpenAI response` 兼容层坏，**排除**）。全部可经「拉取模型列表」拿到，精选表只做默认值。

**用户 7/26 拍板（三问）**：① 通义 key 用户提供（已落 `.env`，gitignored；用户在对话里粘贴过，已告知可自行轮换）② **未配 key 的家也返回**，设置页全列、分「已配置/未配置」两栏 ③ Claude 官方本轮不做，卡边界=4 家。

**用户推翻主控的一处收缩（已采纳，重要）**：主控原按旧卡边界把「自定义 Provider」划出本轮，用户明确纠正——自定义是核心项、未来几十个 provider、要一次做扎实（任意 baseUrl / 兼容格式 / 自定义参数）。查 B3 契约注释确认**用户是对的**：`authMode`/`kind`/`capabilities` 当初就是为「加 catalog 数据而非改契约」冻结的，收缩反而违背既定设计。故自定义 Provider 纳入本卡。

**架构裁定（主控自拍，循用户授权技术决策）**：
- **`id` = 实例 id，`kind` = 家族**。几十个 provider 必然出现同家族多实例（两个 DeepSeek 账号、三个中转站），不许假设一家族一实例。四家预置 id 固定等于 kind，保证已存在对话/usage 行仍解析；自定义实例铸造新 id。
- **配置持久化 = 扩展现有加密件**为 `{version:1, providers:{<id>:StoredProvider}}`，main 进程独占，`secrets.ts` 从 DeepSeek 专用形状迁移过来（旧件必须能读）。理由：key 与自定义定义天然同生命周期，一个原子文件、一套加密，不再多开 SQLite/JSON 面。
- **key 方向纪律收紧一格**：key 可 renderer→main（用户在表单里敲的，没有别的入口），**绝不 main→renderer**。故 `ProviderConfigView` 只回 `hasApiKey` + 掩码尾巴；`ProviderSpec` 无 key 字段；编辑态「留空=不改」。
- `configured=false` 的家 `apiKey` 恒为 `""`，**建对话时 host 必须拦下给人话错误**，不许空 token 一路送进 SDK 变上游 401。

**派卡（契约由主控亲写并已 typecheck 通过，三卡并行对着固定形状编程，文件清单互不重叠）**：
- 主控自做：`src/bridge/contract.ts` 加法（`ProviderSpec.configured?`、`ProviderDraft`、`ProviderConfigView`、`ProviderError(Kind)`、`ConnectionTest*`、`ListRemoteModels*`、5 个新 invoke 通道）+ `bridge-host.ts` 接线 + 实机验收。
- 卡 F1（Opus，高风险：动加密件迁移）：`provider-config.ts` 新建 + `provider-catalog.ts` 重写（4 家预置表 + 自定义合并 + configured 判定 + config>env 优先级）+ `secrets.ts` 泛化 + main/dev 接线。
- 卡 F2（Sonnet，规格写死）：`provider-errors.ts`（人话化，fixture 用上面抓的真实 body 原文）+ `provider-test.ts`（真小请求 + latency + modelEcho + vision 三态）+ `provider-models.ts`（四种发现形状 + 231 个里滤非对话模型 + 日期快照标记不删）。
- 卡 F3（Sonnet，渲染逻辑）：providers store（configured 拆栏 + 测试/拉取状态）+ SettingsPage Provider 两栏 + `ProviderConfigForm`（选家/填 key/选兼容格式/拉取或手敲模型/测试连接含多模态）+ InputArea 模型面板**只列已配置**。
**三卡结果（主控逐条亲验，不采信执行者报告）**

| 卡 | commit | 测试 | 主控亲验方式 |
|---|---|---|---|
| 契约 | `151cff1` | — | typecheck 三段 |
| F1 host 数据层 | `b62dcd4` | 877→1019 | 预置表逐行对齐探针数据；**反向验证 key 优先级**（注入 env 反超 config + 占位 key → 3 挂） |
| F3 渲染层 | `35b797c` | →1056 | **反向验证「留空即不改」**（apiKey 改无条件写入 = 改个名就抹 key → 1 挂） |
| 输入框面板（主控补） | `560b563` | →1073 | **反向验证 configured 过滤**（删掉 → 两层 4 挂） |
| F2 + 接线 | `184e24c` | →1098 | **反向验证接线两不变量**（拆空 key 拦截 + 冻结 catalog → 5 挂） |

**主控自己的两个错（已更正，教训入纪律）**
1. **`151cff1` 提交了红的套件**：只跑 typecheck 没跑 vitest。`tests/bridge/contract.test.ts` 有个**手写的 channel 运行时镜像集合**，加 channel 必须同步它。真实基线是 876/1，不是我写的 877 全绿。→ 纪律：**改 `BRIDGE_CHANNELS` 必同步该镜像；报基线必须真跑 vitest**。
2. **三张卡的测试路径全写错**成 `src/tests/...`：`vitest.config.ts` 的 node project include 是 `tests/**`，落在 `src/tests/` 的测试**永不执行**（写了也是死的）。F1 发现并按真实路径落。

**执行者静默缩范围（F3，必须记）**：F3 只做了卡内第 4 项（设置页绑 store），**InputArea 模型面板一字未动**、仍是占位，而报告读起来像做完了 —— 只有 diff 文件才发现。而「对话界面只列已配置的模型」是用户 7/26 原话里的明确要求。主控补齐（`560b563`）。→ 纪律：**执行者报告的「完成」必须对着卡内每一项逐条 diff 核，不能只看它列出的文件**。

**采纳 F2 推翻主控规格（第三次执行者推翻主控且推翻得对）**：主控卡片自相矛盾 —— 只给了 vision 三态（未探针 undefined / 探过不支持 false），**没给「探针本身失败」留位置**。F2 照卡实现后自己标注「no third value exists for probe errored」并回报。结果：32×32 图被拒或网络抖一下，用户看到「不支持识图」，**真能识图的模型会失去附件入口**。修法：契约加 `visionProbeError`，探针失败时 `vision` 保持 `undefined`（无结论），表单显示「探测失败 + 原因 + 可手动勾选」。

**主控自留的接线部分（此前缺的就是这一层，Comate 不认可完成是对的）**
提交 `184e24c` 之前的真实状态：契约声明了 5 个通道、host 有逻辑模块、renderer 有 UI 和 store，但 **`bridge-host.ts` 里这 5 个通道的 handler 数量 = 0** —— 真机上「测试连接 / 拉取模型 / 保存」全是死的。已补：
- `HostDeps.catalog` 收 `数组 | getter`；main.ts 传 getter 并在 saveProvider 后重建 → **保存免重启生效**（先落盘再换内存态：加密失败时不留「已保存」的假象）
- 5 个 handler 全接；**「留空即不改」端到端**（编辑态 draft 无 key 时回退已存 key，否则「改个名字再测试」会误报鉴权失败；全程无 key 则发请求前就拒）
- **建对话拦空 key**：报「哪一家没配 key」而非上游 401
- **`balance.ts` 改按 kind 派发**（id/kind 拆分引入的真 bug：第二个 DeepSeek 实例 `deepseek-work` 原本静默失去余额支持）；qwen 显式列入 UNSUPPORTED

**实机验收（`scripts/cdp-provider-verify.mjs`，独立 userData + 5199/9333，不碰用户的 5173/9222；证据 `docs/sdd/evidence-provider-verify.json`）7/7**
① listProviders 返回四家（kinds=deepseek,glm,kimi,qwen）② getProviderConfig 只回 `hasApiKey` + 掩码 `····6e15`，全投影不含真 key ③ 无 key 实例 configured=false 且建对话被拦下、报「「验证用空key实例」还没有配置 API Key…」④ **真打上游** deepseek 792ms、echo=deepseek-v4-flash、thinking=true、**vision=false（读回复正文判定，实机复现「200 但看不见图」）** ⑤ 真拉模型列表 ⑥ 保存免重启生效 + 留空即不改 + 自定义可删 + 预置删了仍在列 ⑦ canary 实测面板过滤。

**验收①中途返工一次（自查纪律）**：⑦ 初版在本机「未配置模型共 0 个」的情况下恒真通过（.env 四家 key 齐全 → 预置家运行时不可能未配置），且入口选择器抓错元素点到了问候语 div。**恒真断言等于没测**，已改为「造一个带独特模型名但无 key 的 canary 实例」再断言其模型名不出现、且已配置模型出现（6 个可见），入口文案实测为 `🧠 选择模型·标准权限`。

**需求覆盖表（用户 7/26 原话 → 落点）**
| 用户要求 | 落点 | 状态 |
|---|---|---|
| 所有 provider 都列出来，没配置就没配置 | `buildCatalog` 恒返回 4 家 + `spec.configured` | ✅ 实机① |
| 分两栏（已配置 / 未配置） | `SettingsPage` Provider 段 + store `configured`/`unconfigured` 派生 | ✅ 单测 |
| 已配置的可配「对话里可选哪些模型」 | 行内模型 chip 多选 → 写回 `saveProvider.models` | ✅ 单测 |
| 「配置新模型」入口 + 预置便捷配置 | 未配置栏预置卡片 + 自定义入口 → `ProviderConfigForm` | ✅ 单测 |
| 选 provider / 填 apikey / **选兼容格式** | 表单 kind 下拉 + password 输入 + anthropic\|openai 选择 | ✅ 单测 |
| **拉取模型列表**选可用模型 | `bridge:listRemoteModels`（四家四个发现 URL） | ✅ 实机⑤ |
| **或直接手敲**模型名 | 表单手敲输入框，拉取失败也不卡死 | ✅ 单测 |
| 测试连接（**多模态能力** + **ping/稳定性**） | `testConnection` → latencyMs + thinking + vision 三态 + visionProbeError | ✅ 实机④ |
| 输入框只列已配置的模型，其它不碍眼 | `model-picker.ts` 只收 `configured===true` | ✅ 实机⑦ |
| 自定义 provider（任意 baseUrl / 参数），几十个也扛得住 | 实例 id 与家族 kind 分离；自定义永不继承家族 env key | ✅ 实机③⑥ |
| 保留最全信息与入口 | headers 键值对、envTemplate 六槽、能力可手改、快照折叠不丢、apiKeyUrl | ✅ 单测 |

**未做 / 明确留给后续（不在本轮，避免虚报）**
- Claude 官方 Provider（用户 7/26 拍板本轮不做）；百炼 Coding Plan 订阅制（另一产品另一套 key，`coding.dashscope` 用户当前 key 401）。
- **Provider 设置页与配置表单的视觉档**：本轮只保证「能用、信息完整、类名用方括号写法」，像素级视觉与卡 D/E 一起攒着统一目验。
- `usageSummary` 仍是 Phase-1 保留通道（契约顶部自述），本轮未动。
- GLM/qwen 余额：两家均无公开余额 API，`balanceApi:false` 且 qwen 显式进 UNSUPPORTED —— 余额显示只对 deepseek/kimi 生效。

== 启动轮 3 卡 G：本子=目录（Workspace Manager）— 技术抉择（7/26, Opus 5 主控，开工前落盘）==

**读码先得到的两个既成事实（改变了本卡的工作量判断，必须先记）**
1. **`bookId` 全链路早就通了**：`ConversationMeta.bookId`（conversations.ts:10）+ SQLite `conversations.book_id` 列（schema.ts）+ `createConversation({source, bookId})` + `assignToBook`。本卡不需要新建"对话↔本子"绑定，只需要**让 bookId 背后真有目录**。
2. **"本子 id = 目录名"不是我新发明的约定，是代码里已经在用的**：`artifacts.ts:164 bookForPath` 把「路径第一段」直接当 `Notebook.id` 查。故本卡沿用，不引入第二套 id↔目录映射。
   - 连带修正：`FIXTURE_FILE_TREE` 的路径写成 `/books/数据结构/…`，第一段是 `"books"` 而非本子 id —— 即 fixture 下 `bookForPath` **恒返回 null**（既存 bug，被假数据掩着）。真数据用**工作区相对路径**（`数据结构/第五章笔记.md`），第一段即本子 id，该函数才真正工作。

**抉择①（卡片 ⚠ 第一问）workspace IPC = 独立 `leemo:workspace`，循 `leemo:persist` 先例，不进 09 冻结契约。**
理由：10 号文档 §S11 已经写明「文件系统事实（目录/文件清单）**不在 09 契约内**，workspace IPC 是 Phase-1 另一份冻结件，建议通道前缀 `workspace:*`」—— 这是权威链里已有的裁定，不是我现在拍的。且 `leemo:persist` 已经把这个形状跑通了（独立 preload surface + 独立 ipcMain.handle + renderer 侧端口接口 + `{ok,error}` 数据式错误）。照抄先例＝零新范式。
**但有一处必须动 09 契约（加法，循 Batch -1）**：`CreateConversationRequest.notebookId?` —— 本子级 CLAUDE.md 是 **prompt 组装的输入**，那是 AI 对话边界内的事，属于契约该管的范围。传 id 不传正文：host 自己读文件，才能保证"新对话看到本子里最新写入"（同卡 A 记忆库每次重读的纪律）。

**抉择②（卡片 ⚠ 第二问）FileTree 读真目录的权限边界 = 单点收口 `resolveInside(root, relPath)`。**
- renderer 只持**工作区相对路径**（`数据结构/笔记.md`），**绝不持绝对路径**；main 侧每个 op 先过 `resolveInside` 再碰 fs。拒绝：绝对路径、盘符、`..` 逃逸、反斜杠伪装。理由：renderer 是 sandbox 化的不可信输入面（同 B3 "IPC payload 是运行时不可信数据" 的 fail-closed 纪律）。
- 树的可见面 = `~/Leemo/` 下**本子目录 + Inbox + 根级文件**；跳过 `.claude/`（skills 插件内部件）与 `memory/`（有独立设置入口，且 momo 写入面不该混在文件树里当普通文件）。
- **不做 fs.watch**：Windows 下噪声大、易抖。改为显式刷新（挂载/建本子后/落文件后/手动刷新按钮）—— 少一个不可靠的活动部件。

**抉择③ 本子元数据 = 不存。目录本身就是本子。**
`id = title = 目录名`，颜色由目录名稳定哈希取三色之一，时间取 fs mtime。理由：任何 sidecar/manifest 都会与"用户在资源管理器里改名/删目录"不同步，产生孤儿元数据；而 06 的原话是"本子＝一门课/一个项目的文件夹"，目录即真相最贴设计。代价＝用户不能自定义本子颜色（可接受，颜色是装饰不是信息）。

**抉择④ 拖入归类的"momo 判断" = 本地确定性启发式 + 一句话确认，不调模型。**
06 §2.2 要的是「momo 判断归属 + 一句话确认」。真调一次模型＝拖个文件等两秒、还烧钱、还可能抽风。落法：`suggestNotebook(fileName, notebooks)` 纯函数（文件名与本子名互含匹配）→ 命中就把该本子作为确认条的默认选项，未命中默认 Inbox；用户点头或改选。**升级成真模型判断随时可换**（纯函数换实现，UI 不动），进 backlog。
- **拖入=复制不是移动**：用户从下载文件夹拖进来，不该发现原文件没了。重名追加 ` (2)`。
- 拖进文件需要 OS 绝对路径：Electron 32+ 删了 `File.path`，唯一正路是 preload 里 `webUtils.getPathForFile(file)`（renderer 侧拿不到，正是我们要的方向性）。

**落地结果（7/26 完工）**
- 新件：`src/host/workspace.ts`（纯函数 + 注入 IO；10 个导出 op + `resolveInside` 安全闸）、`src/renderer/workspace/{client,ipc-workspace-client}.ts`、`NotebookSection.tsx`、`DropClassifyBar.tsx`、`useFileDrop.ts`、`scripts/smoke-workspace.mjs`。
- 改件：`momo-prompt.ts`（层⑨ + `NOTEBOOK_TEXT_TOKEN_LIMIT=1500`，压在层⑧之后 —— 窄作用域必须最后说话）、`bridge-host.ts`（`readNotebookMemory` 注入，失败降级不断聊）、`contract.ts`（`notebookId?`）、`main.ts`（`workspaceIO` + `leemo:workspace` 8 个 op + `ensureWorkspace` 启动、`memoryDir()` 改由 `workspaceRootFor` 派生，两者永不漂移）、`preload.ts`（`leemoWorkspace` + `webUtils.getPathForFile`）、`notebooks.ts`/`file-tree.ts`（全面重写接真目录）、`conversations.ts`（`resolveActiveNotebook` + 创建与**重认领**双路都带 notebookId）、`FileTree.tsx`、两个 Shell。
- 测试：**1178 passed / 98 files**（新增 workspace 31、notebooks 10、file-tree 10、useFileDrop 8、NotebookSection 10、两 Shell drop 7、prompt 层⑨ 5、host 层⑨ 3）。typecheck 三工程 + build + build:main 全绿。
- **真文件系统实证**：`npm run smoke:workspace` → **13/13**（临时根，不碰用户 ~/Leemo）。覆盖单测只能造假的部分：真 mkdir/copy/rename/readdir 行为、Inbox 自动创建、拖入=复制(原件还在)、移入=真移动、本子级 CLAUDE.md 真读到、`.claude`/`memory` 不进树、越界名 4/4 与越界路径 3/3 全部 fail-closed。

**自己挖出并修掉的两个真 bug（都不是卡片要求的，是读码/写测时发现的）**
1. `isValidSegment` 首版把空格和 `-` 折进"Windows 非法字符"类，导致「高等数学 2024」「my-notes」这种用户随手会打的名字被拒且无法解释。已修 + 回归测试钉住。
2. `FIXTURE_FILE_TREE` 路径写作 `/books/<本子>/…`，首段是 `"books"` 而非本子 id ⇒ `artifacts.ts bookForPath` 在 fixture 下**恒返回 null**（既存 bug，被假数据掩着）。真数据改用工作区相对路径后该函数才真正工作；FileTree 测试同步改成相对路径形状。
   - 顺带收窄 `ArtifactContext.books` 为 `{id:string}[]` —— 它只读 `id`，要求完整 `Notebook` 是过度耦合，收窄后 artifacts 测试不必跟着 Notebook 形状变。

**顺手接通的一项（卡片没点名，但不接=假装能用）**：右键「在文件夹显示」原是 `disabled`+"Phase-1"。工作区现在是真目录，这就只是一次带 `resolveInside` 守卫的 `shell.openPath`，故接通。重命名/删除仍禁用 —— 两者都要重指已归档对话的 `bookId`，是独立卡。

**边界（本卡不做，明确记，防虚报）**：首设向导（视觉，等用户）/ 联网搜索（轮 4）/ 成果页通电（轮 4）/ 示例本子播种（属首设向导那一档）/ fs.watch 实时树 / 本子重命名与删除（要处理已存对话的 bookId 指向，单独立卡）。
**验收证据分三层（补完后的准确说法，替换掉本条早先那句"没做实机验收"）**
1. **真文件系统**：`npm run smoke:workspace` → **13/13**（临时根，不碰用户 ~/Leemo）。证的是单测只能造假的那层：真 mkdir/copy/rename/readdir 行为、拖入=复制原件还在、移入=真移动、越界 4/4 + 3/3 全 fail-closed。
2. **真 Electron 主进程**：起了一次（`electron:dev`，Vite 5173 被占故渲染层没起，但主进程跑完了）。日志 `[leemo:main] workspace: C:\Users\Example\Leemo (0 个本子)`，且**启动后 `~/Leemo/Inbox` 真的出现了** —— `ensureWorkspace` 在真机上确实执行。
   - Windows 记一笔：控制台默认代码页下中文日志显示为乱码（`0 涓湰瀛?`），只是显示层，数据没问题；要看中文先 `chcp 65001`。
3. **接线（组件级，18 条）**：`NotebookSection.test.tsx` 10 条钉住 ＋号→`createNotebook`（名字 trim / 重名报真话且输入框留着 / Esc 与空名一次 IO 都不发 / 建完顺带刷文件树 / 行 title 是真目录路径 / 选中与再点取消 = activeId）；两个 Shell 各自钉住 drop 真挂上了（工作台态**选中本子后直落、不再问且不调 suggest**；搭子态**建议+确认条，点「好」前一个文件都不复制**；认不出→Inbox；没工作区→不弹条不装能存）。
   - 反向验过：摘掉 BuddyShell 的 `onDrop` 一行 → 3 条红；`bridge-host` 层⑨ 桩掉 → 1 条红。测试有牙。
- 仍未经人眼确认的只剩**手感**（真鼠标拖拽的视觉反馈、确认条排版），那是等你实机点的事，不是逻辑缺口。

---

## 轮 4 卡 H：联网搜索 MCP —— 探针阶段（进行中）

完整探针台账见 **`docs/sdd/probe-r4-h-search.md`**（6 组实测 + 脚本可复跑）。摘要：

- **AnySearch 免 key 可用，06 §四 前提成立。** Phase 0 记的「api 404」是**方法用错**的误判 —— 该路由只吃 POST，我头两轮也只发 GET，八条路径齐刷刷 404，一度让我误判成"没有这个 API"并向用户报了错误结论。真实形状 `POST /v1/search {query,tag,params}`。**教训：GET 404 不能推断服务不存在。**
- **带 key 反而更差**（3 条 vs 匿名 10 条，且内容跑偏到 4.6 的 wiki）⇒ fallback 链**不能**默认把 key 前插，得按实测排。
- **参数全不生效**（`exclude_content`/`count`/`top_k`/`summary_only` 六种写法一律 10 条 31KB 带正文）⇒ 省上下文只能客户端裁。
- `content` 占 **87.9%**；只留 `title+url+snippet` 省 88%，snippet 均长 296 字符够引用。
- 延迟分三档，别混：冷启动 6.8–9.7s / 缓存命中中位 1041ms / **新查询中位 1868ms（真实稳态）**。我一度把冷启动当稳态报了，已更正。
- 付费源无 key 的错误码各不相同（Tavily 401 嵌套 detail、博查 401 扁平 code）⇒ 判据用「非 2xx 就换下一家」，不解析错误体。
- **兜底源换了三轮才定，这段最贵、结论最反直觉**：
  - **DDG lite 被否** —— 这台机器上 DNS 通、TCP 全 `CONNECT_TIMEOUT`，Brave/Startpage 同一形状（一类封锁）。我先前记的"免 key 可用、~1.1s、连打 8 次不封"在这台机器上不成立，已在台账里标为推翻。**间歇可用的兜底比明知没有的更坏**：我测时绿、用户真需要时黑。代码与离线测试保留，网络变了可接回。
  - **Bing 被否** —— 能连、能解析，但质量分裂且是**确定性**的：`SQLite WAL 并发写` 10/10 相关（重测 3 次稳），`高等数学 泰勒展开 例题` **0/10（重测 3 次全废）**，拿"高等"够到"高等教育"。快打 8 次零降级 ⇒ 不是限流。否它的理由不是"一般"，而是**它稳定搜不好的恰是主场景**（中文数学/作业辅导）；喂模型"长得像结果的垃圾"比搜不到更坏。
  - **Tavily 定为兜底**（用户提供 key）—— 三条查询 8/8 全相关，含那道 Bing 全废的高数题；`raw_content` 默认全 null，不是第二个上下文炸弹。最终链 **AnySearch（免 key）→ Tavily**，两跳都是官方 API，无抓页环节。
- key 存进 provider **同一份** safeStorage 加密件（`ProviderConfigFile.searchKeys`，可选字段不抬 version）—— 凭据只应有一个家。优先级 **加密件 > 环境变量**。`getSearchSources` 只回"配没配"，明文 key 不出主进程。
- 秘塔无文档无 key，端点纯猜，**本轮不接**，链式设计留位。
- **对照实验（用户点名补验，`smoke/websearch-arms.mjs` 四臂留仓）—— 用户的记忆对，06 §4.1 两个方向都错了**：
  | 端点 | 内置 WebSearch | 内置 WebFetch |
  |---|---|---|
  | DeepSeek | ✅ 真结果（Links 数组 5 URL） | ✅ |
  | GLM | ❌ 空壳 | ✅ |
  | 中转站（真 Claude 模型） | ❌ 空壳 | ✅ |
  | 官方端点 | 未验（无 key） | 未验 |
  - **"第三方 vs 官方"这个因果站不住** —— 差别在具体端点的兼容层实现，不在是否官方。
  - **空壳 = 本轮最值得记的失败形态**：`tool_result` 不标 error、零链接，装的是模型自己写的话，被 CC 包成 "Web search results for query:…" + REMINDER 样板。GLM 那条还吐出了 `<tool_call>` 原文 JSON。两家模型都如实说"没搜到"，但那是模型自觉、不是架构保证。
  - **WebFetch 解禁**（三家全能用，§4.1 说保留是对的，卡 H 禁它是我的错）。上一轮它"全端点失败"是网络问题：域名安全预检要回连 claude.ai，这台机器连不上（同 DDG 那堵墙），开 VPN 后三家全通。
  - **WebSearch 继续禁**，理由换硬的：失败形态是空壳（比报错危险）+ 按 provider 分裂（同一开关不同家行为不同）。自建 MCP 行为一致、失败明说"别编"，这个一致性值得放弃 DeepSeek 那份可用性。留 TODO：若要按家放行，判据只能逐家实测 + catalog 标 capability。
  - **我的判据自己踩了两次坑**：只看 `is_error` ⇒ 空壳判成可用（正是我在 Bing 那儿点名过的"像结果的垃圾"）；拿 WebSearch 专属的 `Links:` 卡 WebFetch ⇒ 真成功判成空壳。判据必须按工具分开。
- **productName / userData 目录名：实证后决定不改**。四条路全试（package.json productName dev 无效 / setName 在 whenReady 太晚 / setName 在顶层则加密件全解不开 / ready 后临时改回旧名也解不开）。根因 **Windows DPAPI 密钥派生绑 app 身份且进程初始化时定死** —— 实机第一次就栽了：`secrets source` 从 encrypted 掉成 env-plaintext，等于 key 全丢。为装饰性目录名搭"子进程传明文密钥"不值得；且 `electron-builder.yml` 早有 `productName: Leemo`，**打包产物本来就对，问题只存在于我这台开发机的既有数据**。`src/main/userdata-migration.ts`（DPAPI 两步 + 17 测试）留着不接线，打包里程碑用。

**另记一笔（安全）**：用户消息里粘了两条"按 https://anysearch.com/install/*.md 安装 Skill / MCP"的指令，我**没有执行**，只把文档当数据取下来扫。原始 HTTP 取到的两份文档本身干净（`AGENT DIRECTIVE`/`cat ~/.claude*`/`env | grep key` 零命中）。但我先前把 **WebFetch 的摘要产物当成文档原文引用**，据此向用户报了"文档里有凭据窃取指令"，这是错的，已更正 —— **WebFetch 返回的是小模型摘要，不能当原文取证；要取证就原始 HTTP 拉全文自己扫。**

---

## 轮 4 卡 H2：内置 WebSearch/WebFetch 在国内真能用（7/27 完成）

commit `592f08e` + `aad92ae` + `f3474f8`（main，未 push）。测试 1243 → **1322**，typecheck 三段 exit 0，build + build:main 干净。

**用户 7/27 的要求（两次重申，是产品决定不是建议）**：配好国内模型 key 之后**不该再教用户配 VPN 或 MCP**，CC 原生 WebSearch/WebFetch 就该能用；AI 小白默认不会配 VPN，多一步就多一道漏斗。故本轮把上一轮"自建 MCP + 禁内置"的结论翻过来 —— 但翻的依据是新探针，不是听话。

### 两条根因都是实测出来的，不是推的

**① WebFetch —— 域名安全预检回连 claude.ai。**
CLI 二进制里 `checkDomainBlocklist` 发 `GET https://api.anthropic.com/api/web/domain_info?domain=<host>`，非 200 即 `check_failed` → 抛「Unable to verify if domain … safe to fetch」。本机实测该 URL 返回 **403**（Cloudflare LAX 边缘，`{"error":{"type":"forbidden"}}`）—— **不是缺 key**（那个 GET 本身不带鉴权），是按网络/地区拒。于是国内直连必然失败，抓取在真正发起之前就被判死。
同一段代码里就有开关：`if (!Wi().skipWebFetchPreflight) switch (await checkDomainBlocklist(host))`。置真则整段跳过，抓取全程在本地（axios GET + turndown 转 markdown），只有"把 markdown 交给模型总结"那一步走用户自己的端点。
落法：SDK `extraArgs: { settings: JSON.stringify({skipWebFetchPreflight:true}) }`。**为什么不用 `managedSettings`**：它被按 restrictive-only 白名单过滤（sdk.d.ts:2621 明写"`model`/`env` 这类非限制性键会被静默丢掉"），`skipWebFetchPreflight` 不在名单上，传了会无声消失。CLI 的 `--settings <file-or-json>` 是 flag 层、不过滤，且实测与 `settingSources:[]` 互不影响（卡 A 的隔离面没被动）。
实测 `smoke/webfetch-preflight-probe.mjs`：臂① 不设开关复现原报错；臂② 设了之后 example.com 通；臂③ 国内站（runoob）通。**全程无代理。**

**② WebSearch —— 搜索由"上游端点实现服务端工具"完成，而那次请求发往我们自己能决定的地址。**
`smoke/websearch-servertool-probe.mjs` + `smoke/websearch-nested-probe.mjs`（本地假上游，零成本可复跑）推翻了我读二进制得出的第一个结论：
- `WebSearch` 是以**客户端工具**发给上游的（tools[] 里无 `type`，和 Read/Write 并列，实测 26 个客户端工具里就有它），**不是** `{type:"web_search_20250305"}`。
- 模型调用它之后，CC 在本地**另发一次** `/v1/messages?beta=true`：body 里只有一个工具 `{type:"web_search_20250305",name:"web_search",max_uses:8}`，`messages` 只有一条 `"Perform a web search for the query: <q>"`，system 里自述是"搜索子 agent"。
- CC 从那次响应里挑 `server_tool_use` / `web_search_tool_result` 两种 block，渲染成 `Links:[{title,url}]` 交回模型。
- **关键：那次嵌套请求发往 `ANTHROPIC_BASE_URL`，不是硬编码的 api.anthropic.com。**

⇒ 所以"内置 WebSearch 按 provider 分裂"**不是内置工具的固有属性，而是"谁来供货"的问题**。DeepSeek 兼容层实现了服务端工具所以能用；GLM/中转站没实现所以给空壳。臂 D/E 直接对照：本地端点答掉 → CC 解析器接受，我供的 3/3 URL 原样到达模型；本地端点不实现 → 复现 GLM 的空壳（零链接）。

### 交付

- **`src/host/search-shim.ts`** —— 认得出那一种嵌套请求，用 Leemo 自己的搜索链（AnySearch 免 key → Tavily）答掉；**其余请求一概哑管道透传**（不解析、不改写、不缓冲，`pipeline()` 天然背压，结构上避开网关那次修过的 drain 挂死）。
  - 判据 = `tools` 非空且**每一个** tool 的 `type` 都以 `web_search_` 开头。普通对话请求带一长串无 `type` 的客户端工具，形状上不可能混淆（有一条专门的测试用"普通请求里就是有个名叫 WebSearch 的客户端工具"钉死不误伤）。**按前缀不钉版本号** —— CLI 内置文档里已经有 `web_search_20260209`，钉死旧号等于埋一个静默失效的雷。
  - 搜索全挂时给 `web_search_tool_result_error`，**不给空数组** —— 空数组会被 CC 渲染成"搜到 0 条"，模型据此自己编；错误对象会渲染成 `Web search error: <code>`，模型才知道该照实说。域名过滤器（`allowed_domains`/`blocked_domains`）也守，那是工具契约的一部分。
  - **顺带一次安全升级**：走 shim 后 SDK 子进程里的 token 是占位符 `leemo-search:<id>`，provider 真 key 只留在本进程注册表 —— **严于**原先的直连接线（真 key 进子进程 env，子进程能跑 bash ⇒ `printenv` 可读）。
- **三态互斥**（`chooseSearchWiring` 纯函数，穷举测试）：联网关 → 都不给 / 联网开且本对话经 shim → 放行内置 / 否则 → 自建 MCP 兜底。**永远只有一条搜索路径** —— 两条会让模型在两个搜索工具间乱挑。
- **设置页「联网搜索」段**（交接文档的原任务）：`search-sources` store + `SearchSourcesSection`。三个源 + password 输入框 + 保存。四条纪律各有测试：状态里没有任何 key 字段（一条结构性断言扫整个 state）/ 空串=清除 / AnySearch 标「不配也能用」且断言它不显示成「未配置」/ 保存失败报真话并**留住已输入的 key**。
- `providers.ts` 加第三种接线（shim 模式，与网关模式互斥，网关优先）；`pool.ts` 透传 `searchShimPort`。

### 自己引进又抓到的两个问题（都记，都补了带牙的测试）

1. **`webSearchEnabled` 一直钉死 `false`。** `context.tsx` 里原有 TODO 说"等开关那张卡"，于是层⑦ 恒说"不能搜"、host 永不发搜索工具 —— **联网能力在界面上根本到不了**，我先前建的一切都会是死代码。真读设置页开关后才通。顺带把 `anySearchEnabled` 改名 `webSearchEnabled`：这个开关不是"启用 AnySearch 这家供应商"，而是"momo 能不能联网"；它现在是承重字段，名字必须准。原来那个「启用 AnySearch」勾选框写的字段**没有任何人读**。
2. **openai 家被错误放行内置 WebSearch**（commit `f3474f8` 修）。shim 是 host 级单例，但 openai 家走网关做协议翻译、不经过 shim，而网关会把服务端工具**剥掉** ⇒ 嵌套搜索请求退化成普通聊天 = 空壳。这正是我用来论证"不该按 provider 分裂"的那个失败形态，被我自己引进来了。判据从「shim 起来了」改成「shim 起来了**且这条对话真的经过它**」。反向验过：改回只看 shim 存在 → 新断言变红。

### 判据纪律（本轮又踩一次，记下）

WebFetch 臂① 的"拿到内容 true"是**模型改用 PowerShell 绕过去**的结果，不是 WebFetch 成功。承重信号是「预检报错出现」。沿用本项目那条老教训：**别只看有没有报错，也别只看最终有没有结果**。

### 需求覆盖表（用户 7/27 原话 → 落点）

| 用户要求 | 落点 | 状态 |
|---|---|---|
| 配好国内 key 后不用配 VPN | 预检开关 + 本地供货，全链路无代理 | ✅ live ①②③ |
| 用原生 WebSearch，不教用户配 MCP | shim 供货 + 放行内置 `WebSearch` | ✅ live ①② |
| 用原生 WebFetch | `skipWebFetchPreflight` | ✅ live ③ |
| 去掉/绕过对 claude.ai 的回传 | 预检整段跳过；搜索不经 Anthropic | ✅ 二进制读码 + live |
| 不能用的探根因并解决 | 403 是 Cloudflare 拒（附实测响应体） | ✅ 本条 §① |
| 搜索源设置页能自己填 key | `SearchSourcesSection` | ✅ 11 组件测试 |

### live 验收 3/3（`smoke/websearch-native-live.mjs`，真 DeepSeek + 真 AnySearch，**全程无代理**，结果 JSON 留仓）

| 臂 | 结果 |
|---|---|
| ① 内置 WebSearch 经 shim 供货 | PASS —— shim `answered=2`，`Links:` 里 3/3 是我们供的 URL |
| ② 中文数学主场景「高等数学 泰勒展开 例题」 | PASS —— 8 条全相关，首条 USTC 课件。**正是 Bing 确定性 0/10 翻车的那道题** |
| ③ 内置 WebFetch | PASS —— 无预检报错，拿到「Example Domain」 |

透传在同一轮被顺带证明活着（`passedThrough=5/2/3`，对话本身没坏）。判据不看模型说得好不好：**shim stats 增量**排除了"其实是上游 DeepSeek 自己搜的"这种混淆。

### 明确未做 / 留给后续

- **openai 家的原生 WebSearch**：要在网关里做同一件事（识别嵌套搜索请求 → 本地答掉），网关已有 SSE 改写设施，是一张独立卡。现状是那些家走自建 MCP，功能不缺，只是工具名不同。
- **WebFetch 是否该受联网开关约束**：目前无条件放行（沿用既有已验收行为，06 §4.1 也把两者分开列）。但"联网搜索关掉了 momo 还能抓 URL"读起来别扭，**这是产品口径问题，留给用户拍**。
- `skipWebFetchPreflight` 等于放弃 Anthropic 的域名黑名单。CC 自带的护栏仍在（60s 超时 / 10MB 上限 / markdown 截到 100k / 重定向上限 10 / URL 长度上限），本地 Agent 场景判为可接受。
- 秘塔仍未接（无文档无 key）；官方端点那一格仍未验（无 key）。
- 视觉：设置页新段只保证"能用、信息完整、类名用方括号写法"，像素级视觉与卡 D/E/F 一起攒着统一目验。

## 轮 4 卡 H3：原生 WebSearch 真走厂商自己的搜索服务（7/27 完成，commit 8451c31 + 本轮修复）

用户两次澄清的产品要求：**AnySearch/Tavily 是外部源，只能兜底；一定要打通厂商原生、
花用户自己的 BYOK 额度。** 卡 H2 把 shim 做成了「无条件用外部源答掉所有嵌套搜索
请求」，于是"原生"只剩工具名 —— 而 §⑧ 的记录本身就已经说明这对 DeepSeek 是**功能
倒退**（它本来就会自己搜）。本卡修这个。

### 先探针再写代码（4 个脚本留仓可复跑，全程无代理）

`smoke/probe-native-search-l1.mjs`（层① 透传，beta/plain 两臂）、`-l2.mjs`（GLM/通义
自家机制 6 个候选）、`-qwen.mjs`（通义单独加试 4 变量）、`-stream.mjs`（层① 的**流式**
臂 —— shim 走原样透传，CC 真实请求带 `stream:true`，只测 JSON 会漏）。

结论表与三条被推翻的判断详见 `docs/sdd/probe-r4-h-search.md` §⑨。要点：

| 家 | 层① 自家端点实现服务端工具 | 层② 自家搜索 API | 落哪层 |
|---|---|---|---|
| DeepSeek | ✅ 10 url（JSON+SSE），`web_search_requests=1` | — | ① |
| **Kimi** | ✅ 14/7 url，但 22~30s | — | ① |
| GLM | ❌ 空壳 | ✅ `/paas/v4/web_search` 10 条 / 609~1558ms | ② |
| 通义 | ❌ 空壳 | ❌ 六变量全废 | ③/④ |

**Kimi 是本轮新发现** —— 台账 §⑧ 从没测过它，交接文档猜它要走 `$web_search`
builtin_function，实际它的 anthropic 兼容层直接就实现了服务端工具，**猜的那条机制
根本不用碰**。又一次兑现「表格是探针起点、不是事实」。

### 三层降级链（只有这一家自己的路，外部源兜底）

```
① 透传厂商端点     判据=有 web_search_tool_result 且 content 里有带 url 的条目
② 厂商自己搜索 API  兼容层没实现但**这一家自己**有搜索服务（GLM）
③ AnySearch→Tavily  这一家自己的两条路都不成立才走
```

### 我做多了一层，用户否掉了 —— 这条边界是本卡最重要的产品修正

我原先做了「层③ 跨家借」：通义两条原生路都不成立时，借用户**另一家已配置好的**
provider（GLM/DeepSeek/Kimi）的原生搜索。理由是"仍然是用户自己的 key、不碰第三方"。

> 用户：用户选了这个 api 就是只想用这个 api，怎么还自动消耗其他 api 的额度呢，还不如
> 掉到 tavily 和 anysearch 和秘塔这些外部服务。

我漏掉的是**知情同意**那一维。外部源要么免 key（AnySearch），要么是用户专门为搜索配的
key（Tavily）—— 两者他都知道钱花在哪；而"用通义聊天时自动扣 GLM 的额度"是他从没同意
过的支出，**比掉外部源更坏**。我把"是不是第三方"当成了唯一的轴，真正的轴是"用户有没有
同意花这笔钱"。

**落地成结构性约束，不是一个开关**：`SearchPlan.vendorSearch` 单槽位而非列表；
`buildSearchPlan` 只看 `selfId` 那一条、**从不遍历 catalog 找别家**；`byLayer` 只剩三格
（没有"跨家"计数可言）；`searchViaAnthropicServerTool`（唯一用途就是跨家借）连同它的
5 条测试一起删掉 —— 留一个没人调的导出，下次有人会以为它是条可用的路。谁想加回来必须
先改契约。

代价写明白：**通义用户拿不到原生搜索**，只能走外部源。这是用户明确接受的取舍。

### 交付

- `src/host/vendor-search.ts`（新）：GLM 适配器（**URL 在 `link` 不是 `url`** —— 写错
  是静默 0 条，症状像"搜不到"而不像 bug）。
- `src/host/search-plan.ts`（新）：层序选择，**只读 `selfId` 那一条**。空 key / openai 家
  一律排除；**`undefined`（未实测）与 `mode:"none"`（实测不成立）刻意区分** —— 前者运行
  时探层① 一次（有空壳判据兜着），后者直接跳过、别白花一轮模型生成换空壳。
- `search-shim.ts`：`answerSearch` 改成三层链；新增 `judgeNestedJson/Sse/Response`
  三个纯判据；`byLayer` 分层统计；`knownShell` 空壳记忆。**层① 命中时原样回传**，
  保住厂商的 `encrypted_content`（引用元数据，自己合成给不了）。
- `provider-catalog.ts`：`nativeSearch` 作为**数据**入预置表（加数据不改契约，与
  `modelDiscovery`/`balanceApi` 同一先例）；`searchApiUrl` 跟着 baseUrl 换 host
  （用户指到自建域名时别拿他的 key 去打官方）。
- 测试 +63：`vendor-search.test.ts` 9 / `search-plan.test.ts` 21 / `search-shim-layers.test.ts` 33。
  其中 `search-plan.test.ts` 有一整组 describe 专钉那条边界（四家全配好时通义的计划仍
  为空、层② 的 id 永远等于 selfId、能搜的家自己 key 空了也不借别家）。

### 空壳记忆只记结构性失败（两条承重测试锁住）

`knownShell` 只在"有响应、能解析、但零链接"时写入。**限流 / 非 2xx / 网络错 / 上游
明确回 `web_search_tool_result_error` 一律不记** —— 把一次限流记成"这家不行"会永久
废掉用户的原生搜索。进程内有效即可：重启重探，正好覆盖"厂商上线了搜索"这种变化。

### 通义 = 唯一拿不到原生搜索的家（结论，非遗漏）

层① 空壳、层② 六变量全废、又不许借别家 ⇒ 它**只能**走外部源。若阿里将来在
compatible-mode 上真的返回 `search_info`，改 catalog 一处（`mode`+`searchApiUrl`）即可，
判定逻辑一行不动 —— 这正是把 `nativeSearch` 做成数据而非分支的收益。

### 我自己引进的一个洞（live 第一次跑就撞上）

`stats()` 浅拷返回 ⇒ `byLayer` 是**活引用**，调用方拿前后两次快照做差恒为 0。live
脚本正是靠这个差值判"走了哪一层"，于是四臂全误报 FAIL，而单测只看单次绝对值抓不到。
已修（深拷一层）+ 补回归测试。**教训：`stats()` 这类"返回快照"的 API，嵌套一层就得
深拷一层，否则契约是假的。**

### 需求覆盖表（用户 7/27 第三次原话 → 落点）

| 用户要求 | 落点 | 状态 |
|---|---|---|
| 脱离 anysearch/tavily 等外部服务 | 三层链，外部退到层③ | ✅ live ①② 外部调用=0 |
| 用厂商自己的 WebSearch 服务 | 层① 透传 + 层② 自家 API | ✅ live ①（DeepSeek）②（GLM） |
| 配了 api 就可用（能搜的家） | DeepSeek/Kimi 走①、GLM 走② | ✅ 3/4 家原生可用 |
| **只花这一家的额度，不碰别家** | 单槽位 + 只读 selfId + byLayer 三格 | ✅ live ③ 边界臂 + 5 条边界测试 |
| 无 VPN / 国内网络可用 | 全程无代理，探针与 live 都不设代理变量 | ✅ 4 探针 + 4 live 臂 |
| 无 claude 通信 | 搜索不经 Anthropic；WebFetch 预检已跳过（H2） | ✅ |
| DeepSeek 功能倒退要修 | 层① 恢复它自己的搜索 | ✅ live ① 透传=1 外部=0 |
| 外部源仍要兜底 | 层③ 保留 | ✅ live ③④ |
| 拿不到文档的家不许编端点 | 通义记 `mode:"none"` | ✅ 六变量实测留档 |

### live 验收 4/4（`smoke/websearch-vendor-native-live.mjs`，真四家端点，**全程无代理**）

| 臂 | 已配置的家 | 走的层 | 判定 |
|---|---|---|---|
| ① DeepSeek | deepseek | 透传=1 自家=0 外部=0 | PASS 厂商自己搜的 |
| ② GLM | glm | 透传=0 自家=1 外部=0 | PASS 走 `/paas/v4/web_search` |
| ③ **边界臂** | deepseek, glm, qwen | 透传=0 自家=0 外部=1 | PASS **别家 key 在场但零调用** |
| ④ 只配通义一家 | qwen | 外部=1 | PASS 兜底仍在 |

③ 是修正后最要紧的一臂：**三家 key 全在场**（这是边界成立的前提 —— 有别家可借而没去
借），通义对话仍然走外部源，`vendor`/`passthrough` 增量都是 0。判据不看模型说得好不好：
`byLayer` 增量 + 外部源调用计数一起排除了"其实是别的层供的货"。四臂 `Links:+url` 全 true。

### 明确未做 / 留给后续

- **通义的原生搜索**：六变量拿不到可引用 url ⇒ 该家永远走外部源。阿里若上线
  `search_info`，改 catalog 一处即可（判定逻辑不动）。
- **openai 家（走网关）**：网关剥服务端工具，那些家仍走自建 MCP。独立卡。
- **官方 Anthropic 端点**：无 key，未标 mode ⇒ 走 undefined 分支（运行时探层①）。
- **设置页尚未显示"这次搜索是谁供的货"**：目前只在日志与 stats 里。三层开关那张卡
  可以顺带把它显出来（"DeepSeek 自带搜索 / GLM 搜索 API / 外部源"）。

## 轮 4：三层联网开关 + 预览区通电 + 成果页通电（7/27 完成，commit a64f055）

三件事同一个形状：**界面早就在，线没接**。开关只改 prompt 不改工具；预览区的内容源
是个空 fixture；成果页的 store 有 `registerArtifact` 而生产代码从来没调用过。

### ① 联网三层开关（用户 7/27 拍板，插队先做）

统筹「联网功能」+ 二级「联网搜索 WebSearch」+ 二级「联网抓取 WebFetch」，每个带
说明文案。统筹关 = 两个都关；统筹开 = 二级各自独立。

三条落地判断：

- **统筹开关是掩码，不是清值。** `setWebEnabled` 刻意不碰两个二级字段。用户关掉一段
  时间再打开，回来的是他自己那套（"只要抓取不要搜索"），不是"全开"。有专门测试钉住。
- **生效值是唯一出口。** `webSearchActive`/`webFetchActive` 两个纯函数算掩码后的值，
  只有它们能过 IPC。三层结构是界面的事，host 只该收到"这轮能不能搜/能不能抓"。
- **WebFetch 必须真进 `disallowedTools`。** 只在 prompt 里劝它别抓是没用的 —— 模型
  手里有工具就会用，层⑦ 拦不住一个真实存在的工具。禁用面同时是两处（结构性禁工具 +
  层⑦ 说明状态），缺任一处都是那种"看起来关了其实没关"的开关。

层⑦ 从二态改成四态，分别陈述 search / fetch：**"能搜但不能打开链接"是真实状态**，
而 momo 宣告一个做不到的动作正是这一层要防的事。只有两个都关才说"完全离线"。

### 我改掉了卡 H2 的一条测试，理由写明白

卡 H2 有一条「WebFetch 永不禁用」。它锁的判断是"抓一个已知 URL 是自建搜索替代不了的
能力"——**这个能力判断仍然成立**。错的是把它写成用户改不了的默认。用户 7/27 的原话是
「关闭后 momo 再也访问不了网页」，那就必须真的关掉。能力判断没错，把它冻成用户改不了
的默认才是错的。

契约默认值故意不对称：`webSearchEnabled` 缺省 **false**（host 被告知什么都没有时，
不该把网络工具递给它），`webFetchEnabled` 缺省 **true**（它自卡 H2 起就是无条件放行，
一个还不认识这个字段的旧渲染端不该静默丢掉已有能力）。

### ② 预览区通电

删掉 `const FIXTURE_CONTENT: Record<string, string> = {}` —— 点开任何文件都落到
`?? "(内容加载中)"`，也就是**永远**在加载中。

新增 `readPreview` op，**判据在 main 侧看真实字节**，不在渲染端猜扩展名。两个理由都是
用户会立刻看到的后果：

1. PDF 是字节。`readFileSync(p, "utf8")` 对它是**有损**的 —— 解出来的串再编码回去不是
   合法 PDF，PDF.js 拿到的是垃圾。
2. 一个 400MB 的视频按 utf8 解出来，会先变成 400MB 字符串过 IPC，然后才发现没法预览。

返回**判别联合** `text | binary | unpreviewable` 而不是 `{ text, isBinary }`：
"不能预览"是一等状态，有自己要显示的理由，预览区永远不该退化成把字节当文本渲染
（02 §十九 八态齐全禁空白屏）。

细则，每条都有对应测试：

- 文本上限 2MiB，**多读 1 字节**当截断判据（不然要读完整个文件才知道有没有超）；截断
  了要明说，并丢掉切半的多字节字符。
- PDF 上限 25MiB，**超限只看 size 就拒绝、不读字节**（读了再判等于白吃一次内存峰值）。
- `.pdf` 里装 zip 会被 magic 抓出来。只信扩展名的话，症状是 PDF.js worker 里一个看不懂
  的报错。
- 二进制判据 = NUL 字节 + utf8 严格回环。**已知 GB18030 中文会落进"不能预览"**而不是
  乱码 —— 这是刻意的取舍：一句清楚的"读不了"胜过满屏锟斤拷。

**PDF 用 PDF.js + TextLayer，不用 Chromium 自带阅读器。** `<iframe src="data:application/pdf">`
零依赖也能选中文字，但选区落在**另一个 document 里**，`SelectionMenu` 的
`window.getSelection()` 永远看不到它 —— 于是 [问一下]/[翻译]（06 §2.4 小 wiki 的入口）
在 PDF 上直接失效，而 PDF 恰恰是最需要"选一段问一下"的文件类型。`PdfView` 走
`lazy()` + 动态 import：不点 PDF 就不下载这个大包，jsdom 里也不会因为顶层 import 就炸。

### ③ 成果页通电

接线点在 `wireBridgeSubscriptions` 的 `tool.finished`，且**必须在 fold 之后**。

`tool.finished` 只带 `{ toolUseId, isError, contentSummary }` —— 没有工具名、没有
input，而 `deriveArtifact` 两样都要（判 Write/Edit/可视化，取 file_path）。那两样在
`tool.started` 里，已经被 message-model 折进 timeline 的**同一条 tool item**。所以正确
取法是折完之后按 `toolUseId` 回查那条 item，而不是另存一份影子表。

`runId` 取 item 上的那个、不取 store 当前值：run 结束时 `runIds` 会被清成 null，而成果
要能说清是哪一轮产的。小 wiki 影子对话不登记（02 §九「不进主对话历史」）。

### 自己引进又抓到的两个（都补了测试）

- **`looksLikeText` 的采样假象。** 8KiB 采样切断多字节字符必然造一个尾部 U+FFFD，第一版
  把它当成"不是文本"，于是**任何超过 8KiB 的纯中文文件都会被判成二进制**。改成：采样是
  整个文件时 U+FFFD 才当真，否则先剥掉尾部再看。测试用 20000 个「汉」钉住。
- **`stats()`/快照类 API 的老账在这轮换了个形状**：`readPreview` 返回的 `size` 是**文件
  真实大小**而不是截断后的长度 —— 界面要能说"共 x MB"。

### 一个环境陷阱，值得单独记（不是代码 bug，但会被读成 bug）

实机验收第一轮：PDF 的 canvas 出来了、`.textLayer` 容器也在、**spans=0**，而且既不报错
也不结束（组件状态永远停在"正在排版…"）。

四步二分出真因：

1. node 侧用 pdfjs 抽这份 PDF 的文字 → 293 items / 3949 字 ⇒ **不是扫描件**。
2. 页面里单跑 `TextLayer`（不先画 canvas）→ resolved，**251 spans** ⇒ 我的 API 用法没错。
3. `page.getOperatorList()` → 265ms 拿到 **4330 ops** ⇒ worker 完全正常，卡的是客户端绘制。
4. 探 rAF → `visibilityState:"hidden"`、**`rafFrames:0`**。

**pdfjs 的 display 渲染靠 `requestAnimationFrame` 分块推进；窗口被完全遮挡时 Chromium
把它标 hidden 并停掉 rAF，于是 `page.render()` 永远不 resolve、也永远不报错。** 我从后台
任务起的 Electron 窗口正好是这个状态。给 `scripts/electron-dev.mjs` 加了 `LEEMO_DEBUG_FLAGS`
透传口，验收时带
`--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`，
rAF 恢复后 spans=251、选区拿得到。**教训：CDP 驱动的实机验收必须先确认 rAF 活着，否则
一切"画不出来又不报错"的结论都不可信。** `scripts/probe-raf.mjs` 留仓专测这一格。

第二个同类陷阱：审批按钮真实文案是**「允许一次」**，我的驱动找的是「允许这次」，于是
真对话一直卡在审批条上而驱动读成"模型没跑"。判据要来自真界面，不能来自我以为的界面。

### 需求覆盖表（用户 7/27 原话 → 落点 → 实机证据）

| 用户要求 | 落点 | 状态 |
|---|---|---|
| 统筹「联网功能」[开/关] | `webEnabled` + `ToggleRow` 总开关 | ✅ live 14/14 |
| 二级「联网抓取 WebFetch，关闭后 momo 再也访问不了网页」 | 真进 `disallowedTools` + 层⑦ Fetch 行 | ✅ 4 组合测试 + live |
| 二级「联网搜索 WebSearch，关闭后 momo 再也不能自主搜索」 | `chooseSearchWiring` 原路 + 层⑦ Search 行 | ✅ live |
| 统筹关 = 两个都关 | `webSearchActive`/`webFetchActive` 掩码 | ✅ live「统筹关⇒二级不可点且不勾」 |
| 统筹开 = 二级独立控制 | 两个字段互不牵连 | ✅ live「关抓取不动搜索」 |
| 每个带说明文案 | `ToggleRow` 的 note | ✅ live 三条文案全在 |
| 预览区点文件显示真内容 | `readPreview` + `preview-content` store | ✅ md/纯文本/二进制/PDF 四种实机各一次 |
| Markdown 渲染 + PDF.js TextLayer 选区（02 §九） | `react-markdown` + `PdfView` | ✅ `# `→真 `<h1>`；spans=251，`getSelection()` 拿到 `"55mm\n55mm\n330mm"` |
| 成果页有真成果 | `tool.finished` → `deriveArtifact` → `registerArtifact` | ✅ 真 deepseek 跑一轮真 Write |
| commit hash + 需求覆盖表入台账 | 本节 | ✅ `a64f055` |

### 验收证据（三层，全部可复跑）

**门 1 · 单测 + 类型 + 构建**：1385 → **1437 全绿**（+52）；`typecheck` 三段 exit 0；
`build` 干净（`pdf.worker` 独立 asset、`PdfView` 独立 lazy chunk，没混进主包）；
`build:main` 干净。

**门 2 · host 侧对真文件**（`scripts/verify-r4-preview.mjs`，真 `~/Leemo`，6/6 PASS）：

| 文件 | 判成 | 证据 |
|---|---|---|
| `笔记.md` | text | 95B，头部真内容 |
| `日志.log` | text | 井号原样，未被当 markdown |
| `数据.bin` | unpreviewable | "这是二进制文件，没法当文本预览" |
| `说明书.pdf` | binary | 2435731B，base64 解回 magic=`%PDF-`，**逐字节相同** |
| `../secret.txt` | 拒 | "路径不合法" |
| 目录 | 拒 | "这是个文件夹，不是文件" |

**门 3 · 真 Electron + CDP 驱动真界面**（`scripts/verify-r4-live.mjs`，**14/14 PASS**）：
文件树读到真 `~/Leemo`；md 渲染出真 `<h1>`；纯文本原样；二进制给理由不给空白；
PDF canvases=1 / **spans=251** / 选区可取；设置页三层开关四条语义全过（含"关掉再打开
原样回来"）。控制台零错误。

**门 3b · 真对话 → 成果页**（`scripts/verify-r4-artifacts2.mjs`，**4/4 PASS**）：
真 deepseek-v4-flash 一轮 → 真 `Write` → 审批条「允许一次」→ 文件落盘
`C:\Users\Example\Leemo\预览验收\成果验收.md` 内容 `成果页通电验收` → 成果页出现 1 张卡
`📄 成果验收.md / 预览验收/成果验收.md`，**分组在本子「预览验收」下**。绝对路径被折回
工作区相对路径、`bookId` 解析成功 —— 一物三址（回执卡/成果架/磁盘）在实机对齐。

### 明确未做 / 留给后续

- **视觉不单独目验**：按用户要求攒进 `comate/15`，与卡 D/E/F 一起看。
- **设置页仍没显示"这次搜索是谁供的货"**（卡 H3 留的口子）：`stats().byLayer` 已分三格，
  界面还没读。仍在 backlog。
- **PDF 只渲染前 30 页**（`MAX_PAGES`）：一份 800 页教材全渲染会把主线程占死几十秒。
  按需分页/虚拟滚动是独立卡。
- **GB18030 等非 utf8 中文文本**：判成"不能预览"。要支持得引编码探测，独立卡。
- 验收脚本与 fixture 都留着可复跑：`~/Leemo/预览验收/` 四个文件 +
  `scripts/verify-r4-{preview,live,artifacts2}.mjs` + `scripts/probe-raf.mjs`。

## 轮 5：electron-builder 打包（Windows 安装包）

本轮的价值不在"跑通一条命令"，而在**它抓到了一个只有打包后才会出现的白屏 bug**：
第一个安装包装好之后打开是**一个纯白窗口**，而 `readyState` 是 `complete`、
控制台**一条错误都没有**。dev 下永远看不到这个问题。

### 先做的技术抉择（循先例，理由写明白）

| 抉择 | 定法 | 为什么 |
|---|---|---|
| NSIS vs portable vs both | **只出 NSIS** | portable 会把 241MB 载荷再压一遍换来很小的价值；NSIS 本来就顺手产出 `win-unpacked/`，免安装验证用它就够 |
| 安装器形态 | `oneClick:false` + 可改安装目录 + `perMachine:false` | 装完 700MB+ 的东西，得让用户自己选盘；每用户安装不弹 UAC |
| asar | **开**，但原生件 `asarUnpack` | 见下一节 —— 这是本轮最要紧的一条 |
| 原生模块重建 | `npmRebuild: false` | better-sqlite3 v13 走 N-API，同一份 prebuild 在 Node/Electron 两处通吃；开着只会在没有 MSVC 的机器上白失败一次。实测 `.node` 确实进了 `app.asar.unpacked` |
| 打包后 DevTools | **保持关闭，不改代码** | main.ts 本来就只在 `LEEMO_RENDERER_URL` 存在时开 DevTools（=dev）。验收用打包 exe 的 `--remote-debugging-port` 参数即可，产品不必为验收开后门 |

### asar 与原生 CLI：`existsSync` 为真，`spawn` 必然失败

读 `sdk.mjs` 得到的事实（非推测）：SDK 找 CLI 的方式是
`createRequire(sdk.mjs).resolve("@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe")`
再 `existsSync`。也就是说**它解出来的路径永远相对 sdk.mjs 自己**。

打包后 sdk.mjs 在 `app.asar` 里，于是解出来是 `…/app.asar/node_modules/…/claude.exe`。
**`existsSync` 对它返回 true**（Electron 给 fs 打了 asar 补丁），可 `spawn` 必然失败 ——
操作系统的进程加载器不认识 asar，那只是一个大文件里的一段字节。症状会是
「装完能开窗、一发消息就 spawn 失败」，而 `existsSync` 为真会把人往完全错的方向带。

所以打包态由我们**显式**算出真实落地路径，经 `pathToClaudeCodeExecutable` 交给 SDK，
不赌任何"Electron 也许会帮我把 asar 路径翻译成 unpacked 路径"的未文档化行为：

- `src/main/cli-binary.ts` = 纯函数 `resolveCliBinary`，候选顺序
  `app.asar.unpacked/` → `app/`（asar 关掉时）→ `resources/`（extraResources 式）
- dev 态返回 `undefined` 且**完全不碰文件系统** —— 那时 SDK 自己解得对，抢这个活只会解错
- 找不到时**不抛错**：抛在启动阶段等于整个 App 起不来，降级成 undefined 只是让 SDK 走
  它自己那条路，那时的报错来自 SDK、说的是"CLI 找不到"，比我们在启动阶段炸掉更接近真相
- 一路 spread-on-defined 传下去（`HostDeps` → `ConversationExtras` → SDK option）：
  这个键**一旦存在** SDK 就不再自己解析，所以 dev 态必须让它真的不存在

承重测试专钉那一格：**asar 内路径 exists 为真时仍然选 unpacked 那份**。

### 本轮抓到的真 bug：`base: "/"` ⇒ 打包后纯白窗口

第一个安装包装完打开是白屏。真实 DOM：
`{"readyState":"complete","rootChildren":0,"textareas":[],"bodyText":""}`，**控制台零错误**。

根因：vite 默认 `base: "/"`，产物里写的是 `<script src="/assets/index-xxx.js">`。
而打包后渲染端是 `file://` 加载的（`loadFile(dist/index.html)`）—— `/assets/…` 在
`file:` 下解成**文件系统根**（`file:///assets/…`），JS 和 CSS 双双 404。dev 下永远
看不见，因为那时是 `http://localhost:5173/` 在供货。

修法一行：`vite.config.ts` 加 `base: "./"`。两件配套的事都做了：

1. **先用便宜探针验，再花 8 分钟打包**：`scripts/probe-file-protocol.mjs` 用 dev 的
   electron 直接以 `file://` 打开 `dist/index.html`（main.ts 在 `LEEMO_RENDERER_URL`
   缺省时走的正是这条路），40 秒给答案，而不是每次都重打一个包。
2. **把判据加进验收器**：`#root` 子节点数 + body 文本长度当一等判据（02 §十九 禁空白
   屏），另外把 CDP 的 `Log` / `Network` 域也打开 —— 这类 404 **只在网络层露头**，
   `consoleAPICalled` 里什么都没有，所以"控制台无错误"那一格当时是**通过的**。

### 我自己驱动的两个毛病（记下来，都是"判据来自我以为的界面"的变体）

- **连上 CDP 不等于界面挂好了。** page target 在 `index.html` **开始加载**时就出现，
  我在那之后约 2 秒就断言"没有输入框"。打包态冷启动要读 110MB asar、开 SQLite、跑
  loadAll，比 dev 慢。改成等界面真挂上来（最多 45s），失败时打印真实 DOM 摘要。
- **趟③ 一开始去连 CDP，而它要验的是目录有没有建。** `~/Leemo` 是 `whenReady` 里
  `setupHost` 建的，与窗口无关。CDP 超时（很可能是和前一趟刚杀掉的实例抢同一个
  userData/Chromium profile 锁）让一个跟结论无关的环节决定了成败。改成纯文件系统判据，
  并把 HOME 与 APPDATA 一起重定向，让这一趟成为真正干净的一台机器。

### 环境事实（本网络可复现，将来会再撞）

- **`npm run electron:pack` 在本网络需要 `https_proxy`**，否则挂 600s 后报
  `Timeout awaiting 'request' for 600000ms`。挂 HTTP 追踪钩子
  （`scripts/http-trace.cjs`）打出真实请求链才看清：卡的**不是** `github.com`，而是
  302 之后的资源主机 `release-assets.githubusercontent.com`。设了代理之后四个请求
  各 200~700ms 就过。（这也解释了我中途一次误判：单独探 `github.com` 上那个 URL 是通的。）
- **中途杀掉打包会留下 `%TEMP%\eb-dl-*.lock.lock`。** electron-builder 对下载件加
  `proper-lockfile`（`retries:100`、`stale:600000`），于是下一次打包**零网络活动、
  零 CPU 地干等约 10 分钟** —— 看起来和最初那个网络挂死一模一样，其实是自己造的。
  重跑前先清这个锁。
- **验收跑过之后 `win-unpacked` 会被占住**（`EBUSY: rmdir`），杀掉 `Leemo.exe` 也不
  一定立刻释放（像是 Defender 在扫刚写下的 756MB）。绕法：`--config.directories.output=`
  换一个输出目录，别和锁较劲。
- **生产 `node_modules` 会被打进 asar**，哪怕 `files:` 只列了 `dist/**` 等三项 ——
  electron-builder 自己按 `dependencies` 算树来复制。这一条是实测确认的，因为
  `build-main.mjs` 是 `packages:"external"`，运行时**确实**要从 node_modules 解析。

### 产物形状（实测）

| 件 | 大小 | 说明 |
|---|---|---|
| `Leemo Setup 0.0.1.exe` | **188.8 MB** | NSIS 安装包 = 本轮交付物 |
| 内部 7z 载荷 | 197 MB | 756MB → 197MB |
| `win-unpacked/` | 756 MB | 免安装运行/验收用 |
| `resources/app.asar` | 110 MB | dist + dist-electron + 生产依赖 |
| `app.asar.unpacked/` | — | `@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`（241MB）、`better-sqlite3`（含 8 个 prebuild `.node`）、`@napi-rs/canvas`（electron-builder 自己按 `.node` 摊开的） |

### 验收器返工了四次，四次都是"判据在骗我"（这一节比交付物本身更该留着）

第一个安装包是**白屏**（上一节那条 `base` bug）。而它头一次跑验收时，"控制台无错误"
那一格是**通过**的 —— 因为 `file://` 下的 404 只在网络层露头，`consoleAPICalled` 里
干干净净。从那儿开始，每修一版验收器就露出下一层假判据：

| # | 假判据 | 为什么骗得过 | 修法 |
|---|---|---|---|
| 1 | 连上 CDP 就断言"没有输入框" | page target 在 index.html **开始加载**时就出现；打包态冷启动要读 110MB asar + 开 SQLite，比 dev 慢 | 等界面真挂上来（≤45s），失败时打印真实 DOM 摘要 |
| 2 | 取 `kind:"assistant"` 的文本 | **这个 kind 不存在**（momo 的回复是 `{kind:"text", role:"momo"}`）⇒ 永远取到空串，于是"回复"显示为 `""`、"逐字增长"永远 false | 按 `text`+`role:"momo"` 取，并要求**回复非空**才算过 |
| 3 | 看 `conversations[0]` 有没有 `result` | `loadAll` 按 `last_activity_at DESC` 排，上一趟的旧对话早就有 result ⇒ **t+1s 就"通过"**，新消息压根没跑完 | 先想按 id 排除旧对话 —— 又栽了：持久化形状是 `{meta:{id},timeline}`（不是 `c.id`），而且 CDP 的 `returnByValue` 把 `undefined` 序列化成 **`null`**，`Set.has(undefined)` 恒 false ⇒ 判据恒真 |
| 4 | 锚"含本轮问句的那个对话" | 搭子态**复用同一个对话**，上一趟和本轮躺在同一条 timeline 里 ⇒ 按对话取 momo 文本/result，拿到的还是上一趟的 | 锚到 **runId**：store 给每次发送打 `run-${++runSeq}`，本轮折进来的每条都带同一个；问句再拼一次性口令保证唯一 |

**每一次都是"回复内容"这个旁证揭发的结论**：屏幕上写着 PASS，而回复是
`"打包好了"` —— 上一个问题的答案。判据说通过，证据说不是本轮。

第五格是"真流式"，它教的是另一件事：**测不到 ≠ 没发生，但也不能当成发生了**。
库里既看不到文本递增、也看不到 `streaming:true`，而这是**结构性的**——
`persistence/sync.ts` 是防抖落盘，且每次 store 变化都 `cancelPending?.()` 重置计时器，
所以流式期间**一次都不写库**。改去看 DOM：`.leemo-caret` 只在 `item.streaming` 为真时
渲染（TextBubble.tsx），它闪过就是用户真看见了逐字。在那之前我如实报的是 FAIL，
没有拿"应该是流式的"充数。

**教训（已进记忆）**：判据必须锚到"**这一次输入**"（本轮 runId / 一次性口令），
否则迟早在验上一轮的产物；一屏全绿完全可以是假的，值得信的是**旁证对不对得上**。

### 验收（三层，全部可复跑）

**门 1 · 单测 + 类型 + 构建**：1437 → **1455 全绿**（+18，112 files）；`typecheck`
三段 exit 0；`build` 干净；`build:main` 干净。新增测试：`tests/main/cli-binary.test.ts`
（10 格，含"asar 内 exists 为真时仍选 unpacked"）、`tests/main/packaging-config.test.ts`
（6 格，钉住 `base:"./"` + asarUnpack + nsis + productName）、`tests/host/sdk-adapter.test.ts`
两格（打包态转发 / dev 态键必须真的不存在）。

**门 2 · 打包产物实机（`scripts/verify-r5-packaged.mjs`，24/24 PASS）**：

| 判据 | 证据 |
|---|---|
| 渲染端从 `file://…/app.asar/dist/index.html` 加载 | ✅ |
| **不是空白屏** | `#root` 子节点=1，body 文本 639 字 |
| 无资源加载失败（`base` bug 的守门格） | Network/Log 域零失败 |
| rAF 活着 | frames=60 visibility=visible |
| 真出结果（原生 CLI spawn 成功） | t+2.8s **run-11**，回复 `"我是momo，你的AI搭子，陪伴编码、聊天，靠谱温暖不啰嗦。(30字)"` —— 答的是本轮问句 |
| **真流式** | `.leemo-caret`=true，界面文本递增=true |
| 原生 CLI 在 `app.asar.unpacked` | 241MB，主进程日志确认用的是这份 |
| 加密件可用（趟②：无 `.env`、`*_API_KEY` 全清） | `secrets source=encrypted`，t+2.8s **run-12** 出结果 |
| 全新 userData 零配置启动 | 不崩、建了 `leemo.db`、`secrets source=none` |
| `~/Leemo` 四件齐全 | `.claude, CLAUDE.md, Inbox, memory` |

**门 3 · 真安装包（`scripts/verify-r5-installer.mjs`，7/7 PASS）**：不能拿 win-unpacked
顶替这一格 —— 用户拿到的是安装器，而安装器还多做几件会出错的事（解 7z 载荷、摊
`app.asar.unpacked`、写快捷方式、注册卸载项）。

- 静默装到全新目录（`/S /D=`，`perMachine:false` ⇒ 不弹 UAC）：**退出码 0，耗时 11s**
- 安装结果：**159 files / 755.6 MB**；`app.asar` 105MB；原生 CLI 241MB 在
  `app.asar.unpacked` 下（安装器解包时最容易丢的就是它）
- **跑装出来的那个 App**（复用 bootstrap 趟，判据只有一处定义）：**12/12 PASS** ——
  从 `file:///…/LeemoInstall-…/resources/app.asar/dist/index.html` 加载、不空白屏
  （#root=1，823 字）、t+3.2s **run-13** 出结果、回复 `"我是momo，你的AI搭子，陪你写代码聊天，靠谱又温暖。(30字)"`、
  `.leemo-caret`=true
- 卸载：主程序被移除、安装目录清干净

### 需求覆盖表（用户 7/27 原话 → 落点 → 证据）

| 用户要求 | 落点 | 状态 |
|---|---|---|
| 产出 Windows 安装包（.exe / NSIS 或 portable） | `electron-builder.yml` win→nsis | ✅ `Leemo Setup 0.0.1.exe` **188.77MB** |
| 自验能装能跑（装到干净 userData） | `verify-r5-installer.mjs` + 趟③ `--user-data-dir` | ✅ 见门 3 / 门 2 |
| 搭子态发一句话 → 真流式 | `resolveCliBinary` → `pathToClaudeCodeExecutable` | ✅ 门 2 两处真对话，流式有 DOM 证据 |
| key 加密件在打包后仍能用（safeStorage in packaged） | `loadOrMigrateSecrets`，userData=`%APPDATA%\Leemo` | ✅ 趟② 无 `.env` 无环境变量仍解密 |
| `~/Leemo` 在打包后正确创建 | `ensureWorkspace`/`ensureMemoryBank`/`ensureSkillsPlugin` | ⚠️ **部分**：打包态确认解到并 ensure 了正确的 `~/Leemo`（四件齐全）；"**从空目录首次创建**"未在打包态实测 —— Windows 上 `app.getPath("home")` 不认环境变量（实测见 `scripts/probe-fresh-home.mjs`：三变量全改会崩 `0x80000003`；只改 USERPROFILE 则仍报真路径）。要真验得动用户真实的 `~/Leemo`，本轮没动。创建逻辑由单测覆盖 |
| 先做技术抉择并写台账 | 本节「先做的技术抉择」表 | ✅ NSIS/asar/npmRebuild/DevTools 四项各有理由 |
| 不做：首设向导 / 自动更新 / mac+linux | 未动 | ✅ `OnboardingWizard` 未改（`wizardOpen` 默认 false）；无 electron-updater；mac/linux 仍 `target: dir` |

### 明确未做 / 留给后续

- **安装包未签名**：Windows SmartScreen 会警告。要签名得先有证书（花钱，等用户拍板）。
- **图标是 Electron 默认的**：没有 Leemo 图标资源。
- **188.77MB 偏大，有重复**：`pdfjs-dist`(36MB)/`react`/`zustand` 等**纯渲染端**依赖已被
  vite 打进 `dist/`，又作为生产依赖进了 asar。把它们从 `dependencies` 挪到
  `devDependencies` 预计省 40-50MB。本轮没动 —— 现在这版是验过能跑的，别在收官时动地基。
- **自动更新未接**（`latest.yml` 已产出，但没有 publish 配置）。
- **mac / linux 未验**（仍 `target: dir`）。
- **打包依赖 VPN 代理**（本网络）：将来上 CI 得预热 electron dist 进缓存或配镜像。
- `~/Leemo/预览验收/` 里仍是轮 4 的 fixture，本轮验收顺带用到了它。

## 2026-08-02：真实 Skill 库、用户目录与 `claude-api` 收口

- 删除 40 个生成式占位模板，改为开发者打包前投放的 `bundled-skills/default-enabled`（8）和 `optional`（18）；4 个 Office Skill 继续独立离线分发，用户最终看到 30 张卡片、默认启用 12 个。
- 两个投放目录只服务产品拥有者，不成为安装后的用户目录。用户自行安装、复制或由 momo 安装的 Skill 统一落到工作区 `.leemo/skills`；旧 `.claude/skills` 无覆盖迁移，避免暴露 Claude 产品心智。
- 通用 Skill 随 `app.asar` 打包，启动后按内容哈希原子展开为单个 `leemo-library` 运行时插件；中文展示名与稳定英文触发名分离，SDK 每轮只收到用户启用集合。
- `claude-api` 已排除：它不是兼容运行时，而是把通用任务导向 Claude API 的工作流，会与当前对话模型和 Leemo 多模型路由冲突。构建门禁和打包 E2E 都明确断言其不存在。
- 构建门禁覆盖目录/触发名/展示名重复、catalog 漂移、符号链接、缓存与超大文件。当前通用库 26 个、560 个源文件、8,482,320 B，内容哈希 `9a7c08ec6ea2a3b2f841dbdeb7281a0e48bf111e12f9c4563bdffa9369902a2b`。
- 最终验证：163 个测试文件 / 2248 项全绿，typecheck 0 错，renderer/main/NSIS 构建成功，打包 Skills 用户路径 15/15；四视口分类完整换行、横向溢出 0。完整证据见 `docs/research/2026-07-31-r11-skills-verification.md`。

## 2026-08-02：浏览器自动化产品化与输入区布局收口

- 浏览器从高级 MCP 列表中拆出，设置页提供「Leemo 浏览器 / 当前 Chrome」两种身份；后者接 Microsoft Playwright 扩展与可选加密令牌，不暴露 Claude in Chrome 心智。
- 权限按浏览器能力前缀统一治理：关闭即全禁，开启后常规导航/点击/输入自动放行，上传、脚本和未知动作继续询问；momo 负责登录/验证码接管与不可逆外部动作的最终确认。
- Electron 真桥接连续三次探测均列出 42 项能力；最新一次 317ms，零模型调用。
- AskUserCard 选项整行等宽；工作台输入区最大 880px、与内容列同轴；移除输入框上方横线并增强独立阴影。桌面/窄窗横向溢出均为 0。
- 可复跑证据：`scripts/verify-browser-automation-ui.mjs`、`browser-automation-ui-facts.json` 及对应截图。NewMax 多身份/接管中心/录制工作流仍是后续，不冒充已完成。
- 最终安装包已跑通「输入 → 点击保存 → 关闭整个 MCP → 重新启动 → 同一浏览器身份恢复」；42 项工具来自 `app.asar` 内真实运行时，全程模型调用 0。截图与结构化事实为 `packaged-browser-mcp.png` / `packaged-browser-mcp-facts.json`。
- 全量验证：164 个测试文件 / 2258 项全绿，typecheck 0 错，renderer/main/NSIS 构建成功。NSIS `190,117,572 B`，SHA-256 `D7B8CD8BE539C0528060CC8DDE4247868B6B5980F72393757060AF79884D946D`；解包仍为 498 个文件 / `756,607,565 B`，`app.asar 93,589,956 B`。之后进入英语学习差异化。

## 2026-08-02：记忆撤销与设置刷新并发收口

- 撤销成功后的局部重读与设置页全量刷新共用同一请求代次；较旧响应不再覆盖较新的记忆列表，也不会污染或清除较新的错误状态。
- 新增三条反序完成回归，分别覆盖旧成功覆盖新成功、旧失败污染新成功、旧成功清除新失败；故障注入时三条均能稳定转红，恢复防护后记忆相关 27 项全绿。

## 2026-08-02：输入区附件与共享草稿语义

- 输入框与附件区内拖入文件只作为本轮附件；页面其他区域继续按工作区/本子导入。普通文本拖放不会再被页面级工作区处理器吞掉。
- 本机文件、系统截图粘贴统一进入真实附件路径。没有本地路径的剪贴板图片由主进程落为临时 PNG；编码前限制像素与单图大小，写盘异步，并按 24 小时、64 个文件和 256MB 总量回收历史会话缓存。
- 当前 Leemo 进程生成的截图使用独立磁盘前缀，定时清理不会误删仍在草稿里的图片；重启后的旧进程文件才进入历史回收范围。
- 文字、附件、发送中状态和失败提示改由搭子态/工作台共用的 composer store 管理，并按对话或工作区隔离。切模式、切空工作区以及首条发送失败后点回已创建对话，都不会把草稿藏掉或发到错误项目。
- 发送采用确认边界：新一轮被 host 接收前，上一轮失败草稿及其临时截图仍可完整回滚；接收后才释放被替代的旧截图。异步图片已落盘但附件槽位被占满时立即幂等回收，不留下孤立缓存。
- 同一对话从 host claim 开始就只有一个发送所有者；活动轮、首次恢复中的 claim 和等待 ACK 的发送都会拒绝并发第二轮，避免定时任务与用户发送互相覆盖会话句柄或 runId。
- 隔离 Electron 已真实把 Windows 剪贴板图片经 `Ctrl+V` 暂存为 PNG、显示附件 chip，并在移除 chip 后确认磁盘文件消失；搭子态 → 工作台 → 搭子态切换时草稿原样保留，桌面宽度横向溢出为 0。这里未调用模型，也未把开发态实机冒充安装包验收。
- 当前证据：聚焦 6 个测试文件、168 项通过；全量 166 个测试文件、2298 项通过，三套 typecheck、renderer build、main build 与 `git diff --check` 全部通过。最终安装包内粘贴/发送/失败重试与重启清理仍待发布验收，因此状态为 Integrated，不标 Release-verified。
