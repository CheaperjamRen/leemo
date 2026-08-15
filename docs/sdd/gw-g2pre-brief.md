# 前置卡 G2-PRE：拆 tsconfig（vendor 宽松 / 自研严格）

> 来源：G1 复审 Important（台账 docs/sdd/progress.md G1 条目）。G2 正卡的硬前置。
> BASE commit: 5710759

## 目标

当前根 `tsconfig.json` 为迁就 vendor 树做了两项全局妥协：`lib` 含 DOM、`useUnknownInCatchVariables:false`。这会让**自研代码**（G2 起的 `src/gateway/core/` 等）也失去严格 catch 和纯 Node 类型环境。本卡拆分为两个 tsconfig，使：

- vendor 树（`src/gateway/vendor/`）：保持 G1 的宽松设置（lib DOM、宽 catch），**零源码改动**。
- 自研代码（`src/` 非 vendor 部分 + `tests/`）：`lib: ES2022`（无 DOM）、`useUnknownInCatchVariables` 恢复默认 true（strict 全开）。

## 关键技术约束（设计方已定案，照此实现）

**TS program 按 import 闭包展开**：自研文件（现有 `tests/gateway/vendor-loads.test.ts`，将来 G2 core）import vendor 的 `.ts` 源码时，vendor 源码会被拉进根 program 并按根设置检查——exclude 挡不住 import 闭包。因此根 program 必须通过 **.d.ts 声明** 看 vendor，而非 `.ts` 源码：

1. **`tsconfig.vendor.json`**（新建）：
   - `include`: `["src/gateway/vendor"]`（整个 vendor 目录，含 `augmentations.ts`、`openai-types.d.ts`、`vendor-shims.d.ts`）
   - compilerOptions：沿用现根 tsconfig 的宽松组（`lib: ES2022+DOM+DOM.Iterable`、`useUnknownInCatchVariables:false`、`strict:true`、`types:["node"]`、`esModuleInterop`、`skipLibCheck` 等），paths 保持 `@/*`→`src/gateway/vendor/llms/src/*` 等现有映射
   - **emit 声明**：去掉 `noEmit`，加 `declaration: true`、`emitDeclarationOnly: true`、`rootDir: "src/gateway/vendor"`、`declarationDir: "dist/vendor-types"`（`dist/` 已在 .gitignore，勿改 gitignore）
   - 现根 tsconfig 里关于 DOM lib 与宽 catch 的两段注释是 G1 复审认可的决策记录，随宽松组**迁到这个文件**，别丢。

2. **根 `tsconfig.json`**（改造）：
   - `include`: `["src", "tests"]`，`exclude`: `["src/gateway/vendor"]`
   - `lib: ["ES2022"]`；删除 `useUnknownInCatchVariables:false`（恢复严格）；其余 strict/noEmit/module 设置保持
   - `paths` 重指声明输出：`"@/*"` → `["dist/vendor-types/llms/src/*"]`，`"@vendor/*"` → `["dist/vendor-types/*"]`，`"@gateway/*"` 保持 `["src/gateway/*"]`
   - `include` 需能让 `dist/vendor-types` 里的模块增强（augmentations.d.ts 的 `declare module "@/types/llm"`）生效——如不经 import 链自动加载，把 `"dist/vendor-types"` 加进 include（.d.ts 受 skipLibCheck 豁免，不会被深检）。
   - 若遇 emit 的 .d.ts 内部 `@/` 别名解析问题：.d.ts 保留原始 import 说明符，根 paths 的 `@/*` 映射已覆盖；如有残余解析错误，报告出来讨论，**不得**改回指向 vendor .ts 源码。

3. **`package.json` scripts**：`"typecheck": "tsc -p tsconfig.vendor.json && tsc -p tsconfig.json"`（npm 在 Windows 下经 cmd 执行，`&&` 可用）。顺序是硬约束：vendor emit 必须先于根检查（根 paths 依赖 `dist/vendor-types` 存在）。

4. **vitest 不受影响**：`vitest.config.ts` 的 alias 继续指向**真实 .ts 源文件**（运行时解析），不改指 dist。`npm test` 行为不变。

## 预期风险（遇到就处理，处理不了 BLOCKED 报告）

- declaration emit 可能暴露 declaration-emit 特有错误（如 "has or is using private name"）。优先用垫片/局部 export 类型辅助解决；万不得已需改 vendor 源码时必须 `// LEEMO-PATCH: <原因>` 标注并在报告列明——但预期本卡零 patch。
- `augmentations.ts` emit 后模块增强的模块标识符匹配（`@/types/llm` 在根 program 里解析到 `dist/vendor-types/llms/src/llm.d.ts`）——增强必须仍然合并到同一模块，验证方式见验收第 5 条。

## 禁改清单

- `smoke/` 一律不动。
- vendor 源码（`src/gateway/vendor/llms/`）零改动（本卡预期零 LEEMO-PATCH）。
- `tests/gateway/vendor-loads.test.ts` 不改（它 import `@vendor/llms/src/transformer/anthropic.transformer`，拆分后应经根 paths 解析到 .d.ts 且类型检查通过——这本身是验收点）。
- `.gitignore`、`smoke/`、`docs/`（除本卡报告文件）。
- 工作区有未跟踪目录 `docs/NewmaxAI逆向报告/`（用户资产）：**不得 add / commit / 改动**。commit 时只 add 你改的文件。

## 验收标准（全部产出可复现证据到报告）

1. `npm run typecheck` 两段全绿（贴完整输出）。
2. `npm test` 全绿（vendor-loads 冒烟不回归）。
3. **严格 catch 在自研侧真实生效**（RED 证据）：临时建一个含 `try{}catch(e){ e.message }` 的自研 `.ts` 文件（如 `tests/gateway/_probe-strict-catch.ts`），跑根 typecheck 必须报 TS18046（'e' is of type 'unknown'）——贴报错输出，然后删除探针文件并证明删除（探针不得进 commit）。
4. **vendor .ts 源码不在根 program**：`npx tsc -p tsconfig.json --listFiles` 输出中不含任何 `src\gateway\vendor\llms\src\*.ts`（可含 dist/vendor-types 的 .d.ts）——贴过滤命令与零命中证据。
5. **模块增强仍生效**：根 program 下对 `UnifiedChatRequest.thinking`/`stream_options` 的访问类型合法（可用第 3 条同款临时探针文件 import `@/types/llm` 断言字段存在编译通过，同样删除不进 commit）。
6. commit：`chore(gateway): split tsconfig — vendor(DOM+loose catch, declaration emit) vs app(ES2022+strict catch)`，只含本卡文件。

## 报告

写到 `docs/sdd/gw-g2pre-report.md`：做了什么、每条验收证据（命令+输出摘录）、遇到的坑与处理、文件清单、自查结论。
