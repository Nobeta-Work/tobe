# Memory

Memory 是 ToBe 的主体核心和长期连续性模块，当前以 Pi extension 加载。第一版采用完全基于文件的实现，不提供数据库存储、Memory tools、权限控制或日志一致性承诺。

## 结构

```text
memory/
├── index.ts                     # Pi extension 入口、认知注入、Skill 发现与 Dream 调度
├── BASE.md                      # 项目维护的 ToBe 共享基础认知
├── IDENTITY.md                  # 可选的实例身份认识（不受 Git 跟踪）
├── SKILL.md                     # 面向 Agent 的 Memory 使用契约
├── README.md                    # 模块说明
├── view/
│   ├── SELF.md                  # 可演化的自我认识
│   └── USER.md                  # 对用户的长期认识
├── skills/
│   ├── active/                  # 自动注册给 Pi 的稳定 Skills
│   └── candidates/              # 可查询、可试用但尚未稳定的候选 Skills
└── logs/
    └── DREAM YYYY-M-D.md        # 只保留最近一次完成的 Dream
```

## 认知加载

每次 Agent turn 开始前，extension 重新读取 `BASE.md`、`IDENTITY.md`、`view/SELF.md` 和 `view/USER.md`，并加入 Pi 已有 system prompt：

- BASE 是必需的项目基础认知；IDENTITY、SELF 和 USER 是可选的实例文件；
- 实例认知覆盖冲突的临时角色描述；
- Pi Agent Core 原有工具能力、运行信息和协议仍然保留；
- 不存在或为空的可选实例文件不会注入占位内容；
- 文件更新会在下一次 turn 自动生效，不要求重启。

## Skills

`resources_discover` 会注册模块自身的 `SKILL.md` 和 `skills/active/`。Active Skills 会进入 Pi 的 Skill 发现机制，但完整内容仅在相关时加载。

Dream 期间新建或移动到 `active/` 的 Skill，会在 Pi 下一次 resources reload 或重新启动时进入发现列表；第一版不为此自动重载当前运行中的 Agent。

Candidates 不注册为普通 Pi Skills。Agent 可以依据 Memory Skill 的说明，通过文件查询进入 `skills/candidates/` 阅读和试用。这表示“可以参考尚未稳定的经验”，而不是宣称已经掌握。

每个 Skill 应使用标准目录：

```text
skills/active/<name>/
├── SKILL.md
├── scripts/       # 可选
├── references/    # 可选
└── assets/        # 可选
```

## Dream

Dream 由 extension 按宿主机本地时间每天 `02:00` 尝试触发。它通过 Pi custom message 以内部 Agent turn 运行：

- Agent 空闲时立即开始；
- Agent 正忙时以 follow-up 排队，不中断当前工作；
- 全新实例没有任何 `DREAM *.md` 时只安排下一次 02:00，不补执行无经历可回顾的 Dream；
- 已存在 Dream 历史时，启动会检查最近一个已经到期的 02:00；对应日期不存在非空 Dream 文件时尝试补执行；
- 例如在凌晨 02:00 前启动，会先检查前一天的 Dream，同时继续等待当天 02:00；
- 完成后安排下一次本地时间 02:00。

完成标志是 `logs/DREAM YYYY-M-D.md` 的日期与非空内容。Dream 只保留一个文件：Agent 在完成回顾和修改后复用、改名并覆盖旧 Dream。第一版不承诺 Dream 日志的固定格式、完整审计、回滚或精确会话游标。

Dream 只基于 Agent 当前可见的会话上下文、压缩摘要和实际文件结果形成印象，不额外建立历史数据库。它允许没有画像变化、没有新 Skill 的结果。

## 当前边界

第一版不包含：

- Memory function tools；
- 数据库、向量检索或知识图谱；
- 多会话合并与精确增量游标；
- 日志审计和自动回滚；
- Profile 或 Skill 的程序化权限限制；
- Dream 结果的外部通知。

Memory 不替代 Pi compaction。Compaction 维持当前任务上下文，Memory 维持主体、画像与能力的长期连续性。
