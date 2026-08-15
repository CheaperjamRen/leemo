# Windows 电脑操作验证（2026-08-03）

## 用户结果

Leemo 现在具有与浏览器操作分开的 Windows 电脑操作入口。用户主动开启后，momo 可以观察桌面、等待界面变化、输入、读回和点击；设置页直接说明屏幕数据边界，以及密码、验证码和登录由用户接管。关闭开关时工具在结构上不可用，“完全访问”也不会替用户悄悄开启屏幕能力。

## 实现与安全边界

- 离线运行时来自 [`sbroenne/mcp-windows`](https://github.com/sbroenne/mcp-windows) `v1.3.18`，MIT；安装包只额外放置一个可执行文件、manifest 和许可证。
- 构建前校验发布归档 SHA-256 `D5ADD55905C9CC79473673F70C847B27A9360F725F2026C94413032571A753C5`，以及可执行文件 `59,784,950 B` / SHA-256 `E1CADA4CDADCD712D586C96C146FA6D0ECCFF61BD7D7107AA0EC4961D758E76E`。最终安装包内副本哈希一致。
- momo 先使用 Windows 可访问性树定位应用和控件，截图/坐标只作回退。文件、网页仍优先使用对应的结构化工具。
- 普通动作可在本次任务内连续授权；坐标点击、Enter、关闭窗口和语义不透明的最终点击不会继承宽泛授权。UAC、锁屏、密码与二次验证不自动处理。

## 可复跑证据

```text
npm run verify:computer-runtime
Windows computer runtime verified (1.3.18; 59784950 bytes; E1CADA...E76E)

npm run verify:computer-use
observe / wait / type / read / click passed on a real Windows form

npm run verify:packaged-computer-use
fresh profile: disabled
enabled probe: 18 tools ready
restart 1: enabled state restored from encrypted config
restart 2: disabled state restored from encrypted config
model calls: 0

npm test
182 files / 2494 tests passed

npm run typecheck
3 TypeScript projects passed
```

结构化事实与目验截图：

- `docs/research/audit-shots/packaged-computer-use-facts.json`
- `docs/research/audit-shots/packaged-computer-use-settings.png`

最终 NSIS：`242,523,611 B`（`231.29 MiB`），SHA-256 `DE92DCB489C960B0B54FC54D271CC6E91B178C26CCCEFF233817D8D453850D99`。解包为 `320` 个文件 / `817,123,286 B`；相对上一包增加 `52,406,039 B`（`49.98 MiB`）。构建日志明确使用 `node_modules/electron/dist`，没有再次下载 Electron。

## 当前结论

状态为 **Integrated**。运行时、设置、热切换、权限边界、真实桌面五动作、打包加载与开关重启恢复都成立。

暂不标记 Release-verified：还缺一条由真实模型从自然语言发起、经过可见授权卡、需要时人工接管再继续的完整打包任务；当前 Windows 桌面状态下低层 `SendInput` 键盘/滚动被系统拦截，因此也不能宣称所有权限层级和应用都可操作。后续只补这两项证据，不再扩张本卡架构。
