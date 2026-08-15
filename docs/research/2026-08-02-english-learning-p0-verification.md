# 英语学习 P0 验收记录

> 日期：2026-08-02
> 结论：Integrated；开发态 Electron 用户路径通过，最终 NSIS 尚未复验。

## 用户路径

`npm run verify:english-learning` 使用隔离的临时 userData 和本机 OpenAI 兼容 mock，不读取真实用户数据，也不访问外部模型：

1. 在首次设置中选择“稍后配置”；
2. 从设置页可见地添加自定义 Provider，并设为默认；
3. 打开工作台“英语学习”，填写接近长度上限的目标；
4. 选择“论文阅读”和每天 20 分钟；
5. 点击“开始诊断”，创建真实 momo 对话；
6. 模型依次调用 `mcp__leemo-learning__record_mistake` 和 `record_session`；
7. 返回页面看到目标、复习项和“开始今日练习”；
8. 从“开始今日练习”创建第二个真实对话，模型先调用 `get_plan`，从回执读取第一次诊断的测评标识，再写入同型复测；
9. 返回页面核对 40 -> 80 分、`+40` 的可比较证据，并在 1440x900 与 720x640 检查横向溢出；
10. 关闭并重启 Electron，直接从 SQLite 核对画像、基线、复习队列与进步证据。

通过事实：

```text
visibleSetup = true
toolCalls = record_mistake, record_session, get_plan, record_session
loopbackRequests = 6
1440 scrollWidth/clientWidth = 1440/1440
720 scrollWidth/clientWidth = 720/720
restartRestored = true
external model calls = 0
```

## 数据与错误语义

- 基线和复测按 `(skill, assessmentKey)` 比较，并只使用最新基线之后、题数一致的复测；写入复测时若找不到对应基线或题数不同会直接拒绝记录。
- 快照向新对话提供最新可复测基线的标识、能力、题数、分数和摘要，不要求模型猜测上次用了哪套任务。
- `hasBaseline` 与累计会话数会读取并校验全部会话记录，不随最近动态截断而消失，也不会把较早的损坏记录静默计入统计。
- 复习总数先完整计算，再只截取页面需要展示的条目。
- 学习画像、复习项和练习会话在 JSON 解析或结构校验失败时抛出人话错误；原记录不删除。
- learning store 的后续读取失败不会清空上一份正常快照。
- `dailyMinutes` 在主进程边界拒绝 `NaN`、无穷值、非整数和范围外值。

## 同轮发现的共享缺陷

React StrictMode 会执行两次 store 初始化。旧实现把 Provider store 写入一个跨初始化 ref；设置页更新当前 store，而新对话默认模型解析可能读取已废弃的空 store，于是用户刚配置并设为默认的模型仍被替换为 DeepSeek。

回归测试在 StrictMode 下稳定复现。修复后默认解析器直接闭包捕获与 BridgeProvider 同批创建的 Provider store；真实 Electron 验收随后通过。

## 自动验证

```text
npm test
171 test files, 2327 tests passed

npm run typecheck
0 errors

npm run build
renderer production build passed

npm run verify:bundled-skills
26 skills, 560 files, 8,482,320 bytes
```

`npm run verify:office-bundle` 当前因用户后续手动覆盖目录产生的 Windows ACL `EPERM` 失败。这是独立发布阻塞，不影响上述隔离英语路径，但也意味着本轮不能生成并宣称新的最终安装包已验证。
