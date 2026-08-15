# r11 本地文档工具发布验收

日期：2026-08-01（在 2026-07-31 基线上续验）
结论：**PDF 读取、Word/PPTX/Excel 创建与读取，以及现有 Word 的精确文字修改副本，均已完成 Implemented / Integrated / Release-verified。** 验收使用隔离 HOME、userData、工作区与本机 loopback 模型，没有读取用户真实文件、访问外网或消耗付费模型。

## 1. 用户路径

`node scripts/cdp-document-tools-verify.mjs` 从可见输入框驱动真实打包应用，通过 9 组检查：

- 创建 `英语周报.docx`、`面试复盘.pptx`、`学习计划.xlsx`，文件真实进入 `默认工作区`。
- 用人话要求把 Word 中的“三次”精确改成“五次”，Leemo 生成同目录 `英语周报-修改版.docx`；原稿逐字节不变，副本可由同一文档工具读回。
- 预期命中 2 处但实际只有 1 处时，工具明确说明差异并停止，`英语周报-歧义失败.docx` 没有被创建。
- 通过同一个 `read_document` 工具读回 Word、PPTX、XLSX 和真实 PDF，并核对正文内容。
- 同名 Word 默认拒绝覆盖，原文件逐字节保持不变。
- 损坏 PDF 返回人话错误，不暴露内部堆栈；`../工作区外.pdf` 被工作区边界拒绝。
- 两次失败后仍能创建 `恢复.xlsx`，证明文档引擎可继续使用。
- 完全重启后，三个创建产物、Word 修改副本和失败后恢复产物都从持久化对话恢复到成果页，并显示真实的 `默认工作区/...` 路径。
- renderer 捕获错误为 0。

结构化事实与工具输入/结果：`docs/research/audit-shots/r11-document-tools-facts.json`。

## 2. 本轮发现并修复的问题

### 2.1 成果索引没有认识文档工具

文档 MCP 已能创建文件，但成果 store 只认识原生 `Write`、`Edit` 和可视化工具。现在三个创建工具使用共享精确名称表注册为文件成果；读取工具不会误生成新成果。

### 2.2 界面路径与真实落盘路径不一致

无本子时宿主把相对创建路径路由到 `默认工作区`，成果索引此前仍保存模型输入的裸路径。现在 renderer 与 host 共享 `DEFAULT_WORKSPACE_DIR`，并按对话所属本子/外部工作区解析产物路径；重启重建也使用同一规则。

### 2.3 源码测试通过，打包态 DOCX/PDF 失败

- `mammoth` 内联进 ESM 后动态 `require("fs")`，Electron 主进程无法执行。
- `pdfjs` 内联后缺少原生 Canvas 提供的 `DOMMatrix`，随后又找不到相邻的 `pdf.worker.mjs`。

DOCX 现在复用已有 ZIP + XML 引擎按段落顺序提取文本；PDF 在无浏览器矩阵时使用轻量二维兼容层，并把精简 worker 明确内联到单文件主进程。新增测试使用项目自带 Electron 直接加载构建后的文档 bundle，避免普通 Node 测试再次制造假通过。已移除无调用点的 `mammoth` 及其 10 个开发依赖，构建时原有的直接 `eval` 告警同时消失。

### 2.4 “编辑 Word”不能变成静默破坏模板

新增 `edit_word_document`，只做正文中的精确原文替换，默认另存为同目录 `原名-修改版.docx`，不覆盖源文件。调用方必须声明预期命中次数（默认 1）；数量不符、替换区间重叠、目标位于域/修订/嵌入对象，或跨超链接、书签、批注等复杂边界时，整批停止且不写文件。

引擎只改 `word/document.xml` 中命中的文字节点；解压后的其他 OOXML 部件保持逐字节不变，跨多个样式 run 的新文字继承起始 run 样式。该承诺是“已知原文的保真文字修改”，不是任意模板重排、修订模式、批注或宏编辑。

## 3. 视觉与窗口

| 状态 | 视口 | 结果 | 证据 |
|---|---:|---|---|
| 文档错误回合 | 720x640 | 输入框、发送按钮、工具摘要和最终答复完整 | `audit-shots/r11-document-error-720x640.png` |
| 成果页 | 1440x900 | 五个文档成果（含 Word 修改副本）与来源完整 | `audit-shots/r11-document-artifacts-1440x900.png` |
| 成果页 | 1280x720 | 无横向溢出 | `audit-shots/r11-document-artifacts-1280x720.png` |
| 成果页 | 1024x768 | 无横向溢出 | `audit-shots/r11-document-artifacts-1024x768.png` |
| 成果页 | 720x640 | 五个成果、预览与来源入口仍可操作 | `audit-shots/r11-document-artifacts-720x640.png` |

所有视口的文档级与主区横向溢出均为 0，输入框没有再次出现被窗口裁掉的问题。

## 4. 包体影响

续验最终包：NSIS `187,216,048 B`，SHA-256 `B748B70107F8E74054A19592D613FEC3C29F8006C334519BB236DB5CDAEC4980`；win-unpacked 315 个文件 / `744,684,022 B`，`app.asar 85,169,912 B`，主进程 bundle `5,065,167 B`。Word 修改复用既有 OOXML 依赖，没有增加解包物理文件数或新的运行时依赖目录。

## 5. 自动验证

```powershell
npx vitest run tests/host/document-engine.test.ts tests/main/document-bundle-runtime.test.ts tests/main/document-bundle.test.ts tests/bridge/document-mcp.test.ts
npm run typecheck
npm run electron:pack
node scripts/cdp-document-tools-verify.mjs
node --check scripts/cdp-document-tools-verify.mjs
```

最终全量为 158 个测试文件、2214/2214 通过，三套 TypeScript typecheck 0 错；文档引擎源码、独立 bundle、Electron 运行时与真实打包用户路径四层均通过。打包态事实文件为 9/9，renderer 捕获错误为 0。

## 6. 明确边界

- 当前创建器生成结构化的新 Word、PPTX、Excel；现有文件编辑只支持 Word 正文的精确文字替换副本，不承诺任意模板重排、格式设计、批注/修订、宏、PPTX 或 XLSX 编辑。
- PDF 当前做本地文本提取，不含 OCR、扫描件识别、批注编辑或表格视觉还原。
- 单文件读取上限为 30 MB，文本输出默认最多 50,000 字、可请求上限 100,000 字。
- 这些是可信内置本地工具；未知第三方同名 MCP 不继承免审批能力。
