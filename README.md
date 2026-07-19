# Leemo

AI companion & workbench built on Claude Agent SDK（人格：momo）。

- 设计文档：`docs/specs/06-Leemo-产品设计文档-v1.0.md`（权威）
- 决策宪法：`docs/specs/02-已定决策清单.md`
- 当前阶段：Phase 0 可行性验证（`docs/plans/2026-07-19-phase0.md`）

## Phase 0 smoke

1. `copy .env.example .env`，填入各家 API Key（.env 已 gitignore，永不提交）
2. `npm run smoke -- --provider deepseek --check all`
3. 报告见 `docs/reports/phase0-report.md`
