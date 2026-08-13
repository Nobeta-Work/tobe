import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AwarenessEngine, Unsubscribe } from "./adapter.ts";
import type { Observation } from "./type.ts";

/** 把 Engine subscription 桥接为 Pi 会话消息，从而主动唤起 Agent。 */
export function subscribeAgentPush(pi: ExtensionAPI, engine: AwarenessEngine): Unsubscribe {
  return engine.subscribe((observation) => pushObservation(pi, observation));
}

export function pushObservation(pi: ExtensionAPI, observation: Observation): void {
  pi.sendMessage(
    {
      customType: "awareness-observation",
      content: JSON.stringify(observation),
      display: false,
      details: observation,
    },
    {
      triggerTurn: true,
      deliverAs: observation.attention === "high" || observation.attention === "max"
        ? "steer"
        : "followUp",
    },
  );
}
