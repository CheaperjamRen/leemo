# 启动轮 2 · 卡 E：Skills 触发（技术抉择已由主控实证拍板）

基线：main @ `cc735ec`，749 测试绿，`npm run typecheck` 三段 exit 0。
铁律：host/bridge/store 严格 TDD；前端视觉由用户目验。

---

## 一、技术抉择（已实证，**不要重开，也不要"优化"**）

主控跑了四轮真 SDK 探针（真 DeepSeek 端点，读 init 消息的 `skills` / `slash_commands` 数组判定），结论如下。**探针已删，不留仓**；数据写在这里。

### 实测数据

| 组合 | skills 数 | 探针 skill 被发现 |
|---|---|---|
| A `cwd/.claude/skills` + `settingSources:[]`（**我们当前生产配置**） | 15 | ❌ |
| B 同 A + `skills:'all'` | 15 | ❌ |
| C 同 A 但 `settingSources` 省略 | **45** | ✅ |
| D `CLAUDE_CONFIG_DIR/.claude/skills` | 15 | ❌ |
| E `CLAUDE_CONFIG_DIR/skills` | 15 | ❌ |
| F `settingSources:['project']` + cwd 内 skills | 16 | ✅ |
| **G `plugins:[{type:'local',path:<绝对路径>}]` + `settingSources:[]`** | **16** | ✅ |

### 四条硬结论

1. **`settingSources:[]` 会关掉 Skills 发现**（A/B 证明，加 `skills:'all'` 也救不回来）。这正是卡 A 的方案 C 现状 → **Skills 今天完全没在工作**。
2. **Skills 发现与 `CLAUDE_CONFIG_DIR` 无关**（D/E 均失败）。别往那儿放。
3. **C 方案（省略 settingSources）有严重副作用**：skills 从 15 → **45**，把用户个人 `~/.claude/skills` 那 42 个（`grill-me`、`xiaohongshu-*` 等）全拉进 momo 的上下文。**这是隐私与 blast radius 问题，禁用。**
4. **G 方案成立且无污染**：`plugins` 吃绝对路径、与 cwd 无关、`settingSources` 保持 `[]`。

### 拍板 = G

```
plugins: [{ type: "local", path: "<home>/Leemo/.claude" }]
skills:  <启用名单>            // 见 §三
settingSources: []             // 卡 A 方案 C 不动
cwd: sandboxDir                // Phase 0 隔离面不动
```

skills 落 `<home>/Leemo/.claude/skills/<名字>/SKILL.md` —— 正是 06 §3.6 要的位置，用户可见可拖可编辑。

**为什么不选 F**：F 要求 skills 放进 `cwd` = `sandboxDir`（Phase 0 承重隔离），用户看不见也拖不进去；且会把 `.claude/settings.json` + `CLAUDE.md` 的加载语义一并带回，部分推翻卡 A 已拍板的方案 C。G 两条都不碰。

### 探针另外查清的三件事（省你重复踩）

- **`plugin.json` 不是必需**，但没有它插件名会退化成目录名 `.claude`（前缀变 `.claude:xxx`，丑且脆）。→ **必须写** `<home>/Leemo/.claude/.claude-plugin/plugin.json`，`name: "leemo"`。
- **插件目录不存在 = 安全降级**：skills 15、不抛错、聊天照常。→ 首次运行/用户删目录都不会挡住聊天，但仍应主动建目录。
- **触发三条路全部实测可用**（回复 token 命中）：
  | 输入 | 结果 |
  |---|---|
  | `/leemo:zzprobe-trigger …`（带前缀） | ✅ |
  | `/zzprobe-trigger …`（**裸名**） | ✅ |
  | 自然语言 "use the … skill" | ✅（走 Skill 工具） |

  **裸名斜杠命令可用，这是"用户不该感知前缀"的技术基础。** `init.slash_commands` 里仍是 `leemo:zzprobe-trigger`（带前缀）——那是内部标识，不是给用户看的。

---

## 二、用户明确要求：**前缀绝不外泄**

用户原话：「不要让用户感知到 skill 的名字有什么前缀什么的啰嗦的变化，用户让安装什么 skill 那就是叫做什么名字。」

**铁律**：`leemo:` 前缀只允许存在于两处 —— ① 传给 SDK 的 `skills` 数组；② host 内部数据结构的一个字段。**任何用户可见的地方一律裸名**：SkillsPage 卡片、`/` 菜单、chips、momo 提到 skill 时。

具体做法：host 侧规范化一次，向 renderer 只暴露干净结构。

```ts
export interface SkillInfo {
  /** 裸名 = SKILL.md frontmatter 的 name（回退到目录名）。UI 只用这个。 */
  name: string;
  description: string;
  /** 传给 SDK 的限定名，如 "leemo:pdf"。renderer 不许渲染它。 */
  qualifiedName: string;
  /** 绝对路径，给"打开目录"用。 */
  dir: string;
  source: "user" | "builtin";
}
```

写一条测试断言 `SkillInfo.name` 不含 `":"`，把这条铁律钉死。

`/` 菜单选中后往输入框塞 `/<裸名> `（实测裸名可用），用户看见的始终是自己装的那个名字。

---

## 三、交付清单

### 1. `src/host/skills.ts`（新增，纯函数 + IO 注入，严格 TDD）

```ts
export interface SkillsIO {
  readdir(dir: string): string[];
  readFile(path: string): string;
  exists(path: string): boolean;
  mkdirp(dir: string): void;
}
/** 扫 <skillsRoot>/<name>/SKILL.md，解析 frontmatter。 */
export function scanSkills(skillsRoot: string, pluginName: string, io: SkillsIO): SkillInfo[];
/** 建 <memoryDir>/.claude/{.claude-plugin/plugin.json, skills/}，幂等。 */
export function ensureSkillsPlugin(memoryDir: string, io: SkillsIO): void;
```

要求：
- frontmatter 只需 `name` / `description` 两个字段，**自己写个极小解析器**（切 `---` 块 + 逐行 `key: value`），**不要引第三方 YAML 依赖**。
- 坏 SKILL.md（无 frontmatter / 缺 name / 编码坏）**跳过它并继续**，绝不让一个坏文件干掉整个列表。缺 `description` 给空串不跳过。
- 子目录无 `SKILL.md` → 跳过（用户可能放了 README、素材）。
- `ensureSkillsPlugin` 只在文件不存在时写 `plugin.json`；**已存在则一字节不改**（同卡 B 铁律，用户可能自己编辑过）。

### 2. 契约（`src/bridge/contract.ts`，循 Batch -1 只加可选字段/新通道）

- 新 invoke：`bridge:listSkills` → `SkillInfo[]`
- 新 invoke：`bridge:openSkillsDir` → `void`（用 `shell.openPath`，主进程做）
- `CreateConversationRequest` 加可选 `enabledSkills?: string[]`（**限定名数组**，renderer 从 SkillInfo.qualifiedName 取）

### 3. `sdk-adapter.ts` + `bridge-host.ts`

- `ConversationExtras` 加 `pluginPath?: string` / `enabledSkills?: string[]`
- `buildQueryFn`：`pluginPath` 存在时传 `plugins:[{type:'local',path}]`；`enabledSkills` 存在时传 `skills: enabledSkills`
- **注意**：`skills: []`（空数组，用户全关）与 `skills` 省略语义不同 —— 省略 ≠ 关闭（sdk.d.ts:1877 明写）。全关必须传 `[]`，不能省略。为此测试各写一例。
- host 实现两个新通道；`assemble()` 把 pluginPath/enabledSkills 接进 extras
- `HostDeps` 加 `skillsIO`/复用已有 `memoryDir`

### 4. `src/main/main.ts` + `src/host/dev.ts`

启动时 `ensureSkillsPlugin(memoryDir, io)`（紧挨现有 `ensureMemoryBank` 调用），失败只 `console.error`。`bridge:openSkillsDir` 用 `shell.openPath`。

### 5. 记忆库 prompt 补一句（`src/host/momo-prompt.ts`）

层⑥ 的绝对路径段落里，**补上 skills 目录的绝对路径**，并说明：用户要装 skill 时，把 `SKILL.md` 写到 `<memoryDir>/.claude/skills/<名字>/SKILL.md`。

这一句让"用自然语言让 momo 装 skill"立刻可用（momo 已有 Write 且能写沙箱外绝对路径 —— 卡 A 已验证），成本一行，不做就得等下一卡。**≤900 token 预算仍须通过**，超了就压缩措辞。

### 6. renderer

- `src/renderer/stores/skills.ts`（新增 store）：`list: SkillInfo[]`、`disabled: string[]`（**存裸名**，用户视角）、`refresh()`、`toggle(name)`、`openDir()`。派生 `enabledQualifiedNames`。
- `conversations.ts` 的 `resolvePersonaContext` 旁加一个取 `enabledSkills` 的依赖注入口（照 persona 的既有做法），建对话时带上。
- `SkillsPage.tsx`：删 `MOCK_SKILLS`，接真 store；开关接 `toggle`；加「打开技能目录」按钮；空态写清楚「把 SKILL.md 放进 <路径>，或者直接告诉 momo 你想装什么」。
- `/` 命令菜单（新组件 `SlashMenu.tsx`）：输入框内容为 `/` 开头且光标在首词时弹出，列启用的 skills（裸名 + 描述），↑↓ 选、Enter/点击确认 → 输入框替换为 `/<裸名> `，Esc 关闭。**纯展示 + 受控**，逻辑（过滤/键盘导航）抽成可测纯函数。搭子态和工作台态都要接（两边都用 `InputArea`，改一处即可）。
- `ChipRow.tsx`：保留现有 3 个对话启动词，**后面追加**最多 3 个启用 skill 的触发 chip（点击 → 往输入框塞 `/<裸名> `）。零 skill 时就是现在的样子，不会空排。

---

## 四、不做

Skills 市场；本子级 skills；zip 拖入解压安装（下一卡，本卡先支持"目录已就位"和"momo 自己写文件"两条路）；自然语言意图识别（CC 原生，别自研）。

## 五、验收

```
npx vitest run          # 749 → 只增不减，全绿
npm run typecheck       # 三段 exit 0
```

外加**实机**（可复用 `scripts/cdp-*.mjs` 套路，留仓）：
1. 往 `<home>/Leemo/.claude/skills/leemo-test-probe/SKILL.md` 放一个测试 skill（描述里让它回一个仓库搜不到的 token）
2. SkillsPage 列出它，**显示裸名**（不含 `leemo:`）
3. 输入 `/` → 菜单里有它
4. 选中 → 发送 → **momo 真回那个 token**（这条是核心，只证明"列出来了"不算过）
5. SkillsPage 把它关掉 → 新对话里 momo 不再认它

## 六、禁改

`smoke/`；`src/bridge/pool.ts` 的 resume/降级逻辑；`interact.ts` 的审批策略；`HistoryDrawer.tsx`。不要 `git commit`，改完报告。

## 七、报告

需求覆盖表（每项带可复现证据）+ 实机第 4 条 momo 回了什么 + `skills:[]` 与省略的语义差异测试怎么写的 + 任何没做/做不到的事（明确说，别含糊）。
