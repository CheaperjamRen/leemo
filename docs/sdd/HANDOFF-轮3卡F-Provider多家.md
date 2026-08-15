# 交接：轮 3 卡 F — Provider 多家 catalog 扩展

> 这份文件是**新窗口的开局材料**。主控（新窗口）读完这份 + `docs/sdd/progress.md` 尾部即可接手，不需要回溯上一个窗口的对话。

## 一、当前状态（已核实，2026-07-26）

- **HEAD = `5d73d82`**（main，**未 push**）。工作区干净（`git status` 无非 untracked 变更）。
- **877 测试全绿**（`npx vitest run`），`npm run typecheck` 三段 exit 0。
- 轮 2 已全部完成并核验：卡 A（momo 人格）、卡 B（记忆库初始化）、卡 C（重启续聊）、卡 D（问询卡进对话流）、搭子态历史抽屉、卡 E（Skills 触发）。
- **用户攒着三批待目验**（用户明确说"过几轮任务再统一验收"，不要催）：卡 D 问询卡视觉、搭子态历史抽屉、卡 E 的 SkillsPage/SlashMenu/chips。目验前需重启应用（HMR 只更新 renderer，main 进程是旧的）。

## 二、本卡任务（用户原话已转达的边界）

轮 3 入学第一件：**Provider 多家 catalog 扩展**。纯逻辑，视觉攒着。

**做**：
1. `src/host/provider-catalog.ts` 扩展加 GLM / Kimi / 通义（各家 baseUrl + env key 名 + 精选 model 列表 + modelCapabilities）
2. `bridge:listProviders` 返回多家（含"已配 key"状态）
3. 连通测试逻辑（每家真小请求，错误人话化 — 循 06 §3.5）
4. 设置页 Provider 选择逻辑绑真 store（UI 视觉攒着）

**不做**：自定义 Provider UI、首设向导视觉、costSource 错算修（comate/03 R3，Phase-1）、网关接线（四家全 anthropic 直连不需网关）。

**验收（Comate 核验）**：①catalog 有 4 家 ②listProviders 返回 4 家 ③每家连通测试逻辑在（不需全跑通，逻辑对即可）④commit hash + 需求覆盖表 ⑤各家探针结果写台账。

## 三、⚠ 先做技术抉择再实现（这是本项目的铁律，卡 A/卡 E 都吃过教训）

用户明确要求循卡 E 先例：**先探针实证，再扩 catalog，台账写明各家探针结果。**

### 主控已经查清的部分（直接用，不必重查）

**现有 DeepSeek 实现**（`src/host/provider-catalog.ts`，全文很短，先读一遍）：
- `buildCatalog(env)` 读 `env.DEEPSEEK_API_KEY`，**没 key 就返回空数组 `[]`**
- 每家产出一个 `CatalogEntry { provider, spec, balanceBaseUrl? }`
- `Provider`（`src/bridge/providers.ts`）含**真 apiKey**，进程内；`ProviderSpec`（`src/bridge/contract.ts:174`）是**无 key 的 IPC 投影**。这条边界是宪法级的，扩展时**绝不能让 apiKey 进 ProviderSpec**。
- `bridge:listProviders` 实现就一行：`catalog.map(e => e.spec)`（`bridge-host.ts:277`）

**Phase 0 已验过的端点**（`smoke/providers.mjs`，Phase 0 验收资产，**禁改**）：
| 家 | baseUrl | key env | model env |
|---|---|---|---|
| deepseek | `https://api.deepseek.com/anthropic` | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` |
| glm | `https://open.bigmodel.cn/api/anthropic` | `GLM_API_KEY` | `GLM_MODEL` |
| kimi | `https://api.moonshot.cn/anthropic` | `KIMI_API_KEY` | `KIMI_MODEL` |

→ **DeepSeek/GLM/Kimi 三家的 anthropic 端点形态一致**（都是 `<host>/anthropic`），且 Phase 0 真跑过。GLM 与 Kimi 的 key **已在 `.env` 里**。

**通义是唯一的未知**，两个问题都要先解决：
1. **`.env` 里没有任何通义 key**（已 grep 确认：无 `QWEN`/`DASHSCOPE`/`BAILIAN`/`TONGYI`）。
2. 端点形态**与前三家不同**。逆向报告 `docs/NewmaxAI逆向报告/NewMax-预置Provider与模型接入全量整理.md:78,190` 记的是：
   - anthropic 端点：`coding.dashscope.aliyuncs.com/apps/anthropic`（注意是 `/apps/anthropic`，不是 `/anthropic`）
   - 对应产品叫「百炼 Coding Plan」（`bailian`），模型 `qwen3-coder-plus`
   - 这是**二手资料，未经本项目实证**。

### 需要新窗口做的抉择

- **通义端点是否真可用** —— 没 key 就跑不了探针。**先问用户要不要配 `.env` 的通义 key**；用户不想配就**按"已知形态先落 catalog、标记未验证"处理，并在台账写明"未实证"**，绝不能在台账里写成"已验"。
- **key 缺失时的 catalog 语义** —— 现在是"没 key 就整个返回 `[]`"。四家之后必须改成**逐家判断**：配了 key 的进 catalog，没配的怎么办？两条路（这是**设计决策，建议问用户**）：
  - (a) 没 key 的家**不进 catalog**（listProviders 只返回可用的）——设置页就看不到"还能配哪些家"，首设引导会缺一半。
  - (b) 没 key 的家**也进 catalog 但带 `configured: false`**（`ProviderSpec` 加可选字段），设置页能列出全部四家、灰显未配的、点进去引导配 key。
  - 用户的验收②写的是"listProviders 返回 4 家"，字面看倾向 (b)，但要跟用户确认，因为 (b) 需要给 `ProviderSpec` 加字段（循 Batch -1「只加可选字段」纪律）。
  - ⚠ 注意 `assemble()` 里 `catalog.find(e => e.provider.id === r.providerId)` 找不到就抛 `unknown provider`。若走 (b)，未配 key 的家进了 catalog 但 `provider.apiKey` 是空的 —— **必须在建对话时就明确拒绝并给人话错误**，不能让空 key 一路送进 SDK 变成上游 401。这条要写测试。

- **连通测试的"人话化"** —— 06 §3.5 是依据。至少要区分：key 错/无权限（401/403）、余额不足、模型名不存在（404）、网络不通/超时、区域限制。**测试要用注入的假 fetch 覆盖每一类**，不要依赖真网络（真请求只在实机探针里跑）。

## 四、派卡建议（沿用本项目已验证的分档）

- 这张卡**动契约（可能加 `ProviderSpec` 字段）+ 连通测试逻辑 + 设置页 store**，属中高风险 → 建议 **Opus 4.8** 执行，或主控自做 catalog 扩展 + 派 Sonnet 做设置页绑定。
- **严格 TDD**（host/bridge/store 是铁律要求的严格 TDD 面）。
- 派卡前先按 §三 做完探针与两个抉择，把结论写进任务卡再派 —— **不要把未决问题丢给执行者**（卡 E 的做法：主控先跑四轮探针定方案，执行者只实现，效果很好）。

## 五、本项目的工作纪律（新窗口必读，都是踩过坑总结的）

1. **实证优先于假设**。卡 A 假设 `settingSources` 能指向路径（实际是闭合联合）踩坑；卡 E 靠四轮探针发现 `settingSources:[]` 会静默关掉 Skills。凡涉及 SDK 行为，先写小探针实测，探针用完删掉、数据写台账。
2. **执行者报告必须亲验，不采信**。已有两次执行者推翻主控写死的规格且推翻得对（卡 C 的 resume 降级形状）；也有测试"两边都通过"没有辨别力的风险 —— 关键回归测试要**反向验证**（临时把 bug 放回去，确认测试真的失败，再修回）。
3. **不要 `git commit`（执行者）**。执行者改完报告，主控复核后统一提交。
4. **前端视觉由用户目验**，逻辑要抽纯函数并测。
5. **Tailwind 陷阱**：本仓库没有 `@theme` 块，`text-ink-2`/`border-line-2`/`bg-card` 这类裸色名类名**静默不生成 CSS**。必须用 `text-[var(--leemo-ink-2)]` 方括号写法。（记忆 `tailwind-v4-no-theme-block`）
6. **prompt token 预算**：我们写的层 ≤900（现 810），种子记忆模板 ≤150（现 74）。两条是独立的，别再把它们混成一条。
7. **用户在跑自己的 electron 实例**（占 :9222/:5173）。要起实例做实机验收请用独立端口 + 独立 userData（参考 `scripts/electron-skills-harness.mjs` 用的 5199/9333）。
8. 台账 = `docs/sdd/progress.md`，**追加**不覆盖，每卡写明 commit hash、抉择理由、遗留洞。

## 六、禁改

`smoke/`（Phase 0 验收资产）；`src/bridge/pool.ts` 的 resume/降级逻辑；`src/bridge/interact.ts` 的审批策略；已冻结的契约字段语义（只加可选字段）。
