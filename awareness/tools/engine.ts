import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AwarenessEngine } from "../adapter.ts";

export function registerEngineTool(pi: ExtensionAPI, engine: AwarenessEngine): void {
  pi.registerTool({
    name: "awareness_engine",
    label: "Awareness Engine",
    description: "Register a newly created Adapter or stop and unregister an existing Adapter.",
    promptSnippet: "Manage the lifecycle of Awareness Adapters",
    promptGuidelines: [
      "Use this tool only for Adapter registration and unregistration, never for environment interaction.",
      "register_adapter accepts only a directory name under awareness/adapters, never an arbitrary filesystem path.",
      "Use the runtime adapter_id returned by awareness_observe list_adapters when unregistering.",
    ],
    parameters: Type.Object({
      action: Type.Union([Type.Literal("register_adapter"), Type.Literal("unregister_adapter")]),
      args: Type.Record(Type.String(), Type.Unknown()),
    }),
    async execute(toolCallId, params) {
      const result = await engine.manage({
        call_id: toolCallId,
        action: params.action,
        args: params.args,
      });
      return { content: [{ type: "text", text: result.content }], details: result };
    },
  });
}
