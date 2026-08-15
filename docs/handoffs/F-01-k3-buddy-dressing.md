# F-01 · K3 穿衣卡：搭子模式首屏视觉层（buddy shell dressing）

> **角色**：你是 K3——Leemo 的前端视觉层执行者。
> **边界（红线，先记住）**：本卡只做**视觉**。骨架的结构、数据流、props 签名、事件处理、store/reducer、测试**全部已冻结且正确**，你**绝不**碰。你只上色、上动效、上间距、上图标，让已搭好的组件长成视觉基准 HTML 的样子。
> **自包含**：本卡列全了你要读、要改、不许碰的文件；无需了解其它项目背景。

---

## 0. 一句话任务

把 K3 试镜定稿的视觉语言，填进**已经搭好并通过验收**的 React 骨架组件里。骨架现在用的是朴素占位视觉（emoji 图标、灰边框、无动效）；你要把它变成 `docs/design-audition/k3/buddy-mode.html` 那个"早晨、安静、被照顾着"的暖白搭子首屏——但**只改视觉，一行结构/逻辑都不动**。

---

## 1. 先读这些文件（按顺序）

| 用途 | 路径 |
|---|---|
| **视觉基准**（你逐项照抄的对象） | `docs/design-audition/k3/buddy-mode.html` |
| 设计 token（颜色已全量就位，照抄用） | `src/renderer/design/tokens.css` |
| 全局样式入口 | `src/renderer/index.css` |
| 你要穿衣的骨架组件 | `src/renderer/components/*.tsx` 及 `src/renderer/components/momo/MomoAvatar.tsx` |

读基准 HTML 时，重点抄它的 `<style>` 段（keyframes、grain、阴影、chip/icon-btn hover）和每个区块的 class 组合与精确数值（间距/圆角/字号/字距）。

---

## 2. 产品语境（认真读，决定你像不像"懂这个产品"）

**Leemo** 是基于 Claude Code 引擎的个人 AI 工作台+搭子，面向中国泛年轻人（大学生为首发人群）。内置 AI 人格叫 **momo（默默）**——懂你的学长/学姐气质：会聊天有陪伴感、干活干净利落。名字含义是"事情默默就位"，**不是**沉默寡言。

**视觉总纲：冷工具 + 暖人格。** 工具的部分（布局、结构线）越冷静越好；人格的温度只允许通过 momo 头像、语气文案、完成时刻的微光效透出来。**禁廉价 AI 感**：不要紫蓝渐变大色块、不要玻璃拟态滥用、不要圆角气泡堆砌。搭子模式的气质 = 暖白纸感 + 克制的琥珀点缀 + 大量留白。

**名词纪律**：界面只出现 **Leemo / momo**；禁止出现"幸运鹿 / Lulu / LuckyDeer"，也别引入 Topic/Workspace/Agent 等词。

---

## 3. 技术底座（和试镜不同，务必看）

试镜时你用的是 Tailwind CDN + 单 HTML 内联。**这次不一样**：

1. 项目是 **Tailwind 4**（`@tailwindcss/vite` 插件）+ `tokens.css`，不是 CDN。类名任意值语法照常用：`bg-[var(--leemo-card)]`、`text-[var(--leemo-ink-3)]`、`rounded-[24px]` 等直接写在 `className` 里即可，无需配置。
2. **颜色变量前缀变了**：K3 稿里的 `var(--foo)` → 本项目一律 `var(--leemo-foo)`（一一对应，见 §4 映射表，token 已全量就位，不用你新增颜色）。
3. 骨架里现在有些地方用了 **inline `style={{ ... }}`**（如 `style={{ borderColor: "var(--leemo-line)" }}`）。你**可以**把它们改写成等价的 Tailwind 任意值类名——这是**允许且鼓励**的视觉改动，因为只有类名才能挂 `hover:` / `focus-within:` / `transition` 态。改写时颜色值保持等价。
4. **keyframes / 工具类放哪**：新建 `src/renderer/design/effects.css`，把 K3 `<style>` 里的动画与工具类（见 §5.1）搬进去；然后在 `src/renderer/index.css` 里、`@import "./design/tokens.css";` 那行**之后**，加一行：
   ```css
   @import "./design/effects.css";
   ```
   （`@import` 必须在 `body {}` 规则之前，紧跟 tokens 那行即可。）

---

## 4. 颜色映射表（K3 → Leemo，token 已就位）

K3 `<style>` 的 `:root` 与本项目 `tokens.css` 一一对应，只是加了 `leemo-` 前缀：

| K3 变量 | Leemo 变量 | 值 |
|---|---|---|
| `--bg` | `--leemo-bg` | `#FAF6EE` |
| `--bg-deep` | `--leemo-bg-deep` | `#F2EBDC` |
| `--card` | `--leemo-card` | `#FFFEFB` |
| `--ink` / `--ink-2` / `--ink-3` | `--leemo-ink` / `-ink-2` / `-ink-3` | `#2D2822` / `#6E6559` / `#A89D8E` |
| `--line` / `--line-soft` | `--leemo-line` / `-line-soft` | `#E9E0CE` / `#F0E8D8` |
| `--amber` / `--amber-strong` / `--amber-soft` / `--amber-glow` | `--leemo-amber` / `-amber-strong` / `-amber-soft` / `-amber-glow` | `#C07E1F` / `#A2660F` / `#F7E9CC` / `#EFCF9A` |
| `--danger` | `--leemo-danger` | `#DE524C` |
| `--momo-body` / `-line` / `-face` / `-blush` / `-spark` / `-hi` | `--leemo-momo-body` / `-line` / `-face` / `-blush` / `-spark` / `-hi` | 见 tokens.css |

阴影用的 `rgba(96,74,38,…)` 不是 token，照抄字面值即可（见 §5.1 阴影工具类）。

---

## 5. 逐组件穿衣清单

> 每个组件：**保留全部现有 props、事件、hooks、条件分支、文案锚点**（见 §7 红线），只动 `className` / inline style→类名 / 补装饰性子元素（图标 SVG、光晕层）。

### 5.1 全局层 —— `src/renderer/design/effects.css`（新建）+ `index.css`（加一行 import）+ `BuddyShell.tsx`（装饰层）

**effects.css 内容**（从 buddy-mode.html `<style>` 搬运、改前缀）：
- `.grain`：纸面颗粒（照抄 K3 的 feTurbulence data-URI，`opacity:.032; mix-blend-mode:multiply`）。
- keyframes：`rise`（淡入上移）、`breathe`（呼吸）、`halo`（光晕脉动）、`blink`（眨眼）、`tw`（星光 twinkle）——**类名加 `leemo-` 前缀**（`.leemo-rise` / `.leemo-breathe` / `.leemo-halo` / `.leemo-blink` / `.leemo-twinkle`），避免和 Tailwind 撞名。
- `.serif`：`font-family:"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif;`（开场白用）。
- `::selection { background:var(--leemo-amber-soft); color:var(--leemo-amber-strong); }`
- 阴影工具类：`.leemo-card-shadow` / `.leemo-card-shadow-hover` / `.leemo-input-shadow`（照抄 K3 三条 box-shadow 字面值）。
- chip / icon-btn 的 hover 也可做成工具类，或直接在组件里用 Tailwind `hover:` 写——你选一种，别重复。
- **`prefers-reduced-motion:reduce` 分支**：关闭 `rise/breathe/halo/blink/twinkle` 的 animation，且**必须把 `.leemo-rise` 和光晕层的静止态设成 `opacity:1`（可见）**——绝不能让"关动效"变成"内容不可见"。

**index.css**：在 tokens.css import 之后加 `@import "./design/effects.css";`（仅此一行）。

**BuddyShell.tsx 的装饰层**（允许改动，见下）：K3 在 `<body>` 里有两个全屏固定装饰层——晨光径向渐变 + grain。请在 `BuddyShell` 返回的最外层 `<div>` 内、**现有功能子组件之前**，加这两个 `aria-hidden` 的 `pointer-events-none fixed inset-0` 装饰 div（晨光用 `radial-gradient(880px 400px at 50% -10%, ...amber-glow .42→0)`，grain 用 `.grain` 类），并给承载真实内容的部分套一层 `relative z-10` 使其浮在装饰层之上。
**约束**：只加这两层装饰 div + 一个 z-10 包裹；`TopBar/Greeting/ChipRow/InputBox/LightArtifactCard/PinFootnote/HistoryDrawer/MessageList` 的**顺序、props、`hasMessages` 三元分支、`send/draft/drawer` 接线一律不动**。

### 5.2 TopBar —— `src/renderer/components/TopBar.tsx`
对照 K3 顶栏：
- 把 emoji（☰ / 🫧 / ⚏ / 🔔）替换成 K3 的**内联 SVG 线性图标**（historyPanel / chat / board / bell，直接从 buddy-mode.html 的 `<symbol>` 抄 path，内联进按钮即可）。
- 中央做 K3 的**胶囊模式切换器**（搭子高亮 / 工作台次要），暖白胶囊 + 细边 + 轻阴影 + backdrop-blur。工作台项现在无跳转逻辑，做成视觉次要态（`text-[var(--leemo-ink-3)]` + hover）即可，**不要加路由/onClick 逻辑**。
- 铃铛未读小红点：保留 `unread > 0` 条件，红点加 `ring-2 ring-[var(--leemo-bg)]`（K3 样式）。
- 顶栏可改为 K3 的 `fixed inset-x-0 top-0 z-20 h-16`（若改 fixed，记得主区留出 `pt-` 顶距，别让内容被盖住）。
- **保留**：`onClick={onOpenHistory}`、`aria-label="历史对话"`、通知按钮 `aria-label={\`通知，${unread} 条未读\`}` 模板、`useNotifications` 订阅。

### 5.3 Greeting —— `src/renderer/components/Greeting.tsx`
- momo 头像下方开场白 `<h1>` 加 `.serif` + K3 的字号/行高/字距（`text-[22px] leading-[2.05]`、居中、`max-w-[600px]`）与 `.leemo-rise`（带 animation-delay）。
- 日期条（K3 顶部那句"4月16日 · 周四 · 早上好"，`text-[12px] tracking-[.22em] text-[var(--leemo-ink-3)]`）——骨架当前没有这行；**可选**加一个纯静态展示行，但**不要接任何日期 store/逻辑**，写死占位文案即可（属视觉装饰）。若不确定就跳过，别自造数据源。
- **保留**：`{buildGreeting(hour, memory)}` 调用原样（开场白文本来自 store，**不许硬编码替换**）、`data-persona={persona}` 属性、`useSettings` 订阅、`MomoAvatar size={96}`。

### 5.4 MomoAvatar —— `src/renderer/components/momo/MomoAvatar.tsx` ⭐（含头像对比度修复，见 §6，最重要）
把骨架的静态简笔脸，补齐成 K3 buddy-mode.html 里那只完整的 momo，并加动效：
- 补齐 K3 的 SVG 细节：投影 ellipse、头部高光 ellipse（`momo-hi`，rotate -16）、眼睛高光小圆点、腮红、微笑弧（骨架已有腮红和嘴，眼睛需补高光）、右上**星光 spark**（`momo-spark` 的四角星 path）。
- 动效：眼睛组包成 `<g class="leemo-blink">`（眨眼）、星光加 `.leemo-twinkle`、整只 momo 包一层 `.leemo-breathe`（呼吸）。
- **光晕底座**：见 §6（这是用户点名的对比度修复，必须做）。
- **保留**：props 签名 `{ size?: number }`、`aria-label="momo 的头像"`、`role="img"`、viewBox `0 0 120 120`（这样 `size` 缩放继续对所有调用点生效）。动效/光晕的实现要能在 `size=96`（Greeting）和 `size=26`（MessageList）两种尺寸下都正确缩放。

### 5.5 LightArtifactCard —— `src/renderer/components/LightArtifactCard.tsx`
对照 K3 的轻产物卡：`.leemo-card-shadow` + `bg-[var(--leemo-card)]` + `border-[var(--leemo-line)]` + `rounded-2xl`，左侧 `📄` 换成 K3 的圆角琥珀底 doc 图标块（`bg-[var(--leemo-amber-soft)] text-[var(--leemo-amber)]`），右侧补"去工作台查看 →"的琥珀提示（**纯视觉，不加跳转 onClick**），整卡 `hover:-translate-y-0.5` + hover 阴影 + `.leemo-rise`。
- **保留**：`{title}` / `{subtitle}` 两个 props 的渲染、`truncate`。

### 5.6 ChipRow —— `src/renderer/components/ChipRow.tsx`
三个 chip 换成 K3 chip 样式：半透明卡底 + `backdrop-blur` + 细边 + K3 `.chip:hover`（边框/文字转琥珀、底色 amber-soft）；每个 chip 左侧加对应 K3 图标（cal / book-open / coffee 内联 SVG）。
- **保留**：`CHIPS` 三条文案、`onClick={() => onPick(c)}` 事件、`onPick` prop。

### 5.7 InputBox —— `src/renderer/components/InputBox.tsx`（**className only**）
- 外层容器换 K3 输入区样式：`rounded-[24px]` + `bg-white` + `.leemo-input-shadow` + **focus 环**（`focus-within:border-[var(--leemo-amber)] focus-within:ring-4 focus-within:ring-[var(--leemo-amber-soft)]/50` + `transition`）。
- input 加 `caret-[var(--leemo-amber)]` + K3 占位符灰 + 字号。
- 发送按钮：`bg-[var(--leemo-amber)] hover:bg-[var(--leemo-amber-strong)]` 圆钮，`↑` 可换 K3 的 arrow-up 内联 SVG。
- 🔴 **只改 className / 图标**。**绝不碰** `composing` state、`onCompositionStart/End`、`onKeyDown`、`submit()`、props 签名、`placeholder="跟 momo 说点什么…"`（一字不改，测试锚这句）。

### 5.8 PinFootnote —— `src/renderer/components/PinFootnote.tsx`
`📌` 换 K3 的 pin 内联 SVG（`text-[var(--leemo-amber)]/70`），文字 `text-[12px] text-[var(--leemo-ink-3)]`，居中带 gap。**保留** `{text}` prop 渲染。

### 5.9 MessageList —— `src/renderer/components/MessageList.tsx`（轻上色，别过度）
buddy-mode.html **没有**对话流视图，所以这里**没有逐像素基准**。你只做**token 一致性的轻上色**：用户气泡用暖底（`bg-[var(--leemo-bg-deep)]` 已在用，保持）、momo 行文字用 `--leemo-ink`、圆角/间距和暖白基调协调即可。**完整的消息展示卡视觉（工具卡/计划卡/流式态）是 slice-2，本卡不做，别自造。**
- **保留**：`messages.map`、`m.role` 分支、`{m.text}`、`{m.streaming && …}` 光标、`MomoAvatar size={26}`、`useConversations` 订阅。

### 5.10 HistoryDrawer —— `src/renderer/components/HistoryDrawer.tsx`
抽屉上色：侧板 `bg-[var(--leemo-bg-deep)]`（已在用）→ 可提为暖白卡质感 + 细边 + 阴影；搜索框、列表项 hover、设置入口按 K3 暖白体系上色；遮罩保持。
- **保留**：`open` 早返回、`role="search"`、`aria-label="搜索对话"`、`q` 过滤逻辑、`onClose`、`onKeyDown` Escape。

---

## 6. 头像对比度修复（硬需求 · 用户点名 · 单列强调）

**问题**：momo body 是 `#FFF8EA`，几乎和搭子底色 `#FAF6EE` / 侧栏冷灰 `#F6F6F7` 一样亮；头部描边（`momo-line #E7D9BC`，viewBox 里 2.5px）在缩小后近乎消失。结果头像"陷进"背景里，**26px 尤其糊成一团**。

**修法（方向已定 = 光晕底座）**：给 MomoAvatar 加一个**圆形浅色衬底 / 光晕底座**——即把 K3 的 `.halo`（`radial-gradient(closest-side, rgba(239,207,154,.6→0))`，即 `--leemo-amber-glow` 暖调）**系统化进组件**，作为头像的一部分，随所有 `size` 缩放。让 momo 的浅色轮廓坐在一圈略暖、略有存在感的光晕上，silhouette 就能从背景里"浮"出来。可复用 `--leemo-momo-spark` / `--leemo-amber-glow` 暖调，径向渐变向外淡出。可同时挂 `.leemo-halo` 脉动动效（呼应 K3）。

**验收标准（用户会目验这条）**：
- 头像轮廓在**两种底色**（`#FAF6EE` 搭子主区 / `#F6F6F7` 冷灰侧栏）下都**一眼可辨**；
- **尤其 `size=26`**（MessageList 里的小头像）不能糊。

**禁忌**：
- ❌ 不许用**硬边框**（描边加粗/加深）来解决——要柔和光晕，不要生硬轮廓；
- ❌ 不许压暗 momo body 本色（`#FFF8EA` 不变）；
- ❌ 不许改动脸部结构、呼吸、眨眼；
- ❌ `prefers-reduced-motion` 下光晕**静止态仍须可见**（对比度是常态需求，不能只在动画峰值出现）。

---

## 7. 禁改清单（红线，越界即返工）

**绝对不许碰的文件 / 目录：**
- 任何 `*.test.ts` / `*.test.tsx` 文件（尤其 `components/guard.test.ts`、`components/BuddyShell.test.tsx`）。
- `src/renderer/stores/**`（store / reducer）。
- `src/renderer/bridge/**`（端口 `client.ts` / `context.tsx` / `fixture-client.ts`）。
- 任何 `tsconfig*.json` / `vite.config.ts` / `package.json`。

**每个组件内绝对不许改的东西：**
- 任何 **props 签名**、事件处理函数、`useState` / `useConversations` / `useSettings` / `useNotifications` 调用、条件分支（如 `hasMessages`）。
- **不得** `import` `bridge/client` 或 `bridge/fixture-client`（`guard.test.ts` 扫描文件，会 fail-red）。
- 组件只经现有 hooks 读数据，**不得**新增任何数据获取 / 副作用 / 定时器 / 路由。

**不许改的文案 / 契约锚点**（测试锚在这些上）：
- `Greeting` 的 `{buildGreeting(hour, memory)}` 调用（开场白来自 store，**不许硬编码替换**）。
- `InputBox` 的 `placeholder="跟 momo 说点什么…"`（一字不改）。
- `TopBar` 历史按钮 `aria-label="历史对话"`、通知 `aria-label` 模板、`unread` 徽标条件。
- `HistoryDrawer` 的 `role="search"` + `aria-label="搜索对话"`。
- `MomoAvatar` 的 `{ size?: number }` 与 `aria-label="momo 的头像"`。
- `MessageList` 渲染 `{m.text}` / `{m.streaming}` 的逻辑。

**名词纪律**：界面只出现 Leemo / momo；禁"幸运鹿 / Lulu / LuckyDeer"。

---

## 8. 交付前自检（你自己跑，证据附进报告）

1. **视觉自检（截图）**：`npm run dev` 起本地（Vite，默认 5173），用 Playwright 截图：
   - 搭子首屏空态整屏（对照 buddy-mode.html 逐项核：纸面颗粒 grain / 晨光径向渐变 / momo 呼吸 breathe + 眨眼 blink + 星光 twinkle + **光晕 halo** / 卡片阴影 / chip hover / 输入框 focus 环 / 精确间距圆角 / serif 开场白）；
   - **momo 头像对比度专项**：`size=96` 与 `size=26` 两种、放在 `#FAF6EE` 与 `#F6F6F7` 两种底色上各截一张，证明轮廓都可辨（§6 验收）。
2. **测试必须仍全绿**：`npm test` → **234 passed**（这是"你没动过结构"的硬证据；只要红了就是越了红线，回去改）。其中 `components/InputBox.test.tsx` 的 IME composition-gate 两条由验收方预置，锁 InputBox 逻辑——你对 InputBox 只改 className，这两条就会保持绿；一旦红，说明你动了不该动的逻辑。
3. **类型三段全绿**：`npm run typecheck`（三条 tsc 命令依次 exit 0）。

---

## 9. 交付格式

- 只改本卡 §5 列出的组件文件 + 新建 `src/renderer/design/effects.css` + `index.css` 加一行 `@import`。**不改任何其它文件**。
- 产出一份**简短** self-check 报告（列出：改了哪些文件、Playwright 截图路径、`npm test` 与 `npm run typecheck` 的结果行）。
- **不要**写长篇说明文档，不要解释设计理念——干活 + 证据即可。
