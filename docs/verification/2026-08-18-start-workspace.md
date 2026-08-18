# Start 静态工作区与本地文档库验收记录

## 范围与权威

- 验收对象：顶层“开始”表面、首页 / Todo / 文档库，以及文档树、附件、引用、归档、回收站和关联 Todo 主链路。
- 视觉权威：`docs/design-audition/visual-redesign/start-static-workspace/design.md`。
- 产品边界：普通查看、编辑、整理与管理均为静态工具行为，不调用模型；只有用户显式触发的 AI 行为才可进入搭子或工作台。
- 编辑心智：默认“编辑”为所见即所得；“源码”是显式逃生舱。富文本与源码写回同一份 Markdown，不建立第二真源。

## 自动化与静态验证

2026-08-19 收口时已通过：

- `CaptureEditor / MarkdownEditor / StartDocumentsView / App / capture-persistence` 聚焦测试：5 files / 61 tests。
- 前一轮完整 Start 聚焦矩阵：6 files / 74 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留 Vite 已知大 chunk 提示。
- `npm run build:main`：通过。

## 真实 Electron 旅程

`node scripts/verify-start-workspace.mjs` 使用独立临时用户目录启动生产构建，并通过同一次旅程验证：

- 创建与编辑文档；默认富文本不暴露标题、链接、callout、公式、代码和表格的 Markdown 标记。
- 阅读 / 编辑 / 源码三种模式指向同一份 Markdown；源码模式可直接编辑并保存。
- 标题、粗体、斜体、列表、任务清单、引用、链接、高亮、callout、行内 / 块级数学公式、代码块、Mermaid 与 GFM 表格可渲染或编辑。
- 表格支持直接编辑表头 / 单元格、增删行列和切换对齐方式。
- 父子文档拖放、本地引用、反向引用、从便签创建关联 Todo。
- 外部附件引用与复制入库两种语义保持独立。
- 父文档连同子文档归档、移入回收站、恢复；重启后树、附件和数据仍在。
- 全程模型调用数为 0，renderer console error 为 0。

最新事实：

- `zeroModelCalls: true`
- `restartRecovered: true`
- `treeRecovered: true`
- `attachmentsRecovered: true`
- `linkedTodoCreated: true`
- `richMarkdownObjects: true`
- `sourceModeSwitch: true`
- 1440×900：工作面 1120px、Explorer 248px、编辑正文 1033px，无水平溢出。
- 960×680：工作面约 721px、Explorer 224px、编辑正文约 665px，无水平溢出。

## 截图证据

- `.tmp-visual-audit/start-note-library/start-documents-1440x900.png`
- `.tmp-visual-audit/start-note-library/start-documents-objects-1440x900.png`
- `.tmp-visual-audit/start-note-library/start-documents-source-1440x900.png`
- `.tmp-visual-audit/start-note-library/start-documents-960x680.png`

## 视觉审计与修复

Kimi K3 Max 首轮只读审计给出 84/100，确认主体规格与对象编辑成立，同时指出三个有截图证据的缺口：

1. 长文滚动后格式栏不可达。
2. Markdown 源码模式存在内外双滚动条。
3. 任务清单圆点容易误读为单选框。

三项均已以小范围 CSS 修复，并写入真实 Electron 视觉契约：

- 工具栏 `position: sticky`，滚动 320px 后仍贴合编辑视口顶部。
- 源码 textarea 交由内容撑高，`overflow-y: hidden`，只保留文档外层滚动。
- 未完成项为 4px 圆角方框，完成项显示明确的 `✓`。

修后 Electron 事实：

```json
{
  "toolbarPosition": "sticky",
  "toolbarPinned": true,
  "uncheckedRadius": "4px",
  "checkedContent": "\"✓\"",
  "overflowY": "hidden",
  "hasInnerScroll": false
}
```

Kimi K3 Max 使用覆盖后的同路径截图复评为 **91/100、无 P1、READY**；确认三项缺口闭环，且 960px 和整屏平衡没有新退化。

唯一一轮独立视觉 / UX 审计复评为 **92/100、无 P1、READY**。审计确认整体比例、字体层级、对象呈现、固定格式栏、单滚动与 960px 降级均进入成熟产品档。两个非阻断 P2 保留为后续精修：

- 公式与 Mermaid 已可渲染并通过源码编辑，后续可增加富文本内联源码编辑器。
- 表格已可编辑内容、增删行列和改变整体对齐，后续可让操作精确作用于当前单元格 / 行 / 列，并支持末格 Tab 新增行。

这两项不阻断当前本地云文档主链路，也不在发布前临时引入新的复杂编辑框架。打包产物将在发布收口后补记。
