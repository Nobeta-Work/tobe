import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AwarenessEngine } from "../adapter.ts";
import { registerEngineTool } from "./engine.ts";
import { registerInteractTool } from "./interact.ts";
import { registerObserveTool } from "./observe.ts";

export function registerAwarenessTools(pi: ExtensionAPI, engine: AwarenessEngine): void {
  registerObserveTool(pi, engine);
  registerInteractTool(pi, engine);
  registerEngineTool(pi, engine);
}
