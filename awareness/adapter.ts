import type {
  AdapterCallResult,
  EngineRequest,
  Interaction,
  Level,
  Observation,
  ObserveRequest,
} from "./type.ts";

export interface AdapterHealth {
  status: "stopped" | "starting" | "online" | "degraded" | "error";
  since: number;
  lastEventAt?: number;
  detail?: string;
}

export type ObservationListener = (observation: Observation) => void | Promise<void>;
export type Unsubscribe = () => void;

/** Generic Engine boundary hook. Implementations may normalize capabilities without changing Engine routing semantics. */
export interface AwarenessPipeline {
  inbound(observation: Observation): Promise<Observation>;
  outbound(interaction: Interaction): Promise<Interaction>;
}

export interface AdapterActionDefinition {
  action: string;
  mode: "observe" | "interact";
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}

export interface EnvAdapter {
  /** 扫描注册后、整个 extension runtime 内稳定的唯一 ID。 */
  readonly id: string;
  readonly name: string;
  readonly autoStart: boolean;
  readonly permission: Level;
  start(args?: Readonly<Record<string, unknown>>): Promise<void>;
  stop(): Promise<void>;
  observe(request: ObserveRequest): Promise<AdapterCallResult>;
  interact(interaction: Interaction): Promise<AdapterCallResult>;
  health(): AdapterHealth;
  subscribe(listener: ObservationListener): Unsubscribe;
  getSkillPaths(): readonly string[];
  getActions(): readonly AdapterActionDefinition[];
}

export type AdapterFactory = () => EnvAdapter | Promise<EnvAdapter>;
export type AdapterLoader = (adapterName: string) => Promise<EnvAdapter>;

export interface RegisteredAdapter {
  adapter_id: string;
  adapter_name: string;
  auto_start: boolean;
  health: AdapterHealth;
  actions: readonly AdapterActionDefinition[];
}

export interface AwarenessEngine {
  register(adapter: EnvAdapter): void;
  unregister(adapter_id: string): Promise<void>;
  startAutoAdapters(): Promise<void>;
  stopAll(): Promise<void>;
  interact(interaction: Interaction): Promise<AdapterCallResult>;
  manage(request: EngineRequest): Promise<AdapterCallResult>;
  observe(request: ObserveRequest): Promise<AdapterCallResult>;
  subscribe(listener: ObservationListener): Unsubscribe;
  getAdapters(): RegisteredAdapter[];
  getAdapter(adapter_id: string): EnvAdapter | undefined;
  flush(adapter_id?: string): Promise<void>;
}
