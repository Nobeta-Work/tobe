export type CapabilityDisposer = () => void;

export interface CapabilityRegistry {
  provide<T extends object>(name: string, service: T): CapabilityDisposer;
  consume<T extends object>(name: string): T | undefined;
  has(name: string): boolean;
}

class ProcessCapabilityRegistry implements CapabilityRegistry {
  readonly #services = new Map<string, object>();

  provide<T extends object>(name: string, service: T): CapabilityDisposer {
    if (!name.trim()) throw new Error("Capability name must not be empty");
    if (this.#services.has(name)) throw new Error(`Capability is already registered: ${name}`);
    this.#services.set(name, service);
    return () => {
      if (this.#services.get(name) === service) this.#services.delete(name);
    };
  }

  consume<T extends object>(name: string): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  has(name: string): boolean { return this.#services.has(name); }
}

const REGISTRY_KEY = Symbol.for("nobeta.tobe.capabilities.v1");
const processGlobal = globalThis as typeof globalThis & { [REGISTRY_KEY]?: CapabilityRegistry };

export const capabilities = processGlobal[REGISTRY_KEY] ??= new ProcessCapabilityRegistry();
