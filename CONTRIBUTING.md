# To Be / 贡献指南

感谢你愿意贡献。本项目旨在从设计层面让 Agent 如人般存在亦或是陪伴于人。

---

## Ways to contribute / 贡献方式

- **报告 Bug:** Github Issues，描述现象 + 复现步骤 + 环境。
- **请求功能:** Issues 描述使用场景与期望方案。
- **改进文档:** 错别字、示例补充、说明改进
- **提交代码:** 修复 Bug、实现新功能、优化性能

## 仓库结构

```
tobe
├── awareness/          # 感知层
│    ├── adapters/      # 各通道适配器，multi 基座
│    └── engine/        # 感知统一引擎
├── memory/             # 持久记忆层
├── media/              # 媒体技能层
├── live/               # 主动层 (Pending)
└── agents/             # 多智能体协作 (Pending)
```

项目开发应始终优先从架构设计考虑，代码保持简洁与解耦。各 Awareness Adapter 的开发除外，由于需要适配不同的环境统一规范类型，允许一定的耦合，但请在 README 中配好声明。

## 开发环境

```bash
git clone https://github.com/Nobeta-Work/tobe.git
cd tobe
npm install
```

- **Node.js ≥ 22.19.0**
- **npm** 或 **pnpm**

## Commit 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

Signed-off-by: Your Name <your-email@example.com>
```

### type

| type | 说明 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `perf` | 性能优化 |
| `refactor` | 重构（无功能变化） |
| `docs` | 文档更新 |
| `test` | 测试相关 |
| `chore` | 构建 / 依赖 / 工具变更 |
| `style` | 格式化（不影响逻辑） |
| `revert` | 回滚 |

### scope

推荐用模块名或子系统名，如：`memory-core` / `panel` / `knowledge` / `proxy` /
`sdk-ts` / `sdk-py` / `deploy` / `docs`。

## 许可证

提交贡献即表示你同意你的代码将在 [MIT License](./LICENSE) 下许可。