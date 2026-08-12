import { uuid } from "zod";
import { EnvAdapter, Level, Observation } from "../../type";

export type ActorType = 'user' | 'others' | 'website' | 'group' | 'adapter';

export class IIroseAdapter implements EnvAdapter {
    id: string | null = null;
    name: string = 'iirose-adapter';
    autoStart: boolean = true;
    start(args: Record<string, any>): Observation {
        this.id = uuid.toString().substring(0, 11);
        return {
            adapter_id: this.id,
            adapter_name: this.name,
            source: 'adapter_start',
            actor: this.getActorType('adapter'),
            content: 'iirose-adapter start successd.',
            trust: args?.trust ?? 'high',
            attention: args?.trust ?? 'medium',
            timestamp: Date.now()
        }
    }
    stop(): void {
        this.id = null;
    }
    observe(): Observation {
        throw new Error("方法未实现。");
    }
    interact(args: Record<string, any>): Observation {
        throw new Error("方法未实现。");
    }
    health(): boolean {
        throw new Error("方法未实现。");
    }
    permission: Level = 'medium';
    getSkillPaths(): string[] | null {
        throw new Error("方法未实现。");
    }

    private getActorType(actor: ActorType) { return actor; }
    
}