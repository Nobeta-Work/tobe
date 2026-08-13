import type {
  AdapterActionDefinition,
  AwarenessEngine,
  EnvAdapter,
  ObservationListener,
  RegisteredAdapter,
  Unsubscribe,
} from "../adapter.ts";
import type {
  AdapterCallResult,
  EngineConfig,
  Interaction,
  Observation,
  ObserveRequest,
} from "../type.ts";

const ENGINE_ADAPTER_ID = "awareness-engine";
const DEFAULT_CONFIG: EngineConfig = {
  lowBufferMs: 4_000,
  mediumBufferMs: 350,
  dedupeWindowMs: 2_000,
  maxBufferedPerAdapter: 100,
  maxReadyObservations: 200,
};

interface BufferedObservation { observation: Observation; count: number }

export class AwarenessEngineImpl implements AwarenessEngine {
  readonly #config: EngineConfig;
  readonly #adapters = new Map<string, EnvAdapter>();
  readonly #subscriptions = new Map<string, Unsubscribe>();
  readonly #listeners = new Set<ObservationListener>();
  readonly #buffers = new Map<string, Map<string, BufferedObservation>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #ready: Observation[] = [];

  constructor(config: Partial<EngineConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  register(adapter: EnvAdapter): void {
    if (this.#adapters.has(adapter.id)) throw new Error(`Duplicate adapter_id: ${adapter.id}`);
    if ([...this.#adapters.values()].some((item) => item.name === adapter.name)) {
      throw new Error(`Duplicate adapter name: ${adapter.name}`);
    }
    this.#adapters.set(adapter.id, adapter);
    this.#subscriptions.set(adapter.id, adapter.subscribe((event) => this.#accept(event)));
  }

  async unregister(adapter_id: string): Promise<void> {
    const adapter = this.#adapters.get(adapter_id);
    if (!adapter) return;
    await adapter.stop();
    await this.flush(adapter_id);
    this.#subscriptions.get(adapter_id)?.();
    this.#subscriptions.delete(adapter_id);
    this.#adapters.delete(adapter_id);
  }

  async startAutoAdapters(): Promise<void> {
    const settled = await Promise.allSettled(
      [...this.#adapters.values()].filter((adapter) => adapter.autoStart).map((adapter) => adapter.start()),
    );
    const failures = settled.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Adapter auto-start failed");
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.#adapters.values()].map((adapter) => adapter.stop()));
    await this.flush();
  }

  async interact(interaction: Interaction): Promise<AdapterCallResult> {
    const adapter = this.#adapters.get(interaction.adapter_id);
    if (!adapter) return this.#failure(interaction, `Unknown adapter_id: ${interaction.adapter_id}`);
    try {
      return await adapter.interact(interaction);
    } catch (error) {
      return this.#failure(interaction, error instanceof Error ? error.message : String(error));
    }
  }

  async observe(request: ObserveRequest): Promise<AdapterCallResult> {
    if (request.adapter_id) {
      const adapter = this.#adapters.get(request.adapter_id);
      if (!adapter) return this.#failure(request, `Unknown adapter_id: ${request.adapter_id}`);
      try {
        return await adapter.observe(request);
      } catch (error) {
        return this.#failure(request, error instanceof Error ? error.message : String(error));
      }
    }
    switch (request.action) {
      case "list_adapters":
        return this.#result(request, ENGINE_ADAPTER_ID, { status: "success", adapters: this.getAdapters() });
      case "drain": {
        const limit = this.#positiveInteger(request.args.limit, this.#config.maxReadyObservations);
        const observations = this.#ready.splice(0, limit);
        return this.#result(request, ENGINE_ADAPTER_ID, { status: "success", observations });
      }
      default:
        return this.#failure(request, `Unknown engine observe action: ${request.action}`);
    }
  }

  subscribe(listener: ObservationListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getAdapters(): RegisteredAdapter[] {
    return [...this.#adapters.values()].map((adapter) => ({
      adapter_id: adapter.id,
      adapter_name: adapter.name,
      auto_start: adapter.autoStart,
      health: adapter.health(),
      actions: adapter.getActions(),
    }));
  }

  getAdapter(adapter_id: string): EnvAdapter | undefined { return this.#adapters.get(adapter_id); }

  async flush(adapter_id?: string): Promise<void> {
    if (adapter_id) return this.#flushBuffer(adapter_id);
    for (const id of [...this.#buffers.keys()]) await this.#flushBuffer(id);
  }

  async #accept(observation: Observation): Promise<void> {
    if (!this.#adapters.has(observation.adapter_id)) return;
    if (observation.attention === "off") return;
    if (observation.attention === "high" || observation.attention === "max") {
      await this.#emit(observation);
      return;
    }
    this.#buffer(observation);
  }

  #buffer(observation: Observation): void {
    const buffer = this.#buffers.get(observation.adapter_id) ?? new Map<string, BufferedObservation>();
    this.#buffers.set(observation.adapter_id, buffer);
    const key = [observation.source, JSON.stringify(observation.content)].join("\u0000");
    const prior = buffer.get(key);
    if (prior && observation.timestamp - prior.observation.timestamp <= this.#config.dedupeWindowMs) {
      prior.count += 1;
      prior.observation = observation;
    } else buffer.set(key, { observation, count: 1 });
    while (buffer.size > this.#config.maxBufferedPerAdapter) buffer.delete(buffer.keys().next().value as string);
    if (!this.#timers.has(observation.adapter_id)) {
      const delay = observation.attention === "low" ? this.#config.lowBufferMs : this.#config.mediumBufferMs;
      this.#timers.set(observation.adapter_id, setTimeout(() => void this.#flushBuffer(observation.adapter_id), delay));
    }
  }

  async #flushBuffer(adapter_id: string): Promise<void> {
    const timer = this.#timers.get(adapter_id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(adapter_id);
    const buffer = this.#buffers.get(adapter_id);
    this.#buffers.delete(adapter_id);
    if (!buffer) return;
    for (const { observation, count } of buffer.values()) {
      const content = count === 1 ? observation.content : { value: observation.content, duplicate_count: count };
      await this.#emit({ ...observation, content });
    }
  }

  async #emit(observation: Observation): Promise<void> {
    this.#ready.push(observation);
    if (this.#ready.length > this.#config.maxReadyObservations) this.#ready.shift();
    await Promise.allSettled([...this.#listeners].map((listener) => listener(observation)));
  }

  #result(request: ObserveRequest | Interaction, adapter_id: string, content: unknown): AdapterCallResult {
    return { call_id: request.call_id, adapter_id, action: request.action, timestamp: Date.now(), content: JSON.stringify(content) };
  }

  #failure(request: ObserveRequest | Interaction, message: string): AdapterCallResult {
    return this.#result(request, request.adapter_id ?? ENGINE_ADAPTER_ID, { status: "error", message });
  }

  #positiveInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
  }
}

export const ENGINE_OBSERVE_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "list_adapters", mode: "observe", description: "列出已扫描注册的 adapters、运行时 ID、健康状态和动作。", parameters: {} },
  { action: "drain", mode: "observe", description: "取出 Engine 已完成 attention 处理的 observations。", parameters: { limit: "positive integer, optional" } },
];
