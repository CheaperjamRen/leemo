# G2-PRE 报告：拆 tsconfig（vendor 宽松 / 自研严格）

> Card: `docs/sdd/gw-g2pre-brief.md` ｜ BASE: 5710759 ｜ 执行会话：设计/验收下派的实现代理
> 结论：**DONE** — `npm run typecheck` 两段全绿、`npm test` 全绿，严格 catch 在自研侧真实生效，vendor `.ts` 源码零进根 program，模块增强仍合并。预期零 LEEMO-PATCH，实测零 vendor 源码改动。

---

## 1. 做了什么

按简报「关键技术约束」实现三处改动，一处不改：

1. **新建 `tsconfig.vendor.json`**（vendor 树专用，宽松组 + 声明发射）
   - `include: ["src/gateway/vendor"]`（整树，含 `augmentations.ts` / `openai-types.d.ts` / `vendor-shims.d.ts`）。
   - 沿用 G1 宽松组：`lib: ES2022+DOM+DOM.Iterable`、`useUnknownInCatchVariables:false`、`strict:true`、`types:["node"]`、`esModuleInterop`、`skipLibCheck`。
   - `paths` 保持指向真实 vendor 源：`@/*`→`src/gateway/vendor/llms/src/*`、`@vendor/*`→`src/gateway/vendor/*`、`@gateway/*`→`src/gateway/*`。
   - 去 `noEmit`，改 `declaration:true` + `emitDeclarationOnly:true` + `rootDir:"src/gateway/vendor"` + `declarationDir:"dist/vendor-types"`。
   - **注释迁移**：G1 复审认可的 DOM-lib 与宽-catch 两段决策注释，从根 tsconfig 原样迁入本文件（并补一句「scoped to vendor only」说明）。

2. **改造根 `tsconfig.json`**（自研严格，Node-only，只读 vendor 声明）
   - `lib: ["ES2022"]`（去 DOM）；**删除** `useUnknownInCatchVariables:false`（恢复 strict 默认 true）；保留 `strict/noEmit/module/moduleResolution/skipLibCheck` 等。
   - `paths` 重指声明输出：`@/*`→`dist/vendor-types/llms/src/*`、`@vendor/*`→`dist/vendor-types/*`、`@gateway/*`→`src/gateway/*`（后者不变）。
   - `include: ["src","tests","dist/vendor-types"]` + `exclude: ["src/gateway/vendor"]`。把 `dist/vendor-types` 纳入 include 是为了让 `augmentations.d.ts`（`declare module "@/types/llm"`）被加载进 program、其 `UnifiedChatRequest` 合并生效（.d.ts 受 skipLibCheck 豁免，不深检）。

3. **`package.json` typecheck 脚本**：`tsc --noEmit` → `tsc -p tsconfig.vendor.json && tsc -p tsconfig.json`（顺序硬约束：vendor 先 emit 声明，根检查依赖 `dist/vendor-types` 存在）。

**未改**：`vitest.config.ts` alias 仍指真实 `.ts` 源（运行时解析，`npm test` 行为不变）；`.gitignore`（`dist/` 已被忽略）；`smoke/`；vendor 源码零改动；`tests/gateway/vendor-loads.test.ts` 零改动。

---

## 2. 验收证据（逐条）

### 验收 1 — `npm run typecheck` 两段全绿（从 clean dist）

```
$ rm -rf dist/vendor-types
$ npm run typecheck

> leemo@0.0.1 typecheck
> tsc -p tsconfig.vendor.json && tsc -p tsconfig.json

typecheck exit: 0
```

vendor 段先把 13 个声明 emit 到 `dist/vendor-types/`（`augmentations.d.ts`、`llms/src/**/*.d.ts`），根段随后严格检查通过。

### 验收 2 — `npm test` 全绿（vendor-loads 冒烟不回归）

```
$ npm test
 RUN  v4.1.10 E:/Leemo
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

`vendor-loads.test.ts` 未改动，仍经 vitest alias 解析真实 `.ts` 并实例化 `AnthropicTransformer` 通过。

### 验收 3 — 严格 catch 在自研侧真实生效（RED 证据）

临时探针 `tests/gateway/_probe-strict-catch.ts`：`try{}catch(e){ return e.message }`。跑根 typecheck：

```
$ npx tsc -p tsconfig.json
tests/gateway/_probe-strict-catch.ts(8,12): error TS18046: 'e' is of type 'unknown'.
---EXIT: 2---
```

**TS18046 如期报出** → 根 program 的 `useUnknownInCatchVariables` 已恢复 strict。随后删除探针：

```
$ rm tests/gateway/_probe-strict-catch.ts
$ ls tests/gateway/_probe-strict-catch.ts
ls: cannot access '...': No such file or directory
```

探针不进 commit（见验收 6 的 git status，`tests/gateway/` 仅剩 `vendor-loads.test.ts`）。

### 验收 4 — vendor `.ts` 源码不在根 program（`--listFiles` 零命中）

```
$ npx tsc -p tsconfig.json --listFiles > /tmp/rootfiles.txt   # 335 files total
$ grep -E "src/gateway/vendor/llms/src/.*\.ts$" /tmp/rootfiles.txt | grep -v "\.d\.ts$"
<无输出>                                   # [exit 1 => 零匹配]
$ grep -E "src/gateway/vendor/(openai-types|vendor-shims|augmentations)" /tmp/rootfiles.txt
<无输出>                                   # [exit 1 => 零匹配：源树被 exclude 挡住]
```

根 program 内唯一含 `gateway/vendor` 子串的路径是测试文件自身 `tests/gateway/vendor-loads.test.ts`；vendor 源 `.ts` 零命中。作为对照，`dist/vendor-types` 下 **13 个 `.d.ts`** 确实进入了根 program（vendor 只经声明可见）。

### 验收 5 — 模块增强仍生效

临时探针 `tests/gateway/_probe-augment.ts`：`import type { UnifiedChatRequest } from "@/types/llm"`，访问增强字段 `req.thinking` / `req.stream_options`（分别来自 reasoning / streamoptions transformer 的增强）。

```
$ npx tsc -p tsconfig.json
---EXIT: 0---                              # 增强字段合法访问，编译通过
```

**负向对照**（证明该类型是真类型、非 `any`、无 index signature，故上面的通过是有意义的）：访问不存在字段 `__no_such_field__`：

```
tests/gateway/_probe-neg.ts(2,53): error TS2339: Property '__no_such_field__' does not exist on type 'UnifiedChatRequest'.
```

→ `UnifiedChatRequest` 无 index signature；`thinking`/`stream_options` 之所以合法，正是因 `dist/vendor-types/augmentations.d.ts` 的 `declare module "@/types/llm"` 在根 program 下合并进了同一 interface 符号（根 `@/*` paths 把 `@/types/llm` 解析到 `dist/vendor-types/llms/src/llm.d.ts`，与增强目标同标识）。两个探针均已删除、不进 commit。

### 验收 6 — commit 只含本卡文件

git status（提交前，只 add 三个代码文件 + 本报告）：

```
 M package.json
 M tsconfig.json
?? tsconfig.vendor.json
?? docs/sdd/gw-g2pre-report.md   (本报告)
-- 未 add：
?? "docs/NewmaxAI逆向报告/"       (用户资产，禁 add)
?? docs/sdd/gw-g2pre-brief.md     (简报=需求输入，非本卡报告文件；留未跟踪交由 owner 决定)
```

`dist/vendor-types/`（emit 产物）被 `.gitignore` 的 `dist/` 规则忽略，不出现在 status，无误提交风险。

commit message：`chore(gateway): split tsconfig — vendor(DOM+loose catch, declaration emit) vs app(ES2022+strict catch)`

---

## 3. 遇到的坑与处理

- **import 闭包 vs exclude**：预判正确——`exclude` 无法阻止根文件 `import` 把 vendor `.ts` 拉进 program。解法即简报设计：vendor 只经 `dist/vendor-types/*.d.ts` 暴露，根 `paths` 全部重指声明目录。验收 4 证实 vendor 源 `.ts` 零进根 program。
- **augmentation 标识匹配**：`augmentations.d.ts` emit 后仍为 `declare module "@/types/llm"`；根 `@/*` → `dist/vendor-types/llms/src/*` 使 `@/types/llm` 解析到 emit 的 `llm.d.ts`，增强合并到同一符号（验收 5 + 负向对照双证）。
- **声明发射错误**：预期风险（"has or is using private name" 等）**未出现**，vendor 段 emit exit 0，零 LEEMO-PATCH、零 vendor 源码改动。
- **ambient 声明可见性**：vendor 的 `openai-types.d.ts` / `vendor-shims.d.ts` 是 vendor 段的 ambient 依赖；emit 的 `llm.d.ts` 保留 `import ... from "openai/resources/chat/completions"` 原始说明符——因 `openai` 未安装且 `skipLibCheck` 生效，根 program 对该说明符不深检、`vendor-loads` 冒烟与两段 typecheck 均通过，无残留解析错误。未改回指向 vendor `.ts`。

---

## 4. 文件清单

| 文件 | 动作 |
|---|---|
| `tsconfig.vendor.json` | 新建（vendor 宽松 + 声明发射，含迁移注释） |
| `tsconfig.json` | 改造（自研严格：lib ES2022、删宽 catch、paths 重指 dist、include dist/vendor-types、exclude vendor） |
| `package.json` | typecheck 脚本改双段 |
| `docs/sdd/gw-g2pre-report.md` | 本报告 |
| `tests/gateway/_probe-strict-catch.ts` | 临时探针，已删（不进 commit） |
| `tests/gateway/_probe-augment.ts` | 临时探针，已删（不进 commit） |
| `tests/gateway/_probe-neg.ts` | 临时负向对照，已删（不进 commit） |
| `dist/vendor-types/**` | emit 产物，gitignore 忽略（不进 commit） |

**未改动**：`vitest.config.ts`、`.gitignore`、`smoke/`、`src/gateway/vendor/llms/**`（vendor 源）、`tests/gateway/vendor-loads.test.ts`。

---

## 5. 自查结论

- **完整性**：验收 1–6 全部有可复现证据；三个探针均已删除、不在 commit。
- **纪律**：vendor 源码零改动（零 LEEMO-PATCH）；`vitest.config.ts` alias 语义未动（仍解析真实 `.ts`）；`.gitignore` 未动；未 add 用户资产 `docs/NewmaxAI逆向报告/`。
- **质量**：G1 两段决策注释完整迁入 `tsconfig.vendor.json`；根/vendor 两配置均加了说明性注释。
- **待 owner 决定的一点**：`docs/sdd/gw-g2pre-brief.md`（本卡简报=需求输入）当前未跟踪。按禁改清单「docs/（除本卡报告文件）」，我未擅自提交它；如需入库请 owner 单独处置。

**Status: DONE**
