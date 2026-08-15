# NewMax 与 Leemo Office Skill 逐文件对比

日期：2026-08-02

## 结论

NewMax 的四个 Office 目录与本机通过 Anthropic 官方插件安装得到的文档
Skill 是同一条产品线的版本变体，不是 Leemo 自写实现的等价物。PDF 目录
逐文件完全一致；DOCX、XLSX、PPTX 大部分文件相同，但存在版本差异和
少量只在一侧出现的文件。因此 Leemo 不应把自己的最小 Office Tool 宣称为
已经等价于这套高级 Skill。

本次逐文件对比本身没有修改 NewMax 文件。随后产品拥有者自行把四个目录
放入 Leemo 的本地离线挂载点；下面的“当前交付状态”按实际打包结果更新。

## 对比根目录

| 一侧 | 根目录 |
| --- | --- |
| NewMax | `C:\Users\Example\.newmax\skills\{docx,xlsx,pptx,pdf}` |
| Anthropic 官方插件缓存 | `C:\Users\Example\.claude\plugins\cache\anthropic-agent-skills\document-skills\b29e7cf65e5c\skills\{docx,xlsx,pptx,pdf}` |

比较字段为每个相对路径的 SHA-256、文件数和字节数；目录内容保持原样。

## 结果

| Skill | 官方文件/字节 | NewMax 文件/字节 | 同哈希 | 哈希不同 | 仅官方 | 仅 NewMax |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| docx | 61 / 1,152,291 | 61 / 1,141,881 | 48 | 9 | 4 | 4 |
| xlsx | 53 / 1,125,976 | 54 / 1,116,109 | 41 | 9 | 3 | 4 |
| pptx | 56 / 1,163,076 | 59 / 1,154,142 | 42 | 11 | 3 | 6 |
| pdf | 12 / 60,529 | 12 / 60,529 | 12 | 0 | 0 | 0 |

“同哈希”只表示文件级内容一致，不代表两套运行环境的依赖、模型或
调用链完全相同。NewMax 的历史 Excel 成功记录仍显示它依赖本机
Python 3.14 + openpyxl 3.1.5，并会在桌面文件占用时让用户关闭后重试。

## 许可与交付边界

四个目录里的 `LICENSE.txt` 都写明：材料受 Anthropic 服务协议约束，禁止
复制、留存、分发和制作衍生作品。基于这个可验证的本地许可文本，Leemo
代码不会自动把它们复制进安装包，也不会删除许可证来规避限制。

Leemo 已提供一个不依赖 GitHub 的、由产品拥有者自行放入授权文件的入口：

```text
E:\Leemo\bundled-skills\office\skills\docx\SKILL.md
E:\Leemo\bundled-skills\office\skills\xlsx\SKILL.md
E:\Leemo\bundled-skills\office\skills\pptx\SKILL.md
E:\Leemo\bundled-skills\office\skills\pdf\SKILL.md
```

构建时该目录会被复制到安装包的 `resources/office-skills`；启动时 Leemo
先校验四个目录，再建立只读适配目录。没有完整 bundle 时，基础文档 MCP
仍可用，技能卡会明确显示 Office 技能包未就绪，而不会把网络失败伪装成成功。

## 当前交付状态

产品拥有者已放入四个目录，`npm run verify:office-bundle` 实测通过：

- 四个 Skill 共 182 个文件；连同入口 README，离线 bundle 为 183 个文件、
  3,503,010 B；树哈希为
  `94ee3a5f35195f5f499b1d4ce5ff46679d6d30ea389306ed36928d330cb41f75`。
- 最终 unpacked 包内四个 `resources/office-skills/skills/*/SKILL.md` 均存在。
- 打包态 Skills 用户路径 14 项通过：44 张可用卡片、12 个默认启用；中文卡片
  “Excel 表格”正确发出 `/xlsx`，且 XLSX Skill 的三个独有正文标记实际进入
  SDK 模型请求；重启后启用状态恢复，四视口无横向溢出。

这证明“安装包离线带有技能文件并能被 Agent 加载”已经成立，但不等于
“干净 Windows 机器具备完整 Office 执行环境”。`npm run verify:office-runtime`
的实际结果为 `fullOfflineReady: false`：

- 当前机器可用 `Python 3.14 + openpyxl + pandas`，XLSX 公式与样式的创建、
  保存和重读通过；PDF 的纯 Python 边界框辅助脚本也通过。
- `LibreOffice/soffice`、Pandoc、MarkItDown、Poppler（排除 Codex 自身运行时）、
  qpdf 均不在 Leemo 用户环境；`pypdf/pdfplumber/reportlab` 也未安装。
- 公式重算、DOCX/PPTX 页面渲染因此不可用；随包 `soffice.py` 在当前 Windows
  Python 上还会因直接访问 `socket.AF_UNIX` 报错。
- DOCX/PPTX 校验器以 Windows 默认 GBK 读取部分 UTF-8 XML，产生解码错误。
- 从隔离的普通用户工作区运行 `require('docx')` / `require('pptxgenjs')` 失败；
  Leemo 主程序内部打包了这些库，不代表 Agent 临时脚本可以从用户目录解析它们。

NewMax 在本机的已证实 Excel 成功路径也依赖系统 Python/openpyxl，安装目录
同样没有内置 Python、LibreOffice 或 Pandoc。因此四个 Skill 的原样分发解决
的是工作流和脚本可得性，不是跨机器运行时自包含。

## 当前验收证据

- 离线 bundle 路径：相关源码回归覆盖并发调用、越界路径、缺包降级和中文命令别名。
- `npm run typecheck` 通过。
- 生产代码不再包含官方插件下载分支；Office provisioner 只读取构建时
  `resources/office-skills` 的本地 bundle。
- 安装包配置包含 `extraResources -> resources/office-skills`；当前最终包已经
  包含产品拥有者放入的四个技能目录。
- `npm run verify:office-runtime` 是单独的严格发布探针；在 Windows 兼容层和
  执行依赖补齐前会以非零状态如实阻止“完整离线 Office”口径。

## 包体策略

当前最终 NSIS 为 187,665,215 B（178.97 MiB），SHA-256 为
`2A1AB45F7F1A2F8EC067952F3C7A723866EAA687744E6184A4CE82A6F8C3BF60`；
unpacked 为 498 个文件，其中 Office bundle 占 183 个文件、3,503,010 B。
相对未放入 bundle 的同轮包，安装器只增加约 0.45 MB，主要代价是小文件数，
不是压缩体积。

MVP 不应把完整 Python、LibreOffice 和 Poppler 粗暴塞进主安装包。建议顺序：

1. Leemo 内置的确定性 JS 文档工具继续做每台机器都有的基础层；`docx` 和
   PptxGenJS 本就适合直接由 Node/Electron 生成 OOXML，PDF 长尾可优先采用
   轻量纯 JS 库。
2. 探测用户已有 Microsoft Office/WPS/LibreOffice；可用时才启用公式重算和
   PDF 导出目验。Office 的全量重算与固定格式导出都有官方客户端 API，但调用
   必须设超时、进程清理并保持交互式桌面边界。
3. 真有内测失败率证据时，再提供独立、按需下载并可卸载的增强运行包；不让它
   阻塞首次聊天和基础文档任务。
4. 单独优化这 183 个小文件：构建时形成单一版本化归档，首次启动原子展开到
   AppData 缓存，版本不变不重复展开。先做冷安装/启动实测，再决定是否值得。

参考：electron-builder 官方建议把运行时资源放 `extraResources`、默认用 ASAR
减少散文件；Python 官方的 embeddable distribution 适合作为应用组件，但不含
pip，仍需自行负责依赖和 C runtime。因此它只适合作为以后独立增强包的候选，
不是当前主包的默认依赖。
