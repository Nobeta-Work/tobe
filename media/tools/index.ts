import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { detectMimeType } from "../files/mime.ts";
import { mediaErrorResult, parseMediaRef } from "../media.ts";
import { MediaError, type MediaAnalyzeToolInput, type MediaData, type MediaService } from "../type.ts";

const MEDIA_KINDS = ["image", "audio", "video", "file"] as const;
const ANALYZABLE_KINDS = ["image", "audio"] as const;

export function registerMediaTools(pi: ExtensionAPI, service: MediaService): void {
  pi.registerTool({
    name: "media_list",
    label: "Media List",
    description: "List real category and tag choices from the local media library before selecting reusable media.",
    promptSnippet: "Inspect reusable local media choices",
    promptGuidelines: [
      "Call media_list before constructing a library MediaRef; never invent a category or tag.",
      "Use the selected kind, category, and tag in media_analyze or awareness_interact.",
    ],
    parameters: Type.Object({
      kind: Type.Union(MEDIA_KINDS.map((kind) => Type.Literal(kind))),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try { return textResult({ status: "success", ...await service.list({ kind: params.kind }) }); }
      catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });

  pi.registerTool({
    name: "media_analyze",
    label: "Media Analyze",
    description: "Analyze, transcribe, or compare one to eight MediaRefs or explicit local media files in one model context.",
    promptSnippet: "Read or compare referenced media",
    promptGuidelines: [
      "Pass multiple image inputs together when the user asks for a comparison.",
      "Use MediaRefs from observations, media_list, or media_generate; do not reconstruct artifact IDs.",
      "A local file input must use an explicit path and is read only for this analysis call.",
    ],
    parameters: Type.Object({
      prompt: Type.Optional(Type.String({ maxLength: 10000 })),
      inputs: Type.Array(analyzeInputSchema(), { minItems: 1, maxItems: 8 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try {
        const inputs = await Promise.all((params.inputs as MediaAnalyzeToolInput[]).map((input) => toolInput(input)));
        return textResult({ status: "success", ...await service.analyze({ ...(params.prompt ? { prompt: params.prompt } : {}), inputs }) });
      } catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });

  pi.registerTool({
    name: "media_generate",
    label: "Media Generate",
    description: "Generate image or audio media from a prompt and optional MediaRef references, returning only a reusable MediaRef.",
    promptSnippet: "Generate reusable image or audio media",
    promptGuidelines: [
      "Generation and delivery are separate operations. Send the returned MediaRef through awareness_interact.",
      "Use references for image-conditioned generation and keep the returned MediaRef unchanged.",
    ],
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("image"), Type.Literal("audio")]),
      prompt: Type.Optional(Type.String({ maxLength: 10000 })),
      references: Type.Optional(Type.Array(mediaRefSchema(), { maxItems: 4 })),
      options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      try {
        const media = await service.generate({
          kind: params.kind,
          ...(params.prompt ? { prompt: params.prompt } : {}),
          ...(params.references ? { references: params.references.map(parseMediaRef) } : {}),
          ...(params.options ? { options: params.options } : {}),
        });
        return textResult({ status: "success", media });
      } catch (error) { return textResult(mediaErrorResult(error)); }
    },
  });
}

function mediaRefSchema() {
  const common = {
    type: Type.Literal("media_ref"),
    kind: Type.Union(MEDIA_KINDS.map((kind) => Type.Literal(kind))),
    description: Type.String(),
  };
  return Type.Union([
    Type.Object({ ...common, source: Type.Literal("artifact"), id: Type.String({ minLength: 12, maxLength: 12 }) }, { additionalProperties: false }),
    Type.Object({ ...common, source: Type.Literal("library"), category: Type.String({ minLength: 1 }), tag: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  ]);
}

function analyzeInputSchema() {
  return Type.Union([
    mediaRefSchema(),
    Type.Object({
      type: Type.Literal("file"),
      path: Type.String({ minLength: 1 }),
      kind: Type.Optional(Type.Union(ANALYZABLE_KINDS.map((kind) => Type.Literal(kind)))),
    }, { additionalProperties: false }),
  ]);
}

async function toolInput(input: MediaAnalyzeToolInput): Promise<MediaData | ReturnType<typeof parseMediaRef>> {
  if (input.type === "media_ref") return parseMediaRef(input);
  const data = await readFile(input.path);
  const detected = detectMimeType(data, input.path);
  const kind = input.kind ?? (detected.kind === "image" || detected.kind === "audio" ? detected.kind : undefined);
  if (!kind) throw new MediaError("MEDIA_UNSUPPORTED", `Cannot analyze local file type: ${input.path}`);
  if (detected.kind !== "file" && detected.kind !== kind) throw new MediaError("MEDIA_INVALID_REQUEST", `Local file is ${detected.kind}, not ${kind}`);
  return { kind, mimeType: detected.mimeType, data, fileName: basename(input.path) };
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
}
