# Leemo 打包技能入口

这个目录只供 Leemo 产品维护者在发布前精选技能，不是终端用户的技能目录，也不是在线 Skill Hub。

- `default-enabled/<skill>/SKILL.md`：随安装包提供，新用户首次安装时默认启用。
- `optional/<skill>/SKILL.md`：随安装包提供，新用户首次安装时默认关闭，可在技能中心按需启用。
- `catalog.json`：为已精选技能补充来源、分类、版本、许可证和可选的 `setupMessage`；声明前置条件时，技能仍可被发现，但技能中心会诚实提示需要的本机运行时或账号授权。没有条目的合法 Skill 仍可自动发现。
- `office/`：Office 离线能力的独立运行包，不属于上述两个选品入口。

把一个完整的 Skill 文件夹直接粘贴进对应入口即可。目录名是稳定身份；后续不要随意改名，否则已安装用户会把它视为一个新 Skill。每个直接子目录必须包含带 `name` 和 `description` 的 `SKILL.md`。

发布前运行：

```powershell
npm run verify:bundled-skills
```

校验会拒绝缺失或非法 frontmatter、重名、符号链接、依赖缓存、Python 缓存、超大单文件和悬空 catalog 条目。不要把 `.git`、`node_modules`、`__pycache__` 或构建产物粘贴进来。

安装后，Leemo 会把这些来源合并成一个只读的内置技能库；“默认启用/按需启用”只是首装策略，不会成为用户可见的两套目录。用户自己安装的 Skill 以及后续开关选择由工作区的 `.leemo/skills` 和 Leemo 设置保存，升级不会被这里的目录位置覆盖。
