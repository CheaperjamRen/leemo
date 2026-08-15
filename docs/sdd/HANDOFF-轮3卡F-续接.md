# 交接：轮 3 卡 F 续接（Provider 多家 + 自定义 Provider）

> 新窗口开局材料。读这份 + `docs/sdd/progress.md` 尾部「轮 3 卡 F」那条即可接手，**不需要回溯上一个窗口的对话**。

## 〇、基线（已 commit，可信）

**HEAD = `151cff1`**（main，未 push）：契约加法 + 台账探针数据 + 三卡任务卡留仓（`docs/sdd/r3-f-briefs.md`）。**typecheck 三段 exit 0**。这个 commit 不含任何 F1/F2/F3 的产物，是干净地基。

⚠️ **更正（主控自己的错）**：`151cff1` 提交时**只跑了 typecheck 没跑 vitest**，实际是 **876 通过 / 1 失败** —— `tests/bridge/contract.test.ts` 里有个**手写的 channel 运行时镜像集合**，加了 5 个新 channel 必须同步它，否则 XOR 断言必挂。F1 已补齐（属测试自身漂移，非削弱断言）。
**教训写进纪律**：本仓库改 `BRIDGE_CHANNELS` 必须同步 `tests/bridge/contract.test.ts` 的镜像集合；且**报基线前必须真跑 vitest，不能只跑 typecheck**。
（注：上一份交接写的「877 全绿」在 `6ea6cf5` 时点是**准确的**，掉到 876 完全由本次契约加法引起，之前的验收无需怀疑。）

## 一、⚠ 第一件事：核实盘面（三卡当时正在写实现，未收完成通知）

上一窗口派了**三个后台执行者并行**（F1/F2/F3），窗口结束前**没有收到任何一个的完成通知**。结束时的实测盘面（`git status`）：

- `tests/host/provider-config.test.ts`（221 行，untracked）+ `tests/host/provider-catalog.test.ts`（已改）= **F1 写的测试，先 RED**
- `src/host/provider-config.ts`（untracked）、`src/host/provider-errors.ts`（untracked）、`src/host/provider-catalog.ts`（已改）= **F1/F2 正在写的实现，落盘进度未知**
- `src/host/provider-test.ts` / `provider-models.ts` / 渲染层（F3）= **当时还没出现**

**所以：这些文件极可能是半成品。** 三个 agent 随窗口关闭已被杀掉，不会再有人续写。

**先跑这三条，用结果说话，别信任何"应该已经完成"的假设：**

```
git status --short
npx vitest run
npm run typecheck
```

判读与处置：
- 基线是 **877 测试绿**（`151cff1` 时点）。
- **若 vitest 红**：大概率是 F1 的测试指向未写完的 `provider-config.ts`。两条路——(a) 照 `r3-f-briefs.md` 卡 F1 把实现补完（**测试已经写好了，接着做 GREEN 最省**）；(b) 把半成品挪走 `git stash -u` / 直接删，从 `151cff1` 干净重派。**先读一遍那 221 行测试再决定**：写得好就接着用，别浪费。
- **若某个文件只写了一半**（导出缺、函数空）：**敢删重做**，不要在坏地基上盖。
- typecheck 若报错，同理定位到具体卡。

**先跑这三条，用结果说话，别信任何"应该已经完成"的假设：**

```
git status --short
npx vitest run
npm run typecheck
```

判读：
- 基线是 **877 测试绿 / typecheck 三段 exit 0 / HEAD=6ea6cf5**（未 push）。
- 若测试数 >877 且全绿 → 三卡（或部分）已落盘，进入下面§三的收尾。
- 若有红 / typecheck 报错 → 先定位是哪张卡的文件，按§二的分工判断该修还是该重做。
- **半成品要敢删重做**，不要在坏地基上接着盖。

## 二、上一窗口已完成的部分（已 commit，可直接用）

0. **三卡任务卡已留仓 `docs/sdd/r3-f-briefs.md`** —— 含 F1/F2/F3 完整规格（文件清单、导出签名、禁改清单、每条实测依据）。**重派时让执行者读「该卡那节 + progress.md 轮 3 卡 F 条」两份**，不必重新设计。
1. **`src/bridge/contract.ts` 加法已完成且 typecheck 通过**（主控亲写，是三卡共同对齐的固定形状）：
   `ProviderSpec.configured?` / `ProviderDraft` / `ProviderConfigView` / `ProviderError(Kind)` / `ConnectionTestRequest+Result` / `ListRemoteModels*` / `RemoteModel`，以及 5 个新 invoke 通道：
   `bridge:getProviderConfig` / `saveProvider` / `deleteProvider` / `testConnection` / `listRemoteModels`。
   **类型注释里写了实测依据，动之前先读。**
2. **`docs/sdd/progress.md` 已写入「轮 3 卡 F」台账条**：6 轮探针全部数据、三条硬发现、用户三问拍板、架构裁定、派卡分工。**验收⑤（探针结果写台账）已满足**，别重跑探针。
3. **`.env` 已加** `DASHSCOPE_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL`（gitignored）。⚠ 用户在上一窗口对话里粘贴过该 key，**建议提醒用户在百炼控制台轮换**。
4. **三卡的测试路径已更正并通知到执行者**：本仓库 bridge/host/main 测试在**顶层 `tests/`**（`tests/host/` 等），渲染层测试就地放 `src/renderer/` 旁。若发现 `src/tests/` 下有残留，删掉。

## 三、剩余工作（主控自留部分，尚未开始）

按依赖顺序：

1. **`bridge-host.ts` 接 5 个新通道**（主控自留的集成缝）。依赖 F1 的 `provider-config.ts` 导出与 F2 的三个模块。
2. **catalog 要可重建**：`bridge-host` 现在吃静态 `catalog: CatalogEntry[]`（`deps.catalog`，约 5 处使用点）。`saveProvider` 必须**免重启生效** → 改成 `getCatalog()` 取值或 `{current}` ref。
3. **`balance.ts` 改按 `kind` 分派**（这是 id/kind 拆分引入的真 bug，上一窗口发现但未修）：现在 `FETCHERS[provider.id]`，而第二个 DeepSeek 实例 id 是 `deepseek-2` → **余额支持静默丢失**。做法：`BalanceProviderLike` 加可选 `kind?: string`，分派用 `kind ?? id`（向后兼容，预置 id===kind），调用点传 `entry.spec.kind`。顺带把 `qwen` 加进 `UNSUPPORTED`（无公开余额 API）。**别去改 `src/bridge/providers.ts` 的 `Provider` 类型**，用结构化 `kind` 绕开即可。
4. **建对话拦截空 key**：`configured:false` 的家 `apiKey` 恒为 `""`。`assemble()` 必须在建对话时就给人话错误，**不许空 token 送进 SDK 变上游 401**。这条要写测试。
5. **实机验收**（Electron CDP，用独立端口 + 独立 userData，参考 `scripts/electron-skills-harness.mjs` 的 5199/9333，**别占用户在跑的 :9222/:5173**）：至少验「设置页列出 4 家（1 家已配 3 家待配→或按实际）」「配一家新的→测试连接过→输入框模型面板出现该模型」「重启后配置仍在」。
6. **commit + 需求覆盖表写台账**（本项目「完成定义」＝落盘有 hash + 覆盖表，未落盘不许报收工）。

## 四、验收标准（用户原定 + 本轮扩展）

原定：①catalog 有 4 家 ②`listProviders` 返回 4 家 ③每家连通测试逻辑在（不需全跑通）④commit hash + 需求覆盖表 ⑤各家探针结果写台账（**已完成**）。

**用户 7/26 当场扩展的边界**（推翻了主控原先的收缩，已采纳，理由见台账）：**自定义 Provider 是本卡核心项**，不是下一轮。要能配任意 baseUrl / 兼容格式（anthropic 直连 or openai 走网关）/ 自定义 headers / 手敲或拉取模型 / 自定义参数。用户原话与设计要点见台账「用户对这个界面的原话」段。

## 五、待用户目验的视觉（攒着，别催）

卡 D 问询卡、搭子态历史抽屉、卡 E SkillsPage/SlashMenu/chips，**外加本轮的 Provider 设置页两栏 + 配置表单**。用户明确说过几轮任务后统一验收。目验前需**重启应用**（HMR 只更新 renderer，main 进程是旧的）。

## 六、禁改

`smoke/`（Phase 0 验收资产）；`src/bridge/pool.ts` 的 resume/降级；`src/bridge/interact.ts` 的审批策略；已冻结契约字段语义（只加可选字段）。

## 七、本项目工作纪律（新窗口必读）

见上一份交接 `docs/sdd/HANDOFF-轮3卡F-Provider多家.md` §五（实证优先于假设、执行者报告必须亲验、关键回归测试要反向验证、Tailwind 无 `@theme` 块必须用 `text-[var(--leemo-ink-2)]` 方括号写法、prompt token 两条独立预算、派 subagent 必须显式指定 model）。
