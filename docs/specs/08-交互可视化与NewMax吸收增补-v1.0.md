# 08 · 交互可视化系统 + NewMax 吸收清单（06 号设计文档增补）

> 日期：2026-07-20
> 输入：`docs/NewmaxAI逆向报告/`（产品力/四大模块/数据库-Skill-安全-智能体 三份，2026-07-20 版）
> 地位：06 号设计文档的增补章。冲突以本文为准；未提及处 06 号继续有效。
> 筛选纪律：每项吸收先过"通用性检验"（宪法 F4）与"首发防蔓延"（宪法 E6）；学习场景是首发重心但设计保持通用。

---

## 一、交互可视化系统（本增补的核心，用户拍板"对辅助学习非常非常重要"）

### 1.1 它是什么

momo 生成的 **自包含 HTML/CSS/JS 交互组件直接嵌入对话回复**——不是图片、不是代码块，是可以拖滑块、点选项、翻卡片的活组件，渲染在受控沙箱里。NewMax 已验证此路（竞品 Cursor/Copilot 均无）；对 Leemo 的学习场景这是**内容形态级**的能力：

| 学习场景用例 | 可视化形态 |
|---|---|
| 概念理解（费曼导师） | 交互概念图、可点击展开的知识层级 |
| 数理化（函数/物理模拟） | 参数滑块 + 实时曲线/动画（如调节 a,b,c 看抛物线变化） |
| 记忆（背单词/考点） | 翻转记忆卡、自测选择题（对话内直接作答判分） |
| 期末速通 | 知识框架图、进度热力格、错点分布 |
| 论文/历史 | 时间线、对比表格、引用关系图 |
| 求职（二期） | 简历 diff 视图、投递漏斗看板 |

通用性检验：删掉"学习"二字仍成立（数据展示/流程图/任意交互演示）——**通过，进主干而非 overlay**。

### 1.2 架构（照抄 NewMax 骨架，换 Leemo 皮）

```
momo 调用 create_visualization(file, html)
  → 参数校验（kebab-case 文件名 / <2MB / 无 <html><head><body> 包装 / 无外部资源）
  → 沙箱包装（注入 Leemo design token + UI Kit CSS + CSP + 主题事件监听）
  → 双落地：①消息 data.visualization 字段（对话内嵌渲染）
           ②落盘 ~/Leemo/<本子>/成果/可视化/<file>（文件即真相，一物三址：对话卡/成果架/磁盘）
  → 渲染：sandbox iframe（allow-scripts，禁 allow-same-origin 组合）嵌入消息流
```

**MCP 工具面**（进程内 createSdkMcpServer，与 web-search MCP 同层）：
- `create_visualization(file, html)` — 创建/覆盖
- `read_visualization(file)` — momo 回读修改（支持"把刚才那个图改成…"的迭代）

**硬约束**（写进工具 description 与系统提示，NewMax 验证过的规则全保留）：
禁外部网络（CDN/fetch/WebSocket/iframe）；仅内联 script/style；宽度响应式 320-736px（对话列宽）；`prefers-reduced-motion` 尊重；文件名 kebab-case 无子目录（防路径遍历）。

### 1.3 Design Token 桥接（与 06 §2.8 token 化决策直接咬合）

- Leemo 前端本就全 token 化（`--leemo-*` CSS 变量，浅色首发）。沙箱包装时把宿主 token 注入 iframe → **组件自动跟随主题**（含未来深色模式零改造——NewMax 用 40+ 个 `--ds-*` 实现同款）。
- 提供最小 **viz UI Kit**（首发精简版）：`.viz-card / .viz-metric / .viz-button / .viz-tabs / .viz-table / .viz-range` 一组语义类名 + 图表色 token。**系统提示里教 momo 用这些类名**——这是 NewMax 降低生成质量方差的关键招，照学。
- K3 试镜定稿的视觉语言（暖白/冷灰双基调）反哺 viz kit 配色。

### 1.4 分期（供拍板，见文末问题①）

| 档位 | 内容 | 工程量 |
|---|---|---|
| A 首发最小版（推荐） | MCP 两工具 + 沙箱渲染组件 + token 桥接 + 精简 UI Kit（6-8 个类名）+ 成果落盘 | Bridge 侧 ~150 行 + 前端 1 个组件 + kit CSS |
| B 终态设计基础实现 | A + 完整 UI Kit + read/迭代工作流 + 可视化专属成果架分区 | A × 2 |
| C 二期再上 | 首发只在消息 schema 预留 visualization 字段 | ~0 |

---

## 二、momo 问询卡（ask-user MCP）——行为准则 §7.1③ 的机制落地

NewMax 的 `ask_user(questions)` MCP：AI 需要澄清时弹**结构化选项卡片**而非文本反问（"点一下 vs 打字"效率差 10 倍）。这正是 momo 行为准则第③条（"需求模糊时选项式精准确认目标边界"）缺失的**执行机制**——没有这个工具，准则只是 prompt 里的愿望。

设计：进程内 MCP `ask_user`（waiters Map + IPC + 阻塞 Promise，NewMax ~80 行模式，01 号文档 §3.4 早已列为可借鉴）；前端渲染为对话内选项卡片（单选/多选 + Other 输入）；搭子态同样可用（轻样式）。**建议进首发**（问题②）。

## 三、防幻觉工具纪律（进 Bridge + momo 系统提示，零成本高价值）

NewMax 四条纪律照抄进我们的 systemPrompt append 与 Bridge 校验：
1. 文件操作必须真调工具，禁止文本里"我已写入 xxx"的表演；
2. 声称落盘的结果必须先 Read/ls 验证再汇报；
3. Bridge 侧对 momo 声称的产出路径做 existsSync 抽查（Phase 0 已实证模型会臆造路径——双重印证必要性）；
4. 联网禁用时明确告知不可联网，不得假装能搜（06 §四已有，并入同一纪律块）。

## 四、数据层采纳（并入 06 §六 store 设计）

| 采纳项 | NewMax 做法 | Leemo 落地 |
|---|---|---|
| 消息元数据 JSON 列 | `messages.data` TEXT 存 {thinking/tool_calls/attachments/visualization/token_count} | 照抄——SDK 消息结构随版本演变，JSON 列免 ALTER TABLE 迁移 |
| 金额高精度 | 成本字段用 TEXT 非 REAL | usage 表照抄（终审带走项④total_cost_usd 采集一并落这里） |
| 双日志 | tool_call_logs（工具审计）+ proxy_request_logs（API 成本审计） | usage 表拆成这两张——06 §2.6 用量统计的实现细化 |
| 分库 | 4 个 SQLite 按模块拆 | 简化为 2 个：`leemo.db`（对话/消息/本子/设置）+ `logs.db`（双日志，可独立清理） |
| KV 设置表 | settings(key,value JSON) | 照抄 |
| 对话 source 字段 | 'app'/'wechat'/... | 预留字段（值先只有 'buddy'/'workbench'——正好承载双模式 mode 标记，宪法 D2） |

## 五、UI 细节采纳（进 02 v2.0）

- **上下文圆环**：token 占用可视化（对话顶部小圆环）——比"突然压缩"友好，与我们 compaction 实测数据（~21k 触发）配合展示；
- **通知分级**：系统通知 + 应用内 toast 两级（已有铃铛设计，补系统级）；
- **消息 seq 自增排序**、自动标题 + `title_manually_updated` 保护位——store 细节照抄。

## 六、明确不学 / 后置清单（防蔓延，均记 backlog）

| 项 | 处置 | 理由 |
|---|---|---|
| Hermes 多智能体（33 表） | 不学 | CC SDK 子 agent 已覆盖首发需求；这是 NewMax 最重的资产，我们的差异化不在此 |
| 语音输入（sherpa-onnx） | backlog | 首发无语音场景刚需 |
| 浏览器 Workflow 录制回放 | backlog | 浏览器 MCP 一等公民已在 06 §3.6；录制回放是二期增值 |
| skill-guard 安全扫描 | 二期（Skills 市场前置件） | 首发只有预置 Skills，无第三方安装面 |
| IM 多渠道通知/外部渠道 | 不学（首发） | 单机产品阶段无此需求 |
| 桌面宠物/托盘小窗 | backlog | 与悬浮球同类，宪法 E6 已封 |
| 长期项目/定时任务表结构 | 记录参考 | 目标模式（backlog）实现时直接抄 projects/project_tasks/task_dependencies 三表 |

## 七、K3 前端协作工作流（试镜胜出后的流程规范）

试镜结论（用户目验拍板）：**K3 主刀前端视觉层**，Sol 让位。宪法 F1 分工修订为：**K3=前端视觉/组件卡（经 Kimi Code CLI）；GLM=自包含逻辑卡；Opus=高风险+对抗审查；本会话=设计/任务卡/验收**。执行者≠验收者不变。

工作流（主路径 = 用户点火）：
1. 我写**自包含前端卡**（试镜卡同格式：产品语境 + 文件清单 + 硬约束 + 禁改清单 + 交付格式），落 `docs/handoffs/F-xx.md`；
2. 你在目标目录开 `kimi --yolo`，一句话："读取 docs/handoffs/F-xx.md 并严格执行"；
3. K3 产出（它会自己用 Playwright 截图自检，试镜已证明）；
4. 我验收：构建/lint/共享 store 铁律检查（"新组件不得直连 IPC"）/视觉与 02 v2.0 对照，过了我整合提交。
- 边界：**K3 只做视觉与组件层**；store/reducer/IPC 逻辑仍走 TDD 卡（GLM/Opus）——防止美感换来架构漂移。
- 探索项（不阻塞）：`kimi -p` 无头模式写文件权限实验成功的话，我可直接派卡免你点火；K3 经我们 Anthropic 端点直驱（探测已通）留作后备（官方警告非验证 harness 质量波动）。

---

## 附：对既有文档的影响

- 06 §2.6 用量统计 → 本文 §四 双日志细化；06 §六 store → §四采纳项并入；06 §3.6 预置生态调研 → viz kit 与问询卡计入首发组件清单。
- 02 v2.0 规格（下一批）新增章节：可视化卡渲染规格、问询卡片规格、上下文圆环；视觉基准 = K3 试镜定稿两张 HTML（`docs/design-audition/k3/`）。
- 宪法 E1 首发范围：待问题①②拍板后更新。

---

## 拍板记录（2026-07-20，用户选项卡确认）

1. **交互可视化 = A 档首发最小版**：MCP 两工具 + 沙箱渲染 + token 桥接 + 精简 UI Kit + 成果落盘；read/迭代工作流二期。修订宪法 E1（进首发）/E6（从 backlog 移出）。
2. **momo 问询卡（ask-user MCP）进首发**：行为准则 §7.1③ 的执行机制，两态均渲染选项卡片。
3. **K3 协作主路径 = 设计负责人无头驱动**（kimi -p 实测可写文件+自检截图）：我写卡→我派 K3→我验收→用户只目验视觉；大卡/多轮迭代时用户才开 kimi --yolo 交互式盯。边界不变：K3 只做视觉与组件层，store/IPC 逻辑走 TDD 卡。
