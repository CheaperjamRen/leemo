# Superpowers 离线包验证与量化（2026-08-07）

## 结论

- 固定来源：`obra/superpowers@3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9`（v6.2.0，MIT）。
- 上游有效载荷为 **14 个 Skill、51 个受清单约束的文件、353,462 bytes**；内容摘要为
  `f3355d5b89693b8337584fcb23a43a647e5fd388e6b7e03e3bffc180dba9a026`。
- `electron-builder.yml` 把 `bundled-skills/superpowers/release/**/*` 放进 ASAR 的 `files`，没有放进
  `extraResources`。因此安装目录不会为这套能力额外散落 52 个资源文件；Leemo 启动时会在后台
  原子准备一份可校验、可复用的运行缓存，让默认关闭的开关也能立即使用，但普通对话不会注入它。
- `electron:pack:base` 在任何构建前先运行 `verify:superpowers-bundle`，随后综合
  `verify:bundled-skills` 也会再次校验并单独报告 Superpowers 身份和体积。

## 文件与压缩量

`npm run verify:superpowers-bundle` 的固定口径不计算 `manifest.json` 自身：

| 口径 | 文件数 | 字节数 |
| --- | ---: | ---: |
| 受 manifest 哈希约束的上游有效载荷（LICENSE + 50 个 Skill 树文件） | 51 | 353,462 |
| 实际进入 ASAR 的 release 目录（再含 manifest.json） | 52 | 364,555 |
| PowerShell `Compress-Archive -CompressionLevel Optimal` 的独立 ZIP 样本 | 52 | 151,404 |

ZIP 只用于给出可复跑的压缩量级，不等同于 NSIS 安装包中的边际增量；NSIS 会把它与整包其他内容
一起压缩。在不实际联网构建完整安装包的前提下，不能诚实地把 151,404 bytes 说成最终安装包增量。
ASAR 自身是归档而不是这份 ZIP 压缩。

## 首次生成与缓存命中

### 方法

- 系统：Windows 11 家庭版，10.0.26200，64 位。
- CPU：AMD Ryzen 7 8845H，8 核 / 16 线程；内存约 32 GB。
- 磁盘：E:，NTFS；Node.js v24.16.0。
- 在 E: 的临时用户配置目录执行 12 轮。每轮先从固定 release 创建全新的运行缓存，再重新创建
  provisioner 并命中同一缓存；每轮后删除该轮目录。
- 计时从 `createSuperpowersSkillProvisioner(...)` 之前开始，到 `ensureReady()` 返回 `ready` 为止，
  因而包含来源发现、51 文件哈希校验、首次复制或缓存深校验，不只计算一次 `rename`。
- 测试目录刻意位于仓库外的 `E:\LeemoPackagingPerf`，更接近用户的 AppData。仓库内目录会被开发
  工具文件监听器占用，不能代表正常用户配置目录，并在本轮暴露出 Windows `rename` 的防御性需求。

### 结果

| 场景（12 轮） | 最小值 | 中位数 | P95 / 最大值 |
| --- | ---: | ---: | ---: |
| 首次生成完整插件 | 116.8 ms | 125.6 ms | 141.1 ms |
| 新 provisioner 命中并深校验缓存 | 49.8 ms | 54.3 ms | 66.2 ms |

这是同一进程、操作系统文件缓存逐步变暖的微基准，不是 Leemo 冷启动时长，也不能外推到所有硬盘。
它能支持的结论只有：在这台机器和这套固定载荷上，首次生成与缓存深校验都处于百毫秒以内到约
一百四十毫秒的量级。

### Windows 原子发布可靠性

完整树在被文件监听器短暂占用时，Windows 可能对目录发布返回 `EPERM`、`EBUSY` 或
`ENOTEMPTY`。provisioner 只对这三类错误进行 20 / 50 / 100 / 200 ms 的有限异步退避；重试等待
不会额外阻塞 Electron 主线程，其他错误保持原样进入既有失败恢复路径。测试覆盖三类重试、非瞬态错误不重试、
完整 pinned 50 文件 Skill 树，以及替换失败时恢复旧插件。

## 普通对话不注入 Superpowers

Task 3 当前的聚焦测试：

```powershell
npx vitest run tests/host/bridge-host.test.ts -t "keeps an ordinary default conversation completely free of Superpowers"
```

本轮结果为 1 passed。它验证在宿主路由层，普通默认对话不会因为选择技能而再次触发 Superpowers
准备；SDK 只收到无关的默认 Leemo Skill，`plugins` 不含 Superpowers 路径，`skills` 不含任何
`superpowers:*`，系统提示词也没有 Superpowers bootstrap。应用启动时的后台本地准备是另一条链路，
不等于把这套方法注入普通对话。

这项证据依赖 Task 3 的 Host 路由改动；应与 Task 3 一起合并后再作为最终发布证据。本文没有把它
伪装成仅靠包装配置就能保证的行为。

## 可复跑的发布门禁

```powershell
npm run verify:superpowers-bundle
npm run verify:bundled-skills
npx vitest run tests/main/bundled-skill-bundle-script.test.ts
npx vitest run tests/main/superpowers-skill-provisioner.test.ts
npm run typecheck
git diff --check
```

本卡不运行完整 `electron-builder` / NSIS 打包，不访问网络，也不把临时 ZIP 或性能目录提交到仓库。
