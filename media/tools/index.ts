import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mediaErrorResult } from "../media.ts";
import type { MediaService } from "../type.ts";

const MEDIA_KINDS = ["image", "audio", "video", "file"] as const;

export function registerMediaTools(pi: ExtensionAPI, service: MediaService): void {
  pi.registerTool({
    name: "media_list",
    label: "Media List",
    description: "List the current category/tag choices for one media kind before asking an Adapter to send library media.",
    promptSnippet: "Inspect the current local image and audio media choices",
    promptGuidelines: [
      "Call media_list before sending retrieval-based media; never invent a category or tag.",
      "After choosing a returned category and tag, call the target Adapter interact action with source=library and the same kind.",
    ],
    parameters: Type.Object({
      kind: Type.Union(MEDIA_KINDS.map((kind) => Type.Literal(kind))),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try {
        const library = await service.list({ kind: params.kind });
        return textResult({ status: "success", ...library });
      } catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });

  pi.registerTool({
    name: "media_generate",
    label: "Media Generate",
    description: "Generate an image or audio artifact with Media's independently configured model API and return its kind-prefixed key for an Adapter interaction.",
    promptSnippet: "Generate image or audio media before sending it through an Adapter",
    promptGuidelines: [
      "Generation and delivery are separate operations: only call an Adapter after media_generate succeeds.",
      "Pass the returned media.id as source=artifact mediaId; do not fabricate or alter it.",
    ],
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("image"), Type.Literal("audio")]),
      text: Type.String({ minLength: 1 }),
      options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try {
        const media = await service.generate({ kind: params.kind, text: params.text, ...(params.options ? { options: params.options } : {}) });
        return textResult({ status: "success", media });
      } catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });

  pi.registerTool({
    name: "media_inspect",
    label: "Media Inspect",
    description: "Inspect generated Media by its kind-prefixed key without exposing binary data, local paths, or its filename description.",
    promptSnippet: "Check a generated media artifact before delivery",
    parameters: Type.Object({ mediaId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try {
        const media = await service.inspect(params.mediaId);
        return media ? textResult({ status: "success", media }) : textResult({ status: "error", code: "MEDIA_NOT_FOUND", message: `Unknown or expired media artifact: ${params.mediaId}` });
      } catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
}
