# 快捷便签与工作台第一里程碑实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按本计划逐项实施；每项先写一个能证明用户路径的失败测试，再做最小实现。评审预算为 1 次，不做反复形式化审计。

**目标：** 先交付一条完整、可恢复的用户路径：在任何应用按自定义快捷键打开轻量便签，安静记录并落盘，然后在 Leemo 的完整便签工作面中继续查找和编辑。

**本里程碑边界：** 只做快捷便签、完整便签库、后台驻留及必要设置。正式待办、批量解析、提醒、附件与存储迁移、`@便签` 和 momo 管理进入紧接着的第二里程碑。本里程碑不调用模型、不写 memory、不创建本子文件。

**视觉方向：** Swiss 信息系统。中性白灰、单一琥珀强调色、无装饰性文案、左对齐网格与细分隔线；日期/序号形成记录脊柱。沿用 Leemo 现有字体和设计 token，不在本卡重构全局视觉。

**技术路线：** 复用现有 Electron、SQLite、Zustand、React 与 typed preload/IPC 模式。快捷窗使用独立 HTML + 窄 preload，不挂载完整 App。便签正文以 Markdown 为稳定存储格式；编辑层使用成熟的 Lexical React 组件提供同屏富文本、列表、勾选项、撤销与 Markdown 转换，避免自造 `contenteditable`。新增依赖必须锁定版本并将 npm cache/TEMP 指向 E 盘。

---

## Task 1：便签领域模型、SQLite 与主进程服务

**文件：**

- 新建：`src/captures.ts`
- 新建：`src/main/capture-admin.ts`
- 新建：`src/main/persistence/capture-persistence.ts`
- 修改：`src/main/persistence/schema.ts`
- 测试：`tests/main/capture-admin.test.ts`
- 测试：`tests/main/capture-persistence.test.ts`

### 1.1 RED：先锁定真实数据行为

- 草稿持续 upsert，进程重建后逐字恢复。
- 非空草稿提交时，用一个事务创建便签并清空草稿；空白不创建。
- 便签列表按最近更新排序；能读取、更新、归档。
- 从旧 schema 增量升级不破坏已有数据。

运行：

```powershell
$env:TEMP='E:\Temp\Leemo'; $env:TMP=$env:TEMP
npx vitest run tests/main/capture-admin.test.ts tests/main/capture-persistence.test.ts
```

预期：新增测试因表、类型或服务不存在而失败。

### 1.2 GREEN：最小实现

- `captures` 与单例 `capture_draft` 使用现有 SQLite/WAL。
- 主进程 `CaptureAdmin` 成为便签真源；不把全部正文塞进应用启动快照。
- 快捷窗和主窗口只通过同一个 Admin 写入；renderer store 不是第二真源。
- 输入边界做必要校验；不引入新数据库、搜索引擎或内容哈希系统。

### 1.3 验证

运行同一聚焦测试；确认重启恢复与提交原子性均通过。

---

## Task 2：窄 IPC、快捷窗、托盘与全局快捷键

**文件：**

- 新建：`src/main/quick-capture-window.ts`
- 新建：`src/main/capture-ipc.ts`
- 新建：`src/main/quick-capture-preload.ts`
- 修改：`src/main/main.ts`
- 修改：`src/main/preload.ts`
- 修改：`src/main/window-config.ts`
- 修改：`src/renderer/bridge/ipc-global.d.ts`
- 修改：`scripts/build-main.mjs`
- 修改：`vite.config.ts`
- 修改：`electron-builder.yml`
- 新建：`quick-capture.html`
- 测试：`tests/main/quick-capture-window.test.ts`
- 测试：`tests/main/window-config.test.ts`
- 测试：`tests/main/packaging-config.test.ts`

### 2.1 RED：生命周期行为

- 快捷窗是单例；重复按快捷键只聚焦，不重复创建。
- `Esc`/关闭只隐藏；明确退出才销毁并注销快捷键。
- 主窗口关闭且“后台运行”开启时驻留托盘。
- 托盘只提供“显示 Leemo / 快速便签 / 退出”。
- 快捷键注册冲突时返回可读失败，不谎称已保存。
- 快捷 preload 只暴露草稿/便签提交、隐藏窗口和设置查询。
- 主进程按 sender 区分主窗口与快捷窗，快捷窗不能调用完整便签管理操作。

### 2.2 GREEN：Electron 原生实现

- 用 `BrowserWindow`、`globalShortcut`、`Tray`、`Menu` 和 `nativeImage`；不引入窗口/托盘库。
- 快捷窗使用独立 Vite entry 与 preload output。
- 新增小尺寸托盘图标资源并纳入打包；不使用字符或 emoji 占位。
- 所有构建临时目录明确落到 E 盘。

### 2.3 验证

```powershell
npx vitest run tests/main/quick-capture-window.test.ts tests/main/window-config.test.ts tests/main/packaging-config.test.ts
npm run build:main
```

---

## Task 3：快捷记录编辑器与草稿恢复

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 新建：`src/renderer/capture/client.ts`
- 新建：`src/renderer/components/CaptureEditor.tsx`
- 新建：`src/renderer/components/CaptureEditor.test.tsx`
- 新建：`src/renderer/quick-capture/QuickCaptureApp.tsx`
- 新建：`src/renderer/quick-capture/QuickCaptureApp.test.tsx`
- 新建：`src/renderer/quick-capture/main.tsx`

### 3.1 依赖与 RED

仅安装同版本的 Lexical 核心、React、rich-text、list、markdown、history 与 utils 包：

```powershell
$env:npm_config_cache='E:\.npm-cache-leemo'; $env:TEMP='E:\Temp\Leemo'; $env:TMP=$env:TEMP
npm install --save-exact lexical @lexical/react @lexical/rich-text @lexical/list @lexical/markdown @lexical/history @lexical/utils
```

先写失败测试证明：

- 本里程碑只展示可工作的“便签”模式；“待办”切换在第二里程碑接入真实 UserTask 后一次上线，不放假入口。
- 标题可选；正文支持粗体、序号、圆点、可勾选清单、引用注释、Tab/Shift+Tab、撤销/重做。
- 输入经短防抖持续保存草稿。
- `Ctrl+S` 提交非空正文并隐藏；空白不生成记录。
- `Esc` 只隐藏；重新打开与整个进程重启后恢复草稿。

### 3.2 GREEN：安静编辑面

- Markdown 是唯一持久化正文；Lexical JSON 只存在编辑器内存中。
- 编辑器不展示 AI 回答、不触发模型、不写 memory。
- 标准动作使用标准文案；不加解释性大卡、庆祝回执或假数据。
- 快捷窗加载失败时保留可复制的当前输入，并给短错误提示。

### 3.3 验证

```powershell
npx vitest run src/renderer/components/CaptureEditor.test.tsx src/renderer/quick-capture/QuickCaptureApp.test.tsx
```

---

## Task 4：完整便签工作面与实时同步

**文件：**

- 新建：`src/renderer/stores/captures.ts`
- 新建：`src/renderer/stores/captures.test.ts`
- 新建：`src/renderer/pages/OrganizerPage.tsx`
- 新建：`src/renderer/pages/OrganizerPage.test.tsx`
- 修改：`src/renderer/stores/ui.ts`
- 修改：`src/renderer/bridge/context.tsx`
- 修改：`src/renderer/components/WorkbenchShell.tsx`
- 修改：`src/renderer/components/WorkbenchActivityRail.tsx`
- 修改相应回归测试。

### 4.1 RED：完整工作面

- 右栏“概览”进入中央工作面，不再把便签塞进狭窄抽屉；文件/搜索仍为右侧工具。
- 工作面先有“今天 / 便签 / 待办”三个稳定入口；本卡完整实现“便签”，“今天/待办”用真实空状态说明即将接入的数据，不伪造内容。
- 便签页能新建、列出、选择、编辑与保存；快捷窗新增后已打开页面实时出现。
- 列表没有数据时保持安静空状态；不存在样例假便签。

### 4.2 GREEN：信息层级

- 用最近日期形成记录脊柱；当前项用单一琥珀色标识。
- 主列与编辑列可在合理最小宽度下工作；不新增无意义卡片、阴影堆叠或状态文字。
- 复用同一个 CaptureEditor，不复制编辑逻辑。

### 4.3 验证

```powershell
npx vitest run src/renderer/stores/captures.test.ts src/renderer/pages/OrganizerPage.test.tsx src/renderer/components/WorkbenchActivityRail.test.tsx
npm run typecheck
npm run build
```

---

## Task 5：设置、真实 Windows 用户路径与收口

**文件：**

- 修改：`src/renderer/stores/settings.ts`
- 修改：`src/renderer/stores/settings.test.ts`
- 修改：`src/renderer/pages/SettingsPage.tsx`
- 修改：`src/renderer/pages/SettingsPage.test.tsx`
- 新建或扩展：快捷记录 CDP/验收脚本与最小研究记录。

### 5.1 设置语义

- “关闭窗口后在后台运行”默认开。
- “开机启动”继续默认关。
- “快速记录快捷键”默认 `Alt+N`，可自定义；只有主进程注册成功才显示保存成功。
- 不在本卡增加复杂快捷键编辑器；捕获常见组合并明确冲突。

### 5.2 真实验收

用隔离 userData 验证：

1. Leemo 前台和隐藏状态下，其他应用中按快捷键均只出现一个快捷窗。
2. 输入后隐藏、再次打开、整进程重启，草稿均恢复。
3. `Ctrl+S` 后完整便签页立即出现记录，重启后仍存在。
4. 关闭主窗口后托盘仍在；“退出”后快捷键不再生效且进程退出。
5. 快捷键冲突、SQLite 写入失败与页面加载失败均可理解、可重试、不丢当前文字。
6. 检查安装资源及启动内存；不把缓存或临时产物写爆 C 盘。

### 5.3 里程碑验证

```powershell
$env:TEMP='E:\Temp\Leemo'; $env:TMP=$env:TEMP; $env:npm_config_cache='E:\.npm-cache-leemo'
npm run typecheck
npm test
npm run build
npm run build:main
git diff --check
```

完成后只做一次独立代码/用户路径评审；修复阻断项后进入第二里程碑：正式待办、批量转换与解析、提醒、附件/存储位置、回收站、`@便签` 和 momo CRUD。
