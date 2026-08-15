# NewMax Office 实现级审计与 Leemo 路线判断

日期：2026-08-01

## 结论先行

1. NewMax 的复杂 Word / Excel / PowerPoint 能力，主体不是一个统一的“无损 Office Tool”，而是 Anthropic 的 `docx` / `xlsx` / `pptx` 文档 Skills 指挥 Claude Code 的通用 `Read` / `Edit` / `Bash` 完成。
2. NewMax 主程序另有基础能力：`mammoth` 提取 Word 文本、SheetJS `xlsx` 读写表格、`html-to-docx` 导出 Word。这些不是复杂模板编辑的主体。
3. Skills 真正执行时再组合 `docx-js`、pandas、openpyxl、PptxGenJS、Pandoc/MarkItDown、LibreOffice 和 Poppler；复杂 Office 任务的产品力来自“方法 + 代码执行 + 渲染/公式验证”的闭环。
4. Leemo 当前 Word 精确修改副本并没有走错。它把最常见且适合确定化的路径做成了原稿保护、命中数检查、失败不落盘、权限和成果索引一致的产品能力；应保留为快速可靠路径。
5. Leemo 仍明显缺少高级层：Excel 公式/格式/图表/模板修改，PPT 图片/图表/多布局/模板修改，Word 表格/图片/页眉页脚/批注/修订，以及 Office 共用渲染和验证。
6. 最佳路线不是用 Skill 替换 Tool，而是双层：常用确定性 Tool 保底，高级 Skill 调用通用文件工具和共享 Office 运行层处理长尾任务。

## 证据边界

本次只读检查：

- NewMax 1.1.5 安装目录：`E:\NewMax\NewMax AI\resources`。
- 应用依赖清单与打包主进程字符串。
- 随包 `skills/docx`、`skills/xlsx`、`skills/pptx` 的元数据、入口说明、脚本形状和许可证。
- NewMax 本地 `skill-market.json` 中三个入口的展示与文件夹映射。
- Anthropic 公开仓库的 README 和许可证。

没有修改 NewMax 文件，也没有把其 Skill 源码复制到 Leemo。

本机还保留了一条可核对的真实 Excel 用户路径：

- 会话 `C:\Users\Example\.newmax\conversations\conv-1781854744263\messages.jsonl` 记录了 NewMax 读取 `6.5.xlsx`、`6.21.xlsx`，现场生成 `openpyxl` 脚本，因桌面文件占用失败后让用户关闭文件并重跑，最后写出多份结果副本。
- 任务不是简单改一个值，而是复制单元格与样式，并逐项检查价格限制、两列相等、日期映射和时间不能跨整点等业务约束。
- `C:\Users\Example\.newmax\workspace` 仍有源表和结果表，可作为 Leemo 后续同任务对照样本；审计没有改动这些文件。
- 这条成功路径依赖本机 `C:\Python314\python.exe` 与 `openpyxl 3.1.5`。NewMax 安装目录未发现随包 Python、LibreOffice 或 Pandoc，因此它的高级能力也依赖环境探测和失败恢复，并非安装后在所有电脑上天然齐备。

Anthropic 官方仓库明确说明：四个文档 Skill 是生产能力的参考实现，但属于 source-available 而非 open source，只供演示和教育；官方同时提供 Claude Code 插件和 Claude API 预置 Skill 的使用入口：

- https://github.com/anthropics/skills
- https://github.com/anthropics/skills/blob/main/skills/docx/LICENSE.txt

## NewMax 的真实分层

### 1. 产品入口

NewMax 的办公模板入口把：

- PPT 指向 `pptx` Skill；
- Excel 指向 `xlsx` Skill；
- Word 任务由 `docx` Skill 的触发描述覆盖。

`skill-market.json` 把三者标为官方能力，分别宣称 Word 创建/编辑/修订/评论、Excel 公式/格式/分析/可视化、PPT 创建/编辑/布局/备注。

### 2. 主程序基础工具

打包主进程能确认：

- `.docx/.doc` 通过 `mammoth.extractRawText` 提取纯文本；
- `.xlsx/.xls` 通过 SheetJS `xlsx.readFile` 和 `sheet_to_csv` 提取内容；
- 部分工作簿由 SheetJS 创建；
- HTML 可经 `html-to-docx` 导出 DOCX；
- Office 文件若基础 Read 解析失败，系统提示 Agent 用 Bash 执行 Python 提取脚本。

这些能力解决快速读取和简单导出，不等同复杂已有文件编辑。

NewMax 的预览同样是只读层：Word 由 Mammoth 转 HTML，Excel 由 SheetJS 读取，PPTX 直接解析演示文稿 XML；没有找到把预览界面的修改写回原 Office 文件的路径。文件预览体验与 Agent 实际编辑能力应分别验收。

### 3. Word 高级工作流

已确认的流程：

1. Pandoc 或 OOXML 解包读取。
2. 新文档用 `docx-js` 构造页面、样式、表格、图片、页眉页脚和目录。
3. 已有文档走 DOCX 解包，Agent 用通用 Edit 修改 `word/*.xml`，再校验和重打包。
4. 修订、批注和图片需要同步维护多个 OOXML part 与 relationship。
5. LibreOffice/Poppler 将结果渲染为页面图片，再做视觉检查。

这条路径很灵活，但不是对任意文件绝对无损：Agent 仍可能改错 XML，必须依赖保守编辑、校验和目验。

### 4. Excel 高级工作流

已确认的流程：

1. pandas 负责数据探查、清洗和批量变换。
2. openpyxl 负责加载已有工作簿，以及单元格、公式、样式、行列、工作表等修改。
3. 计算结果要求写 Excel 公式，而不是把 Python 计算值硬编码进单元格。
4. 保存后用 LibreOffice 重算缓存值，并扫描 `#REF!`、`#DIV/0!`、`#VALUE!`、`#NAME?` 等错误。
5. 修改已有模板时，以原模板风格为准。

真实历史任务进一步表明，NewMax 的优势来自“先理解表结构 -> 为当前规则生成短脚本 -> 运行 -> 对业务约束逐项复核 -> 写结果副本”的循环，而不是一个包打天下的 `edit_excel` 函数。Leemo 要追的是这条闭环，同时把高频且边界明确的操作沉淀成更稳定的内置工具。

openpyxl 官方文档同时说明，它不读取所有 Excel 对象；打开并保存可能丢失不支持的 shape。因此“保留大量结构”成立，“任何 Excel 百分百无损”不成立。

### 5. PowerPoint 高级工作流

已确认的流程：

1. MarkItDown 提取文本，缩略图脚本生成全局视觉概览。
2. 新演示文稿主要由 PptxGenJS 创建，支持文本、图片、图表、表格、形状和母版。
3. 已有模板走解包、幻灯片复制/清理、内容编辑、校验和重打包。
4. LibreOffice 转 PDF，Poppler 转图片。
5. 强制至少一次“渲染 -> 独立视觉评审 -> 修复 -> 复验”循环。

这解释了 NewMax PPT 能力比“标题 + 项目符号”明显更成熟：差距首先在生成约束和视觉验收循环，不只是 UI。

## 包体与文件形状

NewMax 三个 Office Skill 的随包形状：

| Skill | 文件数 | 大小 | scripts 内文件 |
|---|---:|---:|---:|
| docx | 61 | 1,141,881 B | 59 |
| xlsx | 54 | 1,116,109 B | 52 |
| pptx | 59 | 1,154,142 B | 55 |

三份 `scripts/office` 共 153 个文件，但只有 51 份唯一内容；102 份重复，重复约 2,193,784 B。其主要原因是 OOXML schema、校验与 pack/unpack helper 在每个 Skill 内复制。

Leemo 不应照搬该物理结构。若建立高级 Office 层，应共享一个运行目录和校验器，Skill 只保留轻量说明与格式专用适配器，避免增加上百个小文件拖慢安装。

## Leemo 当前实现复核

### 已经更产品化的部分

- Word 精确文字替换是确定性函数，不依赖模型现场编写脚本。
- 默认另存 `原名-修改版.docx`，源文件不覆盖。
- 调用方声明预期命中次数；歧义、重叠或复杂结构整批失败且不写文件。
- 只修改命中的正文文字节点，其他解压后的 OOXML part 逐字节保持。
- 输出遵守工作区和 memory 治理，进入成果索引并跨重启恢复。
- `acceptEdits` 和普通权限档使用既有一致语义。

因此这部分不应删除，也不应退回“让模型自己 Bash 改 ZIP”。

### 仍不足以对齐成熟 Agent 的部分

**Word**

- 新建文档结构目前偏简单，缺表格、图片、页眉页脚、目录、丰富样式和页面布局。
- 已有文档只支持正文精确替换；没有图片替换、结构变更、批注、修订和表格编辑。
- 没有页面渲染后的视觉 QA。

**Excel**

- 当前创建器是自写最小 OOXML，只支持字符串/数字/布尔/空值和一种表头样式。
- 没有公式、数字格式、合并单元格、表格、冻结策略配置、图片、图表、数据验证和条件格式。
- 没有已有工作簿编辑，也没有公式重算与错误扫描。

**PowerPoint**

- 已使用 PptxGenJS，但 schema 只允许标题和项目符号，实际没有发挥图片、图表、表格、形状和母版能力。
- 没有模板读取/编辑，没有缩略图概览和渲染复验。
- 当前默认生成偏“占位骨架”，不应作为最终成品能力宣传。

## 推荐架构

### 第一层：确定性文件 Tools

面向高频、边界清晰的操作：读取、精确替换、单元格范围更新、创建结构化表格、按设计 schema 创建演示文稿。统一负责路径、原稿保护、原子写入、权限、成果索引和轻量回执。

### 第二层：高级 Office Skills

只提供决策流程和 QA 约束，调用 Leemo/Claude Code 已有 Read/Edit/Bash 与共享 Office runtime。复杂任务允许按任务生成短脚本，但必须输出副本并进入验证循环。

### 第三层：共享 Office runtime

一个共享目录，不在三个 Skill 内复制：

- DOCX/PPTX/XLSX 的安全 unpack/pack、关系和 XML 校验；
- 可选的 LibreOffice/系统 Office 探测、重算和渲染；
- 公式错误扫描、页面/幻灯片缩略图、内容抽取；
- 包体中按共享内容打包，避免重复 schema 小文件。

### 第四层：验证与降级

- 成功必须同时有文件存在、格式可重读和结构检查。
- 有可用渲染器时做视觉 QA；没有时明确显示“结构已验证，尚未目验渲染”，不假装无损。
- 已有复杂模板默认输出副本；发现不支持对象时先警告，但不曲解或拒绝任务，可换原始 OOXML 局部路径继续处理。

## 下一步开发顺序

### 必须现在做

1. **XLSX 高级创建与编辑副本**：这是当前成熟 Agent 心智差距最大的日常办公路径。补公式、样式、范围更新、增删行列/工作表、表格与基础图表，并建立重读和公式错误检查。
2. **PPTX 丰富创建**：扩展现有 PptxGenJS schema 到图片、图表、表格、形状、多布局和母版；每次生成必须渲染截图并目验。
3. **Word 丰富创建 + 高级编辑入口**：保留现有精确替换 Tool，补表格、图片、页眉页脚、目录；批注/修订/结构改写走高级副本流程。
4. **共享 Office QA**：统一包结构检查、重读、可选 LibreOffice/Office 渲染和失败回执。

### 有内测反馈后做

- 复杂财务模型、宏、外部数据连接和高阶图表矩阵。
- 任意 PPT 模板的完整布局复刻。
- Word 修订协作 UI 和批注可视化管理。
- 原生 Office/WPS 自动化适配器。

### 明确不现在做

- 把 Python、LibreOffice、Poppler 全量塞进安装包；先做可探测的本机能力和 JS 内置路径，再用真实失败率决定是否内置 runtime。
- 宣称所有 Office 文件绝对无损。
- 复制或重新分发 Anthropic 专有文档 Skill；可将官方 Claude 插件/API 作为 Anthropic 用户的可选原生入口，通用路径由 Leemo 独立实现。

## 2026-08-02 交付边界补充

逐文件对比和许可核对见
`docs/research/2026-08-02-newmax-vs-leemo-office-skill-diff.md`。Leemo
不会把 NewMax 或 Anthropic 的受限目录自动复制到安装包；为了解决“用户
没有 GitHub/VPN 就拿不到技能”的产品问题，安装包现在预留了
`bundled-skills/office` 离线入口。产品拥有者可以在发布前放入已经获得
分发授权的四个目录，electron-builder 会将它们带到
`resources/office-skills`，启动时无需联网即可加载。若入口为空，Leemo
仍提供确定性文档工具，并在技能页如实显示高级技能未就绪。

## 最终判断

NewMax 值得学习的不是某一个神奇函数，而是把 Claude Code 的通用执行能力、格式专用 Skill、成熟开源库和强制 QA 串在一起。Leemo 当前确定性 Tool 是正确底座，但高级工作流尚未补齐。下一张实现卡应从 XLSX 开始，同时保持共享 runtime、少文件和副本优先的约束。
