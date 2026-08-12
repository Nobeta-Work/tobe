# Awareness

**Awareness Layer** 是 ToBe 与环境之间唯一的感知—交互边界。它把异构环境信号转化为可信、可理解、可调度的观察，并把 Agent 的交互意图交给正确环境。

该 Layer 由两个模块组成：
- `Adapter`: 各环境/通道信息来源的个性化处理器。
  - 
- `Engine`: 统一数据转换层，所有感知层数据必须在感知引擎转换为 Agent 受控数据结构，并根据消息的类型、属性做简单

## Engine

Awareness Engine 必须做出以下承诺：
- 将感知层数据转换为 Agent 框架通用消息数据类型。
- 定义感知层通用行为方法、消息数据类型。
- 定义确定的认证鉴权机制。
- 收集 adapters 消息，根据消息属性，提供即刻响应或延时堆积消息。
- 启动时通过 SKILL 和 index.ts 做 extension 暴露统一功能、接口和 awareness 介绍、调用。

```ts

/** 感知层数据 - Engine 接收 */
export interface Observation {
    adapter_id: string;
    adapter_name: string;
    source: string;
    actor: string;
    content: string;
    /** off:'可疑来源';low:'用户低参与度，谨慎辨别';medium:'用户正常交互来源';high:'可信度高信源，完全用户参与';max:'完全可信' */
    trust: Level;
    /** off:'只做白名单编码触发';low:'低权重消息，必须堆积发送，去重';medium:'普通权重消息，短暂堆积发送|直接发送';high:'直接发送 Agent';'max':'打断 Agent 当前任务发送' */
    attention: Level;
    timestamp: number;
}

```

## Adapter
Awareness Adapter 必须做出以下承诺：
- 将感知层通用行为方法、消息数据类型对特定消息源做数据处理封装。
- 将感知层通用行为方法、消息数据类型的封装接口、信息、参数暴露在 SKILL.md 中。如果 Adapter 过大，需要嵌套 Skills 。
- 白名单转换数据体，如文本、图片、音频。

```ts

/** Adapter */
export interface EnvAdapter {
    /** 运行时唯一 ID (10位)，静默 null */
    id: string | null;
    /** adapter-name (只允许小写字母与-) */
    name: string;
    /** 是否在注册时启动 */
    autoStart: boolean;
    /** 通道开启感知监听 */
    start(args: Record<string, any>): Observation;
    /** 关闭通道监听 */
    stop(): void;
    /** 感知方法 */
    observe(): Observation;
    /** 交互方法 */
    interact(args: Record<string, any>): Observation;
    /** 存活判断 */
    health(): boolean;
    /** Agent操作角度： off:'Agent可任意修改adapter',low:'Agent可写，但需高级消息的用户确认',medium:'Agent可写可改开关，但需高级消息的用户确认',high:'只有max消息可确认开关，不可修改',max:'agent不可写不可改的adapter，只能用户手动维护' */
    permission: Level;
    getSkillPaths(): string[] | null;
}

```