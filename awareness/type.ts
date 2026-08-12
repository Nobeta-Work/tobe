
/** Adapter */
export interface EnvAdapter {
    id: string | null;
    name: string;
    autoStart: boolean;
    start(args: Record<string, any>): Observation;
    stop(): void;
    observe(): Observation;
    interact(args: Record<string, any>): Observation;
    health(): boolean;
    /** Agent操作角度： off:'Agent可任意修改adapter',low:'Agent可写，但需高级消息的用户确认',medium:'Agent可写可改开关，但需高级消息的用户确认',high:'只有max消息可确认开关，不可修改',max:'agent不可写不可改的adapter，只能用户手动维护' */
    permission: Level;
    getSkillPaths(): string[] | null;
}

/** 感知层数据 - Engine 接收 */
export interface Observation {
    adapter_id: string;
    adapter_name: string;
    source: string;
    actor: string;
    content: string;
    /** off:'可疑来源';low:'用户低参与度，谨慎辨别';medium:'用户正常交互来源';high:'可信度高信源';max:'完全可信' */
    trust: Level;
    /** off:'只做白名单编码触发';low:'低权重消息，必须堆积发送，去重';medium:'普通权重消息，短暂堆积发送|直接发送';high:'直接发送 Agent';'max':'打断 Agent 当前任务发送' */
    attention: Level;
    timestamp: number;
}

/** Engine */
export interface AwarenessEngine {
    awarenessAdapters: Map<string, EnvAdapter> | null;
    observe(adapter_id: string): Observation;
    interact(adapter_id: string, args: Record<string, any>): Observation;
    getAliveAdapters(): {adatper_id: string, adapter_name: string}[];
    checkAdapter(adapter_id: string): boolean;
    registerAllAdapters(adapters: EnvAdapter[]): void;
}

/** 交互数据 */
export interface Interact {
    adapter_id: string;
    adapter_name: string;
    content: string;
    timestamp: number;
}

export type Level = 'off' | 'low' | 'medium' | 'high' | 'max';