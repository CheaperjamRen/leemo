# 新窗口交接：轮 4 剩两件 —— 预览区通电 + 成果页通电

BASE = `3dff251`（main，未 push，工作树干净）。测试 **1385 全绿**，typecheck 三段 + build + build:main 干净。

## 起手式

1. 读 `CLAUDE.md`（铁律、模型分档、代理纪律）
2. 读 `docs/sdd/progress.md` **最后两节**（轮 4 卡 H2 / H3 已收官，含需求覆盖表）——
   前面的历史不必读
3. 读 `docs/specs/02-前端设计规格-v2.0.md` **§九**（预览区/成果页的视觉与交互权威）
4. 本卡不碰搜索/网关/prompt 组装，那几条线都已 CLOSED

## 本轮两件事（一起做，同一批验收）

### A. 预览区通电

现状：`PreviewPane` 的 `FIXTURE_CONTENT` 是 `{}`，点文件什么都不显示。

- `src/host/workspace.ts` **已有 `readFile` op**，接上即可（别新建通道，先确认
  `tests/bridge/contract.test.ts` 里那份手写 channel 镜像是否需要同步）
- Markdown 渲染：仓库已有 `react-markdown` 依赖
- PDF：按 02 §九 要 PDF.js 的 **TextLayer 选区**（能选中文本，不是图片）
- 二进制/超大文件要有明确的"不预览"态，别静默空白

### B. 成果页通电

现状：`ArtifactsPage` 的 store 有 `registerArtifact`，但**生产代码从来不调用它** ——
成果页永远是空的。

- 接线点：`tool.finished` 时 `deriveArtifact` + `registerArtifact`
- 先查清 `deriveArtifact` 现在在哪、判据是什么（哪些工具产出算"成果"）

## 验收标准

1. 预览区点文件显示**真内容**（md / pdf / 纯文本 / 二进制各一次目验）
2. 成果页有**真成果**（跑一轮真对话让它产出文件，成果页出现条目）
3. 全套测试绿 + typecheck 三段 exit 0
4. **commit hash + 需求覆盖表**入 `docs/sdd/progress.md`
5. 视觉不单独目验，攒进 `comate/15` 与卡 D/E/F 一起看

## 铁律提醒（本项目踩过的）

- **测试+typecheck 一绿就 commit 给 hash，不问、不先写总结**
- TDD 边界：store/reducer 要测试；纯视觉层用户目验
- 只 `git add` 本卡文件（仓库长期有 `.kimi/` `comate/` `openspec/` 等未跟踪件）
- 测试必须落 `tests/**`（node）或 `src/renderer/**`（renderer）；`src/tests/` 下永不执行
- Tailwind v4 **没有 `@theme` 块**：`text-ink-2` 这类类名静默不生成 CSS，必须写
  `text-[var(--leemo-ink-2)]` 方括号形式
- PowerShell 是主力，中文日志先 `chcp 65001`
- 国内厂商端点一律直连不走代理

## 队列里还有一张小卡（可本轮顺手，也可单独立）

**设置页搜索开关改三层**（用户已拍板的设计）：统筹「联网功能」+ 二级「联网抓取
WebFetch」+ 二级「联网搜索 WebSearch」，每个带说明文案。统筹关 = 两个都关；统筹开 =
二级独立控制。

现状：只有一个 `webSearchEnabled`；WebFetch 目前**无条件放行**（不受开关约束）。
相关代码在 `src/renderer/stores/settings.ts` + `SearchSourcesSection` +
`src/host/bridge-host.ts` 的 `chooseSearchWiring` 三态。

顺带可做（H3 留下的口子）：设置页显示**这次搜索是谁供的货** —— shim 的
`stats().byLayer` 已经分了 passthrough/vendor/external 三格，界面上可以说清
"DeepSeek 自带搜索 / GLM 搜索 API / 外部源"，让额度花在哪不是黑箱。

## 已 CLOSED、别重开

- 轮 4 卡 H/H2/H3：联网搜索。三层降级链（① 透传厂商端点 → ② 这家自己的搜索 API →
  ③ AnySearch/Tavily），**绝不跨 provider 借额度**（用户 7/27 拍板，已做成类型级约束）。
  DeepSeek/Kimi 走①、GLM 走②、通义只能走③。live 4/4 PASS。
  探针台账 `docs/sdd/probe-r4-h-search.md` §⑨。
- WebFetch 的 claude.ai 预检已用 `skipWebFetchPreflight` 关掉，全程本地抓取。

## 未做 / 留给用户拍

- **openai 家（走网关）的原生搜索**：网关剥服务端工具，那些家仍走自建 MCP。独立卡。
- 秘塔未接（无文档无 key）；官方 Anthropic 端点未验（无 key）。
- 通义若将来上线 `search_info`，改 `provider-catalog.ts` 一处即可，判定逻辑不动。
