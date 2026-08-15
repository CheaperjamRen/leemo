# momo 认识你 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给搭子态增加一个可跳过、可重复进入的“和 momo 认识一下”关系仪式，并让确认后的长期信息沿用现有记忆治理层落盘。

**Architecture:** 关系仪式复用普通全局对话，不创建第二套画像数据库或独立聊天协议。渲染层只负责创建或恢复专属对话并发送一条不向用户暴露的启动指令；默认启用的 Leemo Skill 负责一问一答、整份确认和调用现有记忆工具。

**Tech Stack:** React 19、Zustand、TypeScript、Vitest、Testing Library、Leemo bundled Skills。

## Global Constraints

- 以 `docs/specs/02-已定决策清单.md` I4-I7 为产品真源。
- 普通界面不出现底层引擎、协议、环境变量或内部工具名。
- 可跳过但不失联：首轮轻邀请可关闭，搭子态顶部始终保留入口。
- 每次只问一个高信息量问题；支持选项、自由输入和拒绝回答。
- 附件只作为理解材料，不把原文整份写入长期记忆。
- 先展示整份理解，用户确认后才把明确、耐久、非敏感的信息写入现有记忆治理层。
- 不修改或提交当前工作区已有的 Office 相关改动。

---

### Task 1: 关系仪式状态与启动指令

**Files:**
- Create: `src/renderer/stores/relationship-onboarding.ts`
- Create: `src/renderer/stores/relationship-onboarding.test.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`

**Interfaces:**
- Produces: `buildRelationshipOnboardingPrompt(): string`、`findRelationshipConversation(...)`、持久化的邀请关闭状态与专属对话 ID。

- [x] **Step 1: 写失败测试**：锁定启动指令不泄露内部名、要求一次一问/整份确认/确认后记忆，以及设置状态的校验、投影和重启恢复。
- [x] **Step 2: 运行 `npm test -- src/renderer/stores/relationship-onboarding.test.ts src/renderer/stores/settings.test.ts`，确认因接口不存在而失败。**
- [x] **Step 3: 最小实现纯函数与设置字段。**
- [x] **Step 4: 重跑聚焦测试并确认通过。**

### Task 2: 搭子态的轻邀请与常驻入口

**Files:**
- Modify: `src/renderer/components/TopBar.tsx`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/renderer/components/BuddyShell.test.tsx`

**Interfaces:**
- Consumes: Task 1 的纯函数和设置字段。
- Produces: 空状态轻邀请、顶部常驻入口、创建/复用/失败重试的专属全局对话。

- [x] **Step 1: 写失败测试**：锁定“稍后再说”只隐藏邀请、不移除常驻入口；首次点击创建并发送；再次点击复用；发送失败可重试且不复制对话。
- [x] **Step 2: 运行 `npm test -- src/renderer/components/BuddyShell.test.tsx`，确认因入口缺失而失败。**
- [x] **Step 3: 最小实现 UI 与发送路径；用户时间线只显示“和 momo 认识一下”。**
- [x] **Step 4: 重跑聚焦测试并确认通过。**

### Task 3: 默认启用的一方认识流程 Skill

**Files:**
- Create: `bundled-skills/default-enabled/meet-momo/SKILL.md`
- Modify: `bundled-skills/catalog.json`
- Modify: `tests/host/bundled-skills.test.ts`

**Interfaces:**
- Produces: `/meet-momo`，负责关系定位、个性风味、当前处境、近期目标、合作偏好、边界、整份确认和受治理记忆写入。

- [x] **Step 1: 写失败测试**：目录可发现、默认启用、展示名与来源正确。
- [x] **Step 2: 运行 `npm test -- tests/host/bundled-skills.test.ts`，确认因新 Skill 不存在而失败。**
- [x] **Step 3: 写入高信息密度 Skill 与 catalog 元数据，不增加运行依赖或大文件。**
- [x] **Step 4: 运行聚焦测试与 `npm run verify:bundled-skills`。**
- [x] **Step 5: 运行 `npm run typecheck`、`npm test -- --reporter=dot`、`npm run build`，检查工作区只包含本卡文件和原有 Office 改动。**
