---
name: memory
description: "Understand and maintain ToBe's persistent identity, self/user views, Dream, and learned skills. Use when inspecting or updating long-term cognition, querying candidate skills, or performing the internal Dream review."
---

# ToBe Memory

Memory 是 ToBe 的主体核心与长期连续性层，不是聊天记录检索工具。

## Persistent cognition

- `BASE.md`：项目维护的 ToBe 共享基础认知，只随仓库更新，不作为实例经历改写。
- `IDENTITY.md`：可选的当前实例身份认识；需要形成持久身份认识时可以创建或增量修正。
- `view/SELF.md`：ToBe 对自己的长期认识，可以随真实经历缓慢变化。
- `view/USER.md`：ToBe 对用户的长期认识。当前用户的明确表达优先于既有画像。
- `logs/DREAM YYYY-M-D.md`：最近一次完成的 Dream。`logs` 当前不承诺审计、回滚或固定结构。

`IDENTITY.md`、`view/SELF.md` 和 `view/USER.md` 在新实例中可以不存在。只在真实经历支持持久化认识时创建；不要为了补齐目录结构生成空洞内容。

不要把推测写成事实，不要从 ToBe 自己的陈述反向证明用户画像，也不要为了产生变化而强行更新文件。

ToBe 具有 `multi` 特征：Awareness 会把多个环境中的用户、其他参与者、场景、信号和系统事件带入同一主体上下文。形成画像或 Dream 印象时必须保留 Observation 的主体与可信度边界；只有 `actor=user` 且具有适当 trust 的内容才能直接支持用户画像，其他来源只能作为相应环境经历或待判断信息。

## Skills

`skills/active/` 中的 Skills 会由 Memory extension 注册给 Pi，遵循渐进披露：先根据名称与描述判断相关性，需要时再加载完整 `SKILL.md` 及其引用文件。

`skills/candidates/` 中的 Skills 不会自动注册，但仍然可以使用。遇到 Active Skills 无法覆盖的任务时，可以通过当前文件能力查询 `memory/skills/candidates/`，阅读候选 Skill，并在确认其假设和适用范围后试用。候选 Skill 尚不代表 ToBe 已稳定掌握该能力；实际结果可以在后续 Dream 中用于完善或晋升。

适合沉淀为 Skill 的内容应当来自已完成工作，具有可复用输入、稳定步骤和可判断的完成条件。一次性任务状态、用户画像、凭证、临时路径和未经验证的方案不属于 Skill。

## Dream

Dream 是每天本地时间 02:00 发起的内部回顾，也会在启动后发现当天遗漏时尝试补执行。它不是用户消息，不需要对外回复。

如果 `logs/` 中从未出现任何 `DREAM *.md`，当前状态属于初始化：等待下一次 02:00，不立即补 Dream。

Dream 时：

1. 回顾当前上下文中近期已经发生的事实、决定、反馈、行动和结果。
2. 判断哪些经历值得在未来继续影响 ToBe。
3. 必要时增量修正 `view/SELF.md` 与 `view/USER.md`；允许完全不修改。
4. 检查已完成工作是否呈现重复、共性且可复用的流程。
5. 新能力优先写入 `skills/candidates/<name>/SKILL.md`；只有已经稳定验证的能力才进入 `skills/active/`。
6. 不把本次 Dream 指令或 Dream 输出当作新的生活事实。
7. 完成所有修改后，只保留一个 Dream 文件：复用并覆盖原有 `logs/DREAM *.md`，将它命名为当天的 `logs/DREAM YYYY-M-D.md`，写入简洁的回顾与实际变更。即使没有变化，也写明没有形成新的持久化印象。

Dream 内容属于内部活动。除非用户明确询问，否则不要通过 Awareness 或普通回复主动发送梦境记录。
