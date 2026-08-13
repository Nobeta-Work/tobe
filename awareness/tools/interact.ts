import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AwarenessEngine } from "../adapter.ts";

export function registerInteractTool(pi: ExtensionAPI, engine: AwarenessEngine): void {
  pi.registerTool({
    name: "awareness_interact",
    label: "Awareness Interact",
    description: "Call a state-changing action on a registered environment adapter by runtime adapter_id.",
    promptSnippet: "Interact with a registered external environment adapter",
    promptGuidelines: [
      "Use awareness_interact only with an adapter_id and action returned by awareness_observe list_adapters.",
      "Treat awareness_interact content as the complete success or failure result for the matching call_id.",
    ],
    parameters: Type.Object({
      adapter_id: Type.String({ minLength: 1, description: "Runtime-unique adapter ID" }),
      action: Type.String({ minLength: 1, description: "Adapter interact action" }),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(toolCallId, params) {
      const result = await engine.interact({
        call_id: toolCallId,
        adapter_id: params.adapter_id,
        action: params.action,
        args: params.args ?? {},
      });
      return { content: [{ type: "text", text: result.content }], details: result };
    },
  });
}
