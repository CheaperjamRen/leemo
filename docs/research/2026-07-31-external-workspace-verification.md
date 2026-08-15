# r11 外部项目工作区发布验收

日期：2026-07-31
结论：**Implemented / Integrated / Release-verified 均成立。** 本轮在打包后的 Windows 应用中完成完整用户路径；测试使用系统临时目录、隔离 HOME/userData 和本机 OpenAI 兼容 mock，没有读取用户真实工作区、调用外网或消耗付费模型。

## 1. 用户路径结果

`node scripts/verify-external-workspace.mjs` 共通过 9 项检查：

- 从可见的“打开文件夹”入口登记临时项目，renderer 只拿到不透明 `workspaceId`。受控候选目录必须同时带 `--leemo-e2e-root`，且必须是隔离根内的真实普通目录；外部路径、重复参数和 symlink 都会被拒绝。
- 新建项目对话后，真实 `Write` 工具把 `r11-project-artifact.md` 写到项目根；Leemo 主工作区的 `默认工作区` 没有同名副本。
- 文件树能打开该文件，成果页归到“当前项目”，Markdown 预览显示实际内容。
- 项目约定默认写入 `<project>/.leemo/memory/ledger.jsonl + MEMORY.md`；“关于我”没有同一条记录。设置页能按真实项目名筛选和管理。
- 项目目录生成 2 份便携对话归档，归档都带同一不透明项目 id。
- 退出并重启后，项目对话恢复并能继续发送下一轮。
- 把目录暂时改名后，最近项明确显示“找不到文件夹”；Leemo 没有偷偷退回主工作区写文件。
- 目录恢复后复用原 id，对话与项目记忆都回来，没有生成第二个项目。
- “从最近列表移除”只移除登记；用户目录及其中 `.leemo` 完整保留。

验收过程中还抓到并修复了一处真实竞态：切换到本来已经读过的对话曾无意义地复制元数据，随后立刻移除项目会触发一个晚到的写盘请求。现在已读对话不再产生伪变更，打包路径重跑后 renderer 错误为 0。

## 2. 视觉与窗口

| 状态 | 视口 | 结果 | 证据 |
|---|---:|---|---|
| 项目、成果与预览 | 1440x900 | 项目名、根目录产物、当前项目分组和真实预览同时可见 | `audit-shots/r11-external-workspace.png` |
| 项目记忆 | 720x640 | “项目”筛选会联动到“项目：毕业设计项目”，真实记忆记录可见，设置窗口完整 | `audit-shots/r11-external-memory-720x640.png` |
| 目录暂时丢失 | 1440x900 | 最近项保留并显示“找不到文件夹”，移除入口仍可用，composer 完整 | `audit-shots/r11-external-missing-folder.png` |

`1440x900`、`1280x720`、`1024x768`、`720x640` 四个视口均满足：页面横向溢出 0，输入框完整位于视口内。结构化事实保存在 `audit-shots/r11-external-workspace-facts.json`。

## 3. 包体与性能

| 指标 | r10 基线 | r11 最终 | 变化 |
|---|---:|---:|---:|
| NSIS 安装器 | 185,183,652 B | 185,205,228 B | +21,576 B |
| win-unpacked 文件数 | 315 | 315 | 0 |
| win-unpacked 总大小 | 731,812,266 B | 731,951,862 B | +139,596 B |
| app.asar | 72,298,156 B | 72,437,752 B | +139,596 B |
| 冷进程启动到输入框可用 | 1,323 ms | 1,357 ms | +34 ms |
| 空闲进程工作集 | 4 / 540,012,544 B | 4 / 581,369,856 B | +41,357,312 B |

解包目录共 59 个目录，其中 144 个文件小于 4 KiB；总文件数与 r10 相同，没有重现“小文件暴增导致解压数分钟”的旧问题。安装器：`E:\Leemo\dist-package\Leemo Setup 0.0.1.exe`，SHA-256：`611AEA331DA1A27302A1DEFD030708D1E456F97EB400B0B7B679D57A28FF030E`。

主 renderer chunk 为 692.10 kB（gzip 202.00 kB），仍有 Vite 500 kB 警告。当前没有新增运行依赖、安装文件或明显启动回退，因此不为消除警告在内测前做高风险拆包重构；它继续作为性能债跟踪。

## 4. 自动验证

```powershell
npm test
# 141 files / 2043 tests passed

npm run typecheck
# vendor + host/main + renderer: 0 errors

npm run electron:pack
node --check scripts/verify-external-workspace.mjs
node scripts/verify-external-workspace.mjs
git diff --check
```

生产 renderer、主进程、`win-unpacked` 与 NSIS 均重新构建成功。打包器访问 GitHub 时只给该子进程临时使用本机 `10801` 代理；没有修改系统或产品网络配置。

## 5. 明确未做

- 本子模板、学习/求职场景模板不属于这张通用工作区底座卡。
- 云同步、团队共享、Git 托管和远程工作区没有进入当前内测阻塞项。
- 真实供应商付费模型矩阵没有在此脚本消费额度；本轮证明的是打包 Leemo、工具、文件、项目记忆和重启恢复之间的完整路径。
