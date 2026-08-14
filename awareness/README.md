# Awareness

Awareness 是 ToBe 的 Pi extension，也是 Agent Core 面向环境的唯一感知—交互边界。

## 稳定边界

```text
Pi Agent
  ├── awareness_observe  ──┐
  ├── awareness_interact ──┤
  └── awareness_engine ────┤
                          ▼
                    Awareness Engine
                          ▼ adapter_id
                dynamically scanned Adapter
                          ▼
                      Environment
```

- `index.ts` 是 extension 入口，扫描 `adapters/*/ADAPTER.ts`，注册 Adapter，再按 `autoStart` 决定是否开启监听。运行期间也可以通过 Engine 动作注册新建的 Adapter 或注销现有 Adapter。
- Pi 暴露三个稳定工具：`awareness_observe` 负责 Adapter/Engine 只读观察，`awareness_interact` 只负责 Adapter 写操作，`awareness_engine` 只负责 Adapter 生命周期管理。
- Adapter 的环境动作仍然收敛在 observe/interact 的 `action + args` 下，不会为每个 Adapter 增加全局工具。
- Engine 只认识通用 `Observation` 信封。房间、消息、设备等字段全部属于具体 Adapter 的 `content`。
- `adapter_id` 在扫描注册时生成，在当前 extension runtime 内唯一且稳定；不以是否已登录为条件。
- Engine 的 `subscribe()` 会由 extension 桥接到 `pi.sendMessage`，不是等待 Agent 调用 `drain` 的轮询接口。

## 主动推送

- `high/max`：Engine 立即发布；extension 使用 `deliverAs="steer"` 并设置 `triggerTurn=true`。
- `low/medium`：分别完成延迟聚合后发布；extension 使用 `deliverAs="followUp"` 并设置 `triggerTurn=true`。
- `off`：不发布到 Agent，只允许 Adapter 内部白名单逻辑处理。

因此 `drain` 只是补充读取已发布观察的接口，不是消息到达 Agent 的必要步骤。Extension 在 shutdown 时先解除推送订阅，再停止 Adapter，避免关闭事件额外唤起 Agent。

## Actor

`Observation.actor` 是环境无关的触发主体分类：

- `user`：ToBe 所属用户本人。
- `assistant`：ToBe 自身产生的信息。
- `service`：其他主体参与形成的实际场景信息。
- `signal`：没有可识别主体的环境信号。
- `adapter`：Adapter 生命周期或内部状态。
- `system`：环境平台的系统信息。

身份键、显示名等个性数据仍由 Adapter 放入 `content`，Actor 不承担鉴权数据。

## 目录

```text
awareness/
├── index.ts       # Pi extension 入口、Adapter 扫描与主动消息推送
├── adapter.ts     # 全局 Adapter/Engine 类型
├── type.ts        # 环境无关数据与 function-call 信封
├── engine.ts      # 感知聚合、缓冲与路由引擎
├── tools/         # awareness_observe / awareness_interact / awareness_engine
└── adapters/      # 环境个性化实现
```

每个 Adapter 必须跟踪 `config.default.json` 和 `config.schema.json`：前者提供可运行的默认配置，后者承诺配置结构、字段说明及 `x-sensitive` 敏感字段声明，供 Web 等管理界面消费。第一次实例化而 `config.json` 不存在时，会原子复制默认文件生成实例配置，再正常实例化和注册。`config.json` 与 Adapter 自身的 `data/` 均不受 Git 跟踪；所有运行数据路径必须位于对应 Adapter 的 `data/` 内。

## 调用结果

所有 Adapter 调用结果结构固定为：

```ts
{ call_id, adapter_id, action, timestamp, content }
```

成功和失败都写入字符串 `content`；当前约定为 JSON 字符串，其中 `status` 为 `success` 或 `error`。`call_id` 直接使用 Pi 提供的 tool call ID，作为调用与结果的回调凭证。

## Observe

不传 `adapter_id` 时调用 Engine 动作：

- `list_adapters`：发现运行时 ID、健康状态、自动启动选项和 Adapter 动作。
- `drain`：取出已完成 attention 处理的观察。

传入 `adapter_id` 时调用该 Adapter 的只读动作。

## Interact

`awareness_interact` 必须传入顶层 `adapter_id`，只调用该 Adapter 的写动作，不承载 Engine 语义。

## Engine

`awareness_engine` 独立承载生命周期动作：

- `register_adapter`，参数 `{ "adapter_name": "目录名" }`：只从 `awareness/adapters/<adapter_name>/ADAPTER.ts` 加载并注册；若其 `autoStart=true`，注册后启动。
- `unregister_adapter`，参数 `{ "adapter_id": "运行时 ID" }`：停止、冲刷缓冲并注销 Adapter。

动态加载不接受任意路径。注销后再次注册会重新导入入口并重新读取配置，同时生成新的运行时 `adapter_id`。
