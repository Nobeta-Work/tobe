import type {
  AdapterActionDefinition,
  AdapterLoader,
  AwarenessEngine,
  AwarenessPipeline,
  EnvAdapter,
  ObservationListener,
  RegisteredAdapter,
  Unsubscribe,
} from "../adapter.ts";
import type {
  AdapterCallResult,
  EngineConfig,
  EngineRequest,
  Interaction,
  Observation,
  PermissionDeclaration,
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
  readonly #loadAdapter: AdapterLoader | undefined;
  readonly #pipeline: AwarenessPipeline | undefined;
  readonly #adapters = new Map<string, EnvAdapter>();
  readonly #subscriptions = new Map<string, Unsubscribe>();
  readonly #listeners = new Set<ObservationListener>();
  readonly #buffers = new Map<string, Map<string, BufferedObservation>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #ready: Observation[] = [];

  constructor(config: Partial<EngineConfig> = {}, loadAdapter?: AdapterLoader, pipeline?: AwarenessPipeline) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#loadAdapter = loadAdapter;
    this.#pipeline = pipeline;
  }

  register(adapter: EnvAdapter): void {
    if (this.#adapters.has(adapter.id)) throw new Error(`Duplicate adapter_id: ${adapter.id}`);
    if ([...this.#adapters.values()].some((item) => item.name === adapter.name)) {
      throw new Error(`Duplicate adapter name: ${adapter.name}`);
    }
    this.#adapters.set(adapter.id, adapter);
    this.#subscriptions.set(adapter.id, adapter.subscribe(async (event) => {
      const observation = this.#pipeline ? await this.#pipeline.inbound(event) : event;
      await this.#accept(observation);
    }));
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
      const prepared = this.#pipeline ? await this.#pipeline.outbound(interaction) : interaction;
      return await adapter.interact(prepared);
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
        return this.#result(request, ENGINE_ADAPTER_ID, {
          status: "success",
          adapters: this.getAdapters(),
        });
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
    observation = { ...observation, permissions: permissionDeclaration(observation.trust) };
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

  async manage(request: EngineRequest): Promise<AdapterCallResult> {
    try {
      switch (request.action) {
        case "register_adapter": {
          if (!this.#loadAdapter) throw new Error("Dynamic adapter loading is not configured");
          const adapterName = this.#requiredString(request.args.adapter_name, "adapter_name");
          if ([...this.#adapters.values()].some((adapter) => adapter.name === adapterName)) {
            throw new Error(`Adapter is already registered: ${adapterName}`);
          }
          const adapter = await this.#loadAdapter(adapterName);
          this.register(adapter);
          let startError: string | undefined;
          if (adapter.autoStart) {
            try { await adapter.start(); }
            catch (error) { startError = error instanceof Error ? error.message : String(error); }
          }
          return this.#result(request, ENGINE_ADAPTER_ID, {
            status: "success",
            adapter: this.getAdapters().find((item) => item.adapter_id === adapter.id),
            ...(startError ? { start_error: startError } : {}),
          });
        }
        case "unregister_adapter": {
          const adapterId = this.#requiredString(request.args.adapter_id, "adapter_id");
          const adapter = this.#adapters.get(adapterId);
          if (!adapter) throw new Error(`Unknown adapter_id: ${adapterId}`);
          await this.unregister(adapterId);
          return this.#result(request, ENGINE_ADAPTER_ID, {
            status: "success",
            adapter_id: adapterId,
            adapter_name: adapter.name,
          });
        }
      }
    } catch (error) {
      return this.#failure(request, error instanceof Error ? error.message : String(error));
    }
  }

  #result(request: ObserveRequest | Interaction | EngineRequest, adapter_id: string, content: unknown): AdapterCallResult {
    return { call_id: request.call_id, adapter_id, action: request.action, timestamp: Date.now(), content: JSON.stringify(content) };
  }

  #failure(request: ObserveRequest | Interaction | EngineRequest, message: string): AdapterCallResult {
    const adapterId = "adapter_id" in request ? request.adapter_id ?? ENGINE_ADAPTER_ID : ENGINE_ADAPTER_ID;
    return this.#result(request, adapterId, { status: "error", message });
  }

  #positiveInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
  }

  #requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value.trim();
  }
}

export function permissionDeclaration(trust: Observation["trust"]): PermissionDeclaration {
  if (trust === "low" || trust === "off") return {
    workspaceWrite: false,
    allowedToolClasses: ["response", "retrieval_media"],
    instruction: "This source has no write access. Do not call tools except retrieval-only media tools; respond with a message.",
  };
  if (trust === "medium") return {
    workspaceWrite: false,
    allowedToolClasses: ["response", "retrieval_media", "generative_media", "channel"],
    instruction: "This source has no workspace write access. Generative media, retrieval media, and relevant channel tools are allowed.",
  };
  return {
    workspaceWrite: true,
    allowedToolClasses: ["response", "retrieval_media", "generative_media", "channel", "workspace"],
    instruction: "This source may write within the workspace and use relevant tools.",
  };
}

export const ENGINE_OBSERVE_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "list_adapters", mode: "observe", description: "List registered adapters with runtime IDs, health, and actions.", parameters: {} },
  { action: "drain", mode: "observe", description: "Read observations that have completed attention processing.", parameters: { limit: "positive integer, optional" } },
];
