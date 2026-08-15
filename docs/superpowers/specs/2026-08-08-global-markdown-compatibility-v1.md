# Leemo 全局 Markdown 兼容规范 v1.0

> 日期：2026-08-08<br>
> 状态：内测前必做；视觉总重构后实施<br>
> 当前基线：聊天与预览已使用 `react-markdown + remark-gfm`；尚未接入数学公式、脚注、提示块与 Mermaid 的统一支持。

## 产品目标

用户不应记住“这段 Markdown 发在聊天、便签还是文件预览里”。同一段内容在 Leemo 的聊天正文、过程摘要、Markdown 文件预览与便签中应保持同一种语义；编辑器可以渐进披露，但保存和复制必须无损保留源码。

## 内测前必须支持

1. **CommonMark 基础**：六级标题、段落、粗体、斜体、删除线、分隔线、转义、软硬换行、引用、嵌套有序与无序列表；
2. **GFM 常用扩展**：表格与对齐、自动链接、任务清单；聊天和文件预览只读，便签中的任务清单可直接勾选；
3. **代码**：行内代码、围栏代码块、语言标识、语法高亮、复制按钮与窄窗口横向滚动；
4. **链接与媒体**：行内 / 引用式链接、远程与本地图片、替代文本；网页链接和本地文件路径继续使用各自明确的打开方式；
5. **数学公式**：`$...$` 行内公式与 `$$...$$` 块级公式，使用共享的 KaTeX 风格渲染并保留原始 LaTeX；
6. **脚注**：`[^1]` 引用与文末定义，满足论文阅读、学习笔记和来源补充；
7. **提示块**：兼容 `> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]`，作为强调信息而不是普通引用；
8. **Mermaid**：将 `````mermaid`` 围栏代码块渲染为流程图、时序图等；渲染失败时保留原始源码和清楚错误，不吞内容；
9. **YAML frontmatter**：Markdown 文件读取、编辑和保存时原样保留；预览可折叠为紧凑元数据，不把它当正文大段展示。

## 一致性与降级

- 所有只读场景复用一个共享渲染入口与同一套排版 token，避免聊天、便签和文件各自实现一套；
- 便签富文本工具栏只露出高频格式，但粘贴、打开和再次保存不能丢失数学公式、脚注、提示块、Mermaid 或 frontmatter；暂时没有可视化编辑控件的语法允许用源码块编辑；
- 表格在窄窗口横向滚动；超长单词、URL、代码和公式不能撑破容器；图片按容器缩放并允许查看原图；
- 原始 HTML 默认作为文本处理，不以 `dangerouslySetInnerHTML` 作为常规兼容路径；不为追求“全格式”引入 MDX 执行能力；
- 不支持的扩展必须显示可复制源码，不得静默消失或变成空白。

## 内测后再评估

- 折叠块、定义列表、上下标快捷语法；
- GeoJSON、TopoJSON、STL 等专用围栏渲染；
- 所见即所得的公式与 Mermaid 图形化编辑；
- MDX、可执行代码块和第三方嵌入。

## 最小验收

使用一份包含以上九类语法的固定 Markdown 样例，分别经过聊天、过程摘要、文件预览、便签打开编辑再保存四条路径；确认视觉一致、源码往返不丢失、窄窗不横向撑破，并对无效公式和无效 Mermaid 验证源码降级。

## 调研依据

- CommonMark：<https://spec.commonmark.org/current/>
- GitHub Flavored Markdown：<https://github.github.com/gfm/>
- GitHub 基础与高级格式：<https://docs.github.com/en/get-started/writing-on-github>
- `react-markdown` 官方说明：<https://github.com/remarkjs/react-markdown>
- `remark-math / rehype-katex` 官方说明：<https://github.com/remarkjs/remark-math>
