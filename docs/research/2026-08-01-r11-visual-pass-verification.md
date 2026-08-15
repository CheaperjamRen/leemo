# r11 桌面视觉统一与内测候选包验收

日期：2026-08-01
结论：**双模式主壳、设置、技能、定时任务、成果与搜索已完成同一套视觉语言，并在最新打包应用中通过 7 个核心界面、4 个窗口尺寸和 6 组布局约束。** 本轮没有新增运行依赖或安装目录文件；验收使用隔离 userData 和本机 loopback 模型，不读取真实工作区、不访问外网、不消耗模型额度。

## 1. 用户可见变化

- 搭子态与工作台共用一个模式切换器和同一套图标、焦点、悬停、圆角、阴影与间距规则，不再像两套拼接产品。
- 页面改为安静的暖灰底色与单一低饱和琥珀强调色；移除径向光晕、颗粒和装饰性渐变，信息层级由排版、留白和边界承担。
- 顶栏手绘 SVG 全部替换为统一图标；技能、定时任务和成果采用同一页面网格与滚动边界。
- 工具页不再在顶栏和正文重复显示页面名；空工作台直接回到 momo 与“今天想先处理什么？”，避免多余说明卡。
- 设置页沿用“左导航 + 右内容”的中型弹窗结构，但颜色、文字层级、选中态和控件反馈已并入全局系统。
- 720x640 下聊天输入区、发送按钮、设置页底部操作栏和各工具页主操作均保持可见，没有横向溢出或文字遮挡。

## 2. 真实目验发现并修复的问题

1. 各页面曾分别维护橙色、阴影和背景，导致主壳、设置和工具页视觉漂移。现在统一由 `tokens.css` 与 `effects.css` 提供语义变量和共享页面结构。
2. 工作台工具页标题曾在顶栏和正文重复，浪费纵向空间；现在顶栏只保留上下文和全局操作。
3. 第一轮打包截图发现输入框既有自身焦点边框，又被全局规则套一层焦点环。全局规则已收窄到按钮和键盘可聚焦容器，搜索框只保留一层反馈。
4. 搭子态背景曾依赖光晕和颗粒制造氛围，在不同窗口下显脏且不稳定；现在去掉装饰层，关系感由 momo、问候、真实 Skill 入口和对话节奏表达。
5. 不同功能页曾各自决定最大宽度与滚动区，最小窗容易产生不一致；现在共用页面外框、标题区和 `min-height: 0` 滚动约束。

## 3. 打包态视觉门禁

`node scripts/verify-visual-r11.mjs` 通过 6 组约束：

- 7 个核心界面：搭子态、工作台、技能、定时任务、成果、搜索、模型设置。
- 4 个窗口：1440x900、1280x720、1024x768、720x640。
- 所有界面页面级和目标容器横向溢出均为 0。
- 两种聊天输入区在四个窗口中均完整位于视口内。
- 可见渐变元素为 0，控件裁切列表为空。
- 技能、定时任务和成果页不存在顶栏标题重复。

结构化事实：`docs/research/audit-shots/r11-visual-pass-facts.json`。

代表性截图：

| 界面 | 桌面 | 最小窗 |
|---|---|---|
| 搭子态 | `audit-shots/r11-visual-buddy-1440x900.png` | `audit-shots/r11-visual-buddy-720x640.png` |
| 工作台 | `audit-shots/r11-visual-workbench-1440x900.png` | `audit-shots/r11-visual-workbench-720x640.png` |
| 技能 | `audit-shots/r11-visual-skills-1440x900.png` | `audit-shots/r11-visual-skills-720x640.png` |
| 定时任务 | `audit-shots/r11-visual-scheduled-1440x900.png` | `audit-shots/r11-visual-scheduled-720x640.png` |
| 成果 | `audit-shots/r11-visual-artifacts-1440x900.png` | `audit-shots/r11-visual-artifacts-720x640.png` |
| 搜索 | `audit-shots/r11-visual-search-1440x900.png` | `audit-shots/r11-visual-search-720x640.png` |
| 模型设置 | `audit-shots/r11-visual-settings-models-1440x900.png` | `audit-shots/r11-visual-settings-models-720x640.png` |

## 4. 安装包与性能

| 指标 | 本轮最终值 | 视觉改造前同口径 |
|---|---:|---:|
| NSIS 安装器 | 187,152,145 B | 187,152,297 B |
| SHA-256 | `044662DAC22812FBA102ED94F7A01C823BAF7405807C0BA2837D49AF8796AB61` | `767ED35B5A6C0831A4BAF4BC24AA4F865B4B528D214B64F34E4D6F522A49177B` |
| win-unpacked | 315 文件 / 744,347,771 B | 315 文件 / 744,348,578 B |
| 小于 4 KiB 的文件 | 144 | 144 |
| app.asar | 84,833,661 B | 84,834,468 B |
| 隔离环境首次启动 | 1.23 s | 1.28 s |
| 隔离环境重启 | 1.24 s | 1.21 s |
| 验收时工作集 | 213,585,920 B（约 203.69 MiB） | 212,111,360 B |

安装目录文件数与小文件数均未增加；尺寸变化约为噪声范围。工作集单次样本增加约 1.4 MiB，不足以单独推断回归，但仍保留为后续多次采样的性能基线。

## 5. 自动验证

```powershell
npx vitest run src/renderer/components/WorkbenchShell.test.tsx src/renderer/components/BuddyShell.test.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/pages/ScheduledTasksPage.test.tsx src/renderer/pages/SettingsPage.test.tsx
npx vitest run
npm run typecheck
npm run build
npm run build:main
npm run electron:pack
node scripts/verify-visual-r11.mjs
node scripts/cdp-skills-r11-verify.mjs
git diff --check
```

- 聚焦回归：5 个文件、112/112。
- 全量回归：152 个文件、2142/2142。
- 三套 TypeScript typecheck 0 错；renderer、主进程、win-unpacked 与 NSIS 构建成功。
- 最新包中的 Skill 目录、搜索/分类、热切换、斜杠菜单与重启恢复继续为 11/11。

## 6. 明确边界

- 本轮解决视觉漂移、重复信息、控件反馈和窗口适配，不以添加装饰组件或复制竞品页面数量制造“完成感”。
- 空工作台与空成果页刻意保持安静；后续只有真实新手任务、历史内容或场景模板出现时才增加信息，不放假数据。
- 设置最小窗仍存在外层弹窗与长表单内层滚动，这是可用但不理想的 P2；不阻塞内测，后续应在设置专项中简化长表单，而不是继续缩小字号。
- 视觉风格已统一，但“学习英语、深度学习、求职”如何形成独特的长期体验仍属于场景产品层，不把基础 UI 打磨等同于差异化完成。
