# R11 本地文档工具实施计划

> **执行要求：** 按 `superpowers:executing-plans` 逐任务实施；每个行为先写失败测试并确认失败原因，再写最小实现。文档能力是后续 Skills 的真实工具依赖，必须先完成。

**目标：** 为 momo 提供受工作区边界和权限策略治理的本地文档工具：读取 PDF/DOCX/PPTX/XLSX，并新建 DOCX/PPTX/XLSX。第一版只承诺已验证的文本提取和结构化新建，不宣称复杂原地编辑、像素级模板复刻或视频/扫描件 OCR。

**架构：** 新增一个进程内 `leemo-documents` MCP。所有路径先由 host 解析到当前工作区，再经过现有 `canUseTool` 文件边界；读取工具属于可信只读能力，创建工具属于编辑能力，`acceptEdits` 可直接执行，其余模式沿用现有审批。解析/生成引擎使用成熟的结构化库，并在构建阶段预打包进 `dist-electron/main.mjs`，不把新增 devDependencies 的小文件复制进安装包。每次写入先生成内存 Buffer，再以同目录临时文件 + rename 原子落盘；默认拒绝覆盖已有文件。

**技术栈：** TypeScript 5.9、Claude Agent SDK 进程内 MCP、Zod、PDF.js、Mammoth、PptxGenJS、docx、fflate、fast-xml-parser、Vitest、esbuild。

## 全局约束

- 产品边界以 `docs/superpowers/specs/2026-07-31-r11-beta-foundation-design.md` 第六、九、十节为准。
- 文档工具不得读写当前工作区边界外路径，不得写 `.leemo/memory`；路径错误必须在执行前以人话拒绝。
- 读取上限固定为 30 MiB；提取文本默认 50,000 字符、最大 100,000 字符，并显式返回是否截断。
- 创建接口对标题、段落、幻灯片、工作表、行列和总单元格数设上限，避免一次模型调用耗尽内存。
- 默认 `overwrite=false`。已有文件不得被静默替换；允许覆盖时仍用原子替换。
- 工具结果只返回格式、摘要、数量、截断状态和目标路径，不回传整份二进制或 base64。
- 新依赖只放 `devDependencies` 并由 esbuild 预打包；electron-builder 的生产依赖树不得因此增加数百个文件。
- 每项行为先红后绿；每个任务提交前运行定向测试和 `git diff --check`。

---

## Task 1：固定文档引擎契约、限制与错误语义

**Files:**

- Create: `src/host/document-engine.ts`
- Create: `tests/host/document-engine.test.ts`
- Create: `tests/fixtures/documents/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `DocumentKind = "pdf" | "docx" | "pptx" | "xlsx"`
- Produces: `ReadDocumentOptions { maxChars?: number }`
- Produces: `DocumentReadResult { kind; text; truncated; bytes; pages?; slides?; sheets? }`
- Produces: `DocxDraft`, `PptxDraft`, `XlsxDraft`
- Produces: `readDocumentBuffer/readDocumentFile/createDocxBuffer/createPptxBuffer/createXlsxBuffer`

- [x] **Step 1：写失败测试固定格式识别和安全上限**

  覆盖扩展名大小写、未知格式、空文件、超过 30 MiB、`maxChars` 越界、损坏 ZIP、加密/无法解析文档，以及错误文本不得带 Buffer、堆栈或内部包名。

- [x] **Step 2：运行测试确认红灯**

  ```powershell
  npx vitest run tests/host/document-engine.test.ts
  ```

  Expected: 模块不存在或导出缺失。

- [x] **Step 3：安装并锁定构建期依赖**

  ```powershell
  npm install --save-dev mammoth docx pptxgenjs fflate fast-xml-parser
  ```

  检查许可证和 Node 22 兼容性；不得把它们移入 `dependencies`。

- [x] **Step 4：实现统一错误类型与输入限制**

  用 `DocumentToolError(code, userMessage)` 区分 `unsupported/too_large/corrupt/encrypted/invalid_input/existing_file/io`；只让 `userMessage` 进入模型工具结果。

- [x] **Step 5：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/document-engine.test.ts
  git diff --check
  git add package.json package-lock.json src/host/document-engine.ts tests/host/document-engine.test.ts tests/fixtures/documents/README.md
  git commit -m "feat(r11): define local document engine"
  ```

## Task 2：实现 PDF/DOCX/PPTX/XLSX 读取

**Files:**

- Modify: `src/host/document-engine.ts`
- Modify: `tests/host/document-engine.test.ts`
- Modify: `tests/fixtures/documents/README.md`

**Interfaces:**

- Consumes: Task 1 limits/error contract
- Produces: bounded plain-text projection for the four formats

- [x] **Step 1：生成最小真实 fixture 并写失败测试**

  测试运行时确定性生成最小真实 fixture（不向仓库增加四个二进制文件）。Fixture 含中文、英文、空段落、表格/项目符号；测试断言 PDF 页序、DOCX 段落与表格、PPTX 幻灯片顺序、XLSX 工作表与单元格顺序，不以扩展名假装解析成功。

- [x] **Step 2：实现 PDF 与 DOCX 提取**

  PDF 使用 `pdfjs-dist/legacy/build/pdf.mjs` 逐页取 text content；DOCX 使用 Mammoth 的 raw text 路径。提取后统一空白、保留页/节边界并在上限处截断。

- [x] **Step 3：实现 PPTX 与 XLSX 提取**

  PPTX 用 fflate 解包、fast-xml-parser 解析 `ppt/slides/slideN.xml`，按数字顺序提取 `a:t`；XLSX 用同一套 ZIP/XML 结构读取 workbook、relationships、shared strings 与 cell value。所有解析失败转成统一人话错误。

- [x] **Step 4：写失败恢复测试**

  覆盖损坏 PDF、损坏 OOXML、空文档、公式无缓存值、超长文本截断，以及一次失败后下一份正常文件仍可读取。

- [x] **Step 5：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/document-engine.test.ts
  git diff --check
  git add src/host/document-engine.ts tests/host/document-engine.test.ts tests/fixtures/documents
  git commit -m "feat(r11): extract local office documents"
  ```

## Task 3：实现 DOCX/PPTX/XLSX 结构化新建与原子落盘

**Files:**

- Modify: `src/host/document-engine.ts`
- Modify: `tests/host/document-engine.test.ts`

**Interfaces:**

- Produces: `writeDocumentAtomically(path, buffer, { overwrite })`
- Produces: plain report/slide deck/workbook generation

- [x] **Step 1：写三个失败往返测试**

  创建 Word 报告、16:9 演示文稿、含多工作表的表格，再用 Task 2 读取回去；断言标题、顺序、中文、数字和布尔值不丢。

- [x] **Step 2：实现 Word 报告**

  使用 `docx` 创建标题、一级/二级章节、段落和项目符号；只提供稳定的系统字体和基础间距，不承诺复杂模板。

- [x] **Step 3：实现演示文稿与表格**

  PptxGenJS 固定 16:9、标题页和内容页安全边距，长要点自动拆分或拒绝超限；XLSX 使用受限 OOXML builder 创建表头、冻结首行、基础列宽和多工作表，并由读取器做往返验证。

- [x] **Step 4：实现原子写与覆盖语义**

  先在同目录写唯一临时文件，成功后 rename；失败清理临时文件。默认目标存在即拒绝；`overwrite=true` 才替换。测试模拟生成失败、写失败、rename 失败，原文件必须保持不变。

- [x] **Step 5：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/document-engine.test.ts
  git diff --check
  git add src/host/document-engine.ts tests/host/document-engine.test.ts
  git commit -m "feat(r11): create office documents locally"
  ```

## Task 4：接入受治理的文档 MCP 与权限代理

**Files:**

- Create: `src/bridge/document-mcp.ts`
- Create: `tests/bridge/document-mcp.test.ts`
- Modify: `src/bridge/interact.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `tests/bridge/interact.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/momo-prompt.test.ts`

**Interfaces:**

- Produces: `LEEMO_DOCUMENT_TOOL_NAMES`
- Produces tools: `read_document`, `create_word_document`, `create_presentation`, `create_spreadsheet`
- Consumes current conversation cwd/workspace and root-artifact routing

- [x] **Step 1：写 MCP schema 和返回语义的失败测试**

  读取工具只接受路径与字符上限；三个创建工具各用结构化 schema，限制数组和总单元格。成功回执含文件名/路径/数量；失败只含可行动的人话。

- [x] **Step 2：写权限和路径治理失败测试**

  断言读取在工作区内免重复授权；创建在 `acceptEdits` 免卡、`default` 询问；关闭/绕过权限也不能越过文件边界；全局根目录的新产物自动路由到“默认工作区”；`.leemo/memory` 永远拒绝。

- [x] **Step 3：实现文档 MCP**

  每个会话创建一次 server，handler 使用 host 注入的 `resolveReadPath/resolveWritePath`，自身再次验证边界。创建工具完成后返回准确的实际落盘路径。

- [x] **Step 4：注册可信工具语义**

  在单一 capability registry 中把 `read_document` 标成可信只读；把三个创建工具加入编辑风险组和文件路径字段，不用 MCP 名前缀模糊匹配。将 server 无条件注册到会话能力，但不在用户文案暴露 Claude Code。

- [x] **Step 5：更新 momo 能力说明**

  只说“可读取 PDF/Word/演示文稿/表格，可新建 Word/演示文稿/表格”；明确复杂原地编辑暂不保证。不得提示模型临时安装库。

- [x] **Step 6：运行定向测试并提交**

  ```powershell
  npx vitest run tests/bridge/document-mcp.test.ts tests/bridge/interact.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  git diff --check
  git add src/bridge/document-mcp.ts src/bridge/interact.ts src/host/bridge-host.ts src/host/momo-prompt.ts tests/bridge/document-mcp.test.ts tests/bridge/interact.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  git commit -m "feat(r11): wire governed document tools"
  ```

## Task 5：把文档依赖打进单文件主进程产物

**Files:**

- Modify: `scripts/build-main.mjs`
- Modify: `tests/main/packaging-config.test.ts`
- Create: `tests/main/document-bundle.test.ts`

**Interfaces:**

- Produces: document-engine prebundle consumed by the normal main build
- Preserves: SDK/Playwright/better-sqlite3 remain external runtime dependencies

- [x] **Step 1：写失败构建测试**

  断言新增文档包仍在 `devDependencies`，electron-builder 不复制它们；最终 `main.mjs` 不含对 `pdfjs-dist/mammoth/docx/pptxgenjs/fflate/fast-xml-parser` 的裸 import/require。

- [x] **Step 2：实现两阶段 esbuild**

  先把 `src/host/document-engine.ts` 及其依赖打成临时单文件，再由 main build 插件把该文件内联到 `main.mjs`。临时文件不进入 electron-builder `files`；构建结束清理。SDK 与原生模块继续 external。

- [x] **Step 3：运行 build 与包结构测试**

  ```powershell
  npm run build:main
  npx vitest run tests/main/document-bundle.test.ts tests/main/packaging-config.test.ts
  git diff --check
  ```

- [x] **Step 4：提交**

  ```powershell
  git add scripts/build-main.mjs tests/main/document-bundle.test.ts tests/main/packaging-config.test.ts
  git commit -m "build(r11): bundle document runtime into main"
  ```

## Task 6：打包态用户路径和发布证据

**Files:**

- Create: `scripts/cdp-document-tools-verify.mjs`
- Create: `docs/research/2026-07-31-r11-document-tools-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`

- [ ] **Step 1：在隔离用户数据目录构建真实样例**

  通过 UI 对话让 momo 读取四种文件并新建三种文件；验证结果确实存在、可重新读取，时间线只显示轻量工具状态。

- [ ] **Step 2：制造失败并恢复**

  测损坏文件、越界路径、目标已存在和超限输入；失败后改用合法路径能成功，原文件无损。

- [ ] **Step 3：重启恢复和四视口检查**

  重启后新建文件仍在成果/文件树可见；`1440x900 / 1280x720 / 1024x768 / 720x640` 的工具卡、错误和 composer 不遮挡。

- [ ] **Step 4：全量验证与包体对比**

  ```powershell
  npm test
  npm run typecheck
  npm run build
  npm run build:main
  npm run electron:pack
  node scripts/cdp-document-tools-verify.mjs
  git diff --check
  ```

  记录安装器、`app.asar`、解包文件数、冷启动和空闲内存；若新增运行文件远超预期，回滚依赖打包方案，不把性能债带进下一张卡。

- [ ] **Step 5：更新证据并提交**

  ```powershell
  git add scripts/cdp-document-tools-verify.mjs docs/research/2026-07-31-r11-document-tools-verification.md docs/sdd/r7-requirements-ledger.md
  git commit -m "test(r11): verify packaged document tools"
  ```
