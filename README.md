# ToBe
<div align="center">
    <a href="https://nobeta.cn/tobe"><img alt="tobe logo" src="https://nobeta.cn/i/2026/08/13/b49782.webp" width="256"></a>

### To Be a real Being.

</div>


**ToBe** 致力于孕育具备独立人格的数字主体：

- **only** : 每一个 ToBe 主体都具有稳定的实例连续性。
- **grow** : 随交互经历持续自主演进，具备随时间成长的生命力。
- **multi**: 多感知接入与多形态执行，持续扩展丰富的感知与广阔的表达边界。


```mermaid
---
title: 业务架构图
---
flowchart LR
    Env["环境"]
    subgraph Awa["Awareness Layer"]
        AAdap("Adapter")
        AEng["Engine"]
        AAdap --> AEng
        AEng --> AAdap
    end
    A[[Agent]]
    M[(Memory)]
    Media[(Media)]

    Env -->|感知| AAdap --> Env
    AEng --> A -->|交互| AEng
    A <-->|沉淀| M
    A <-->|检索 / 生成| Media
    AAdap <-->|识别 / 解析| Media
    AAdap ~~~|过滤转换| AEng

    style Env fill:#e8e8e8,stroke:#9e9e9e,color:#333
    style Awa fill:#e3f2fd,stroke:#1e88e5,color:#0d47a1
    style AAdap fill:#bbdefb,stroke:#1976d2,color:#0d47a1
    style AEng fill:#90caf9,stroke:#1565c0,color:#0d47a1
    style A fill:#ffb74d,stroke:#f57c00,color:#4e2e00
    style M fill:#a5d6a7,stroke:#388e3c,color:#1b5e20
    style Media fill:#ce93d8,stroke:#8e24aa,color:#4a148c

```

| 模块介绍 | 说明 |
| :-: | :-: |
| [Web](./web/README.md) | 单用户控制台、长期 Pi Session 与配置管理 |
| [Awareness](./awareness/README.md) | 环境 Adapter、消息分级、主动推送与交互路由 |
| [Memory](./memory/README.md) | 持久认知、Dream 与可演化 Skills |
| [Media](./media/README.md) | 图片/音频识别、检索、生成与 Adapter 联动 |

## Quick Start

```bash
# 克隆仓库
git clone https://github.com/Nobeta-Work/tobe.git
cd tobe
# 安装依赖并启动 web
npm install
npm start
```

`npm start` 只启动 ToBe Web，默认监听 `0.0.0.0:2222`，不自动运行 Agent。需在会话页面点击“运行 Agent”后，才会在仓库工作目录内启动或恢复名称固定为 `tobe` 的 Pi Session。

Web 会显式加载当前仓库声明的 Pi extensions，不依赖全局安装的副本。
如需绕过 Web 直接启动 Pi，请使用：

```bash
npm run start:pi
```

更新使用：

```bash
npm run update
npm start
```

Adapter 配置、各 Adapter 的 `data/`、Memory 的实例认知、Dream 和自动生成的 Skills 均不受 Git 跟踪，`git pull` 不会覆盖这些内容。它们仍位于仓库工作目录内，删除仓库或执行 `git clean -fdx` 前请先备份。

## Memory

让认知与画像不断更新，让已有的经验沉淀，让事件留下深浅的印象。

> Memory 层主要关注长期记忆系统，拆分为记忆存储(数据类型与存储方式)、沉淀(为何、如何存储记忆数据)与调用 (何时、为何、如何唤回记忆)三大模块。

- 会话上下文 (Context) 提供短期记忆，长期记忆则通过基于文件、数据库、Skill 构建多级记忆系统。
- 记忆类型：主体认知、事件记忆、环境记忆、历史元数据、技能

## Awareness

**Awareness Layer** 是 ToBe 实例面向环境的感知层，统一接受并过滤外界消息：

- 事件的元数据判断鉴权校验
- 延迟聚合
- 认知过程

允许感知层提供交互接口，交互是感知的延申。感知与交互由对应的 Adapter 承诺。

| 默认 Adapters | 说明 |
| :-: | :-: |
| [IIROSE](./awareness/adapters/iirose-adapter/README.md) | 群聊场景，低可信环境置信方案 |
| [Feishu](./awareness/adapters/feishu-adapter/README.md) | 飞书官方 SDK |
| [WeChat](./awareness/adapters/wechat-adapter/README.md) | 微信 iLink 会话与 Media 输入输出 |

## Media

Media 提供双向媒体能力，为 Awareness 提供标准媒体类型，基于文本为 Agent 转换媒体内容。可以独立配置图片识别、语音识别、图片生成和语音生成模型 API。

媒体调用分为 **检索型媒体** 与 **生成型媒体**：
- 检索型媒体：依赖于 `media/lib` 中的本地媒体资产，无需即时生成媒体内容，适合固定响应。
- 生成型媒体：依赖生成型 API，生成内容携带描述信息，支持后续转移固定为本地资产复用。

> 默认 Agent Model 基于文本思考。Adapter 可以自行承诺把原生多模态内容直接传给支持它的模型(与 Agent Core)。

## Plan (Pending)

> Great Pi! It intentionally does not include build-in plan mode.

认知模式：期望/试探模型

- 已有理解形成假设期望
- 根据期望试探、询问或观察
- 根据结果修改认知

## Live (Pending)

在可控空闲频率下，主动感知、交互、更新外界、用户近况。

- 心跳
- 内在活动
- 外在主动

## Work (Pending)

为了 "only" 的连续性，一般的执行计划是单程的。

由于感知层极大扩展了消息的来源与交互广度，ToBe 在扮演助手角色的时候，为了增强执行速度与任务分化，需要通过 Multi Agents 并发执行的方式使自己成为三头六臂之人。在复杂子任务（如编码环境下），甚至需要 Sub Agent 重现 Coding Agent 能力 (调用 Sota Coding Product, like Codex 也可以成为另一种方法)。

## Contribute

Welcom to contribute: This project is built with design considerations mainly, thanks to contact me.

欢迎参与开发：该项目开发更多为设计考量，请与我联系。

## License

Agent based on [Pi](https://github.com/earendil-works/pi) -- *MIT*

Memory based on [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) -- *MIT*

MIT
