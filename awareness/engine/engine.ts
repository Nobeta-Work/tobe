import { AwarenessEngine, EnvAdapter, Observation } from "../type";

export class AwarenessEngineImpl implements AwarenessEngine {
    awarenessAdapters: Map<string, EnvAdapter> | null = null;
    observe(adapter_id: string): Observation {
        throw new Error("方法未实现。");
    }
    interact(adapter_id: string, args: Record<string, any>): Observation {
        throw new Error("方法未实现。");
    }
    getAliveAdapters(): { adatper_id: string; adapter_name: string; }[] {
        throw new Error("方法未实现。");
    }
    checkAdapter(adapter_id: string): boolean {
        throw new Error("方法未实现。");
    }
    registerAllAdapters(adapters: EnvAdapter[]): void {
        throw new Error("方法未实现。");
    }
    
}