# Host portability and installation

The portable unit is the unchanged `leemo-research/` folder. The behavioral contract is standard Markdown in `SKILL.md`; references, scripts, and assets use relative paths and Python standard library only.

## Install with the bundled script

Run from the skill folder:

```bash
python scripts/install_skill.py claude
python scripts/install_skill.py codex
python scripts/install_skill.py agents
python scripts/install_skill.py <explicit-skills-parent-directory>
```

For a Claude Code project-scoped install that stays with an E-drive workspace, pass that project's skills parent explicitly, for example:

```powershell
python scripts/install_skill.py "E:\your-project\.claude\skills"
```

This installs to `E:\your-project\.claude\skills\leemo-research` and avoids writing the Skill package to the default C-drive user directory.

Preview first with `--dry-run`. Existing destinations are refused unless the user deliberately adds `--force`.

Resolved locations:

- Claude Code: `~/.claude/skills/leemo-research/`
- Codex: `$CODEX_HOME/skills/leemo-research/` when `CODEX_HOME` is set, otherwise `~/.codex/skills/leemo-research/`
- Shared Agent Skills convention: `~/.agents/skills/leemo-research/`
- Explicit parent: `<parent>/leemo-research/`

Claude Code uses `SKILL.md` and ignores `agents/openai.yaml`. Codex may use `agents/openai.yaml` for UI metadata. Other hosts can ignore host-specific metadata while preserving the same core folder.

## Invoke

Use natural-language research requests. On hosts with explicit skill invocation, use `$leemo-research`. The user should not need to name lower-level skills.

Examples:

- “帮我把这个模糊方向收敛成能做的研究问题。”
- “做一份可复现的近五年系统综述，先建立检索协议。”
- “审计这组不显著结果，区分主分析与探索性分析。”
- “根据证据表写讨论，不要补造引用。”
- “继续上次项目，从状态文件恢复。”

## Host capability differences

The skill never assumes a browser, shell, Python, PDF parser, citation manager, subagent, or MCP server exists. Discover capabilities at runtime and use the fallback contract in `capability-adapters.md`.

If a host does not automatically load referenced files, read the reference named by the current mode before acting. Do not preload every reference into a small context window.

If the host cannot execute Python, copy templates manually and maintain state/ledgers directly. If it cannot browse, accept user-provided sources or stop at a reproducible search protocol. If it cannot create a requested file type, deliver a format-neutral source artifact and state the export gap.

## Updating

Keep personal/provider adapters outside the portable core unless their license permits redistribution and their absence does not break the core. When replacing an installed copy, compare or back up local customizations before using `--force`.
