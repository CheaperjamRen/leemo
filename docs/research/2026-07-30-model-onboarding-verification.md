# r9 模型接入、能力证据与失败重试发布验收

> 最终验收时间：2026-07-31（Asia/Tokyo）
> 结论：本卡必做用户路径已在最终 Windows 打包应用中闭环；原生 Windows 文件选择框未纳入本轮自动化，边界见“残余风险”。

## 1. 最终成品

- 解包应用：`dist-package/win-unpacked/Leemo.exe`
- 安装器：`dist-package/Leemo Setup 0.0.1.exe`
- 可执行文件 SHA-256：`559CE0B9868CBB6AD06DE2AD629047C2DF4F2F190AB1D717286E570A99C1DBD6`
- 安装器 SHA-256：`B2D2CA94939BA498727907521A746F30723EF537A2F477A572FACDF321B61B8A`
- `app.asar` SHA-256：`54741202C6A1DF53C4DCBE0E05594F14F60C72D738D2597BEDEA172E982D4CDE`

所有发布路径验收均使用临时 `--leemo-e2e-root` 和本机 OpenAI 兼容 mock。没有读取用户 Provider、真实 Key、真实本子或付费额度，外网请求数为 0。

## 2. 用户路径结果

| 路径 | 最终结果 | 证据 |
|---|---|---|
| 服务商目录 -> 自定义 Provider | 4 个预设 + 自定义入口均为真实可点击卡片 | `model-onboarding-r9-catalog.png` |
| 连续配置 | 名称、协议、地址、Key、模型发现、手动模型、排序、高级任务路由在一页完成 | `model-onboarding-r9-form-top.png` |
| 能力探测 | 文本、图片、深度思考请求均到达本地上游；图片失败只形成证据，不阻断发送 | `model-onboarding-r9-capability-disputed.png` |
| 用户纠正 | “我确认支持图片”优先于自动探针，且跨重启保持 | `model-onboarding-r9-capability-override.png` |
| 用量边界 | 模型页不再混放余额；独立“用量”一级页展示真实空态/汇总 | `model-onboarding-r9-usage.png` |
| 失败与重试 | host 已确认后返回真实 400；原文字段保留，错误翻译成人话；切模型后重试成功 | `model-onboarding-r9-retry.png`、`model-onboarding-r9-retry-success.png` |
| 附件重试 | 失败轮与成功轮携带相同绝对路径元数据，未静默降为纯文本 | `model-onboarding-r9-runtime-facts.json` |
| 子任务路由 | 打包 Agent 工具真实派出子任务；显式模式 `beta -> alpha`，自动模式 `beta -> beta` | `model-onboarding-r9-runtime-facts.json` |
| 重启恢复 | Provider/模型顺序、脱敏 Key、图片用户覆盖、子任务模型和新对话默认模型均保持 | `model-onboarding-r9-after-restart.png` |

运行时事实：`docs/research/audit-shots/model-onboarding-r9-runtime-facts.json`。汇总审计：`docs/sdd/evidence-provider-verify.json`，14/14 通过。

## 3. 布局与目验

`scripts/verify-settings-layout.mjs` 在同一隔离打包进程中检查 `1440x900`、`1280x720`、`1024x768` 和 `720x640`：

- 六个一级设置标签全部可达；
- 模型配置不再存在“连接 / 模型与角色 / 高级”内层标签；
- 长模型 ID 没有撑宽；模型表单、用量页和输入区横向溢出均为 0；
- 四个视口的模型操作区均为 56px；720x640 正文可视高度由首次目验的 130px 修正为 206px；
- 关闭设置后，输入框、输入面板和发送按钮均完整位于视口内。

截图按视口保存为：

```text
model-onboarding-r9-layout-{1440x900,1280x720,1024x768,720x640}-model-top.png
model-onboarding-r9-layout-{viewport}-model-bottom.png
model-onboarding-r9-layout-{viewport}-usage.png
model-onboarding-r9-layout-{viewport}-composer.png
```

机器事实：`docs/research/audit-shots/model-onboarding-r9-layout-facts.json`。人工目验额外确认失败提示不再出现底层品牌名，输入框不再被窗口裁切。

## 4. 执行证据

```powershell
npm test
# 130 files / 1797 tests passed

npm run typecheck
# vendor + main + renderer，0 errors

npm run build
npm run build:main
$env:HTTPS_PROXY='http://127.0.0.1:10801'; npx electron-builder
# renderer、main、win-unpacked、NSIS installer 均成功

node scripts/verify-settings-runtime.mjs
# 打包 UI、失败重试、附件 Bridge、真实 Agent 子任务、重启与四视口布局通过

node scripts/cdp-provider-verify.mjs
# 14/14；只消费隔离证据，不再调用真实 Provider

node scripts/verify-packaged-openai-gateway.mjs
# 精确模型、Authorization、自定义 Header、IPC 文本和 run.finished:success 全部匹配
```

第一次无代理运行 `electron-builder` 在下载 Electron 时访问 GitHub 超时；确认用户提供的 `127.0.0.1:10801` 可用后，仅给打包进程设置代理，未改项目或模型 API 配置。

## 5. 包体与性能

| 指标 | 本卡前同口径 | 最终 | 变化 |
|---|---:|---:|---:|
| `dist-package` 文件数 | 320 | 320 | 0 |
| `dist-package` 总字节 | 916,989,469 | 916,997,110 | +7,641 |
| 安装器 | 185,149,663 B | 185,150,863 B | +1,200 B |
| `app.asar` | 72,080,639 B | 72,087,160 B | +6,521 B |
| 主 renderer | 约 649.44 kB | 649.46 kB | 约 +0.02 kB |

最终隔离测量：冷启动 1.58 秒、重启 1.95 秒；关闭设置并等待 2 秒后，Leemo 进程树为 4 个进程、710.91 MiB 工作集。文件数没有增长，也没有新增运行时依赖；内存仍高，保留为发布性能债，不据此宣称已完成内存优化。

## 6. 安全与内部心智

- 测试 Key 不在截图、facts、renderer 状态或主进程日志中；
- 打包 renderer 主 chunk 扫描 `Fable|Sonnet|Opus|Haiku|CLAUDE_CODE_|ANTHROPIC_DEFAULT_|Claude Code`，命中 0；
- SDK 包装错误在 Bridge 边界被翻译为 Leemo 提示，错误轮不再生成一条伪装成 momo 回答的 `text.final`；
- `cdp-provider-verify.mjs` 已取消旧版真实上游请求、真实 userData 写入和测试 Provider 增删。

## 7. 残余风险

本轮无法稳定自动操作 Windows 原生文件选择框：自动化帮助器在系统“打开”对话框报告无法取得前台进程 ID。已停止重试该不可靠路径，并如实记录 `nativeAttachmentPickerAutomated: false`。

这不等于附件功能未通：历史 B5 已有真实 Electron 选择图片并由视觉模型读图的用户路径；本轮新增证据覆盖打包 Bridge 的真实绝对路径、host ack 后失败、切模型和同路径重发。尚缺的是“本轮隔离脚本从原生文件框开始”的一条全自动串联，不把它伪写为已完成。

本轮也没有调用 DeepSeek/Kimi/GLM 等真实付费上游做组合矩阵。Provider 协议与网关发布链路由本地兼容 mock 验证，供应商临时策略、余额和模型可用性仍属于运行时外部变量。
