export type Level = "off" | "low" | "medium" | "high" | "max";
/**
 * Observation 的触发主体分类：
 * user=用户本人；assistant=ToBe；service=其他参与者构成的实际场景；
 * signal=无主体信号；adapter=适配器自身；system=环境系统信息。
 */
export type Actor = "user" | "assistant" | "service" | "signal" | "adapter" | "system";
/**
 * Engine 的环境无关数据单元。
 * content 完全由 Adapter 定义；核心层不得加入房间、消息、设备等环境字段。
 */
export interface Observation<TContent = unknown> {
  id: string;
  adapter_id: string;
  adapter_name: string;
  source: string;
  actor: Actor;
  content: TContent;
  trust: Level;
  attention: Level;
  timestamp: number;
}

/** function calling 的写操作信封；call_id 由宿主 Tool Call 注入。 */
export interface Interaction {
  call_id: string;
  adapter_id: string;
  action: string;
  args: Readonly<Record<string, unknown>>;
}

/** Awareness Engine lifecycle request; separate from Adapter interaction. */
export interface EngineRequest {
  call_id: string;
  action: "register_adapter" | "unregister_adapter";
  args: Readonly<Record<string, unknown>>;
}

/** function calling 的读操作信封。 */
export interface ObserveRequest {
  call_id: string;
  adapter_id?: string;
  action: string;
  args: Readonly<Record<string, unknown>>;
}

/** 成功和失败使用相同信封，具体状态与数据均编码在 content 中。 */
export interface AdapterCallResult {
  call_id: string;
  adapter_id: string;
  action: string;
  timestamp: number;
  content: string;
}

export interface EngineConfig {
  lowBufferMs: number;
  mediumBufferMs: number;
  dedupeWindowMs: number;
  maxBufferedPerAdapter: number;
  maxReadyObservations: number;
}
