# MindMemOS

## 来源

- 项目：[mindscale-noah/MindMemOS](https://github.com/mindscale-noah/MindMemOS)
- 官网：[mindmemos.cn](https://mindmemos.cn)
- 用户于 2026-08-02 提供，期望评估它对 Leemo 记忆能力的价值。
- 完整只读审计：[2026-08-02-mindmemos-assessment.md](../research/2026-08-02-mindmemos-assessment.md)

## 当前判断

状态：`观察`。

它的混合检索、实体关系、时间理解和反馈学习值得持续关注，但当前实现依赖 Qdrant、Neo4j、Kafka 等服务，资源和运维成本不适合近零预算的桌面 MVP；许可证、版本一致性和中文长期记忆质量也尚未收敛。

MindMemOS 未来最多作为**可重建的召回副索引**：Leemo 的全局/本子边界、来源、时间版本、事实/推断、用户确认、编辑、删除和撤销账本仍是唯一真源。真实用户尚未反复出现语义或多跳召回失败前，不接入、不打包、不上传真实数据。

## 重新评估条件

- 5-10 名内测用户连续使用一到两周后，出现可复现的召回失败；
- 项目补齐可核验许可证并收敛版本；
- 存在真正轻量、可本地运行的模式；
- 隔离 PoC 能显著提高召回，同时跨本子泄漏和旧事实误答为零。
