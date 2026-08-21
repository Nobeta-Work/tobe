import type { AdapterActionDefinition } from "../../../adapter.ts";

export const BASIC_ACTIONS: readonly AdapterActionDefinition[] = [
  {
    action: "send_message",
    mode: "interact",
    description: "Send public room text, or a private message when userId is provided. Use \\n for multiline content.",
    parameters: { content: "non-empty string, required", userId: "string, optional" },
  },
  {
    action: "send_media", mode: "interact",
    description: "Send an image or audio MediaRef to the current room. Audio is uploaded and delivered as its MP3 URL.",
    parameters: {
      media: "MediaRef, required (artifact id or library category/tag)",
      caption: "string, optional",
    },
  },
  { action: "logs", mode: "observe", description: "Inspect the current monthly message log status.", parameters: {} },
  {
    action: "history", mode: "observe",
    description: "Read a 1-based inclusive range relative to the newest message in the current monthly log.",
    parameters: { start: "positive integer, required", end: "positive integer, required; maximum 100 entries" },
  },
  {
    action: "set_active", mode: "interact", description: "Set the proactive response level.",
    parameters: { level: "off | low | medium | high, required" },
  },
];
