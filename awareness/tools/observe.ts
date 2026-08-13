import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AwarenessEngine } from "../adapter.ts";

export function registerObserveTool(pi: ExtensionAPI, engine: AwarenessEngine): void {
  pi.registerTool({
    name: "awareness_observe",
    label: "Awareness Observe",
    description: "List adapters, drain normalized observations, or call a read-only action on one adapter.",
    promptSnippet: "Observe registered external environments and adapter capabilities",
    promptGuidelines: [
      "Call awareness_observe with action list_adapters before using an unfamiliar adapter.",
      "Use awareness_observe for read-only adapter actions and awareness_interact for state changes.",
    ],
    parameters: Type.Object({
      adapter_id: Type.Optional(Type.String({ minLength: 1, description: "Omit for Engine actions" })),
      action: Type.String({ minLength: 1, description: "Engine or Adapter observe action" }),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(toolCallId, params) {
      const result = await engine.observe({
        call_id: toolCallId,
        ...(params.adapter_id ? { adapter_id: params.adapter_id } : {}),
        action: params.action,
        args: params.args ?? {},
      });
      return { content: [{ type: "text", text: result.content }], details: result };
    },
  });
}
