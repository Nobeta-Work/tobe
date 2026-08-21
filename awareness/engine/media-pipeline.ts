import { basename, extname } from "node:path";
import { isMediaMetadata, mediaErrorResult, parseMediaRef } from "../../media/index.ts";
import type { MediaMetadata, MediaService } from "../../media/type.ts";
import type { AwarenessPipeline } from "../adapter.ts";
import type { Interaction, Observation } from "../type.ts";

export type MediaServiceProvider = () => MediaService | undefined;

/** Media normalization owned by the Engine layer but isolated from routing, attention, and buffering. */
export class MediaPipeline implements AwarenessPipeline {
  constructor(readonly getService: MediaServiceProvider) {}

  async inbound(observation: Observation): Promise<Observation> {
    if (!isRecord(observation.content)) return observation;
    const rawMedia = observation.content.media;
    if (!isMediaMetadata(rawMedia)) return observation;
    const content = { ...observation.content };
    const media: MediaMetadata = rawMedia;
    const service = this.getService();
    if (!service) {
      delete content.media;
      content.mediaError = { status: "error", code: "MEDIA_PROVIDER_UNAVAILABLE", message: "Media capability is not loaded" };
      return { ...observation, content };
    }
    try {
      const initialDescription = media.fileName ? basename(media.fileName, extname(media.fileName)) : "";
      const stored = await service.import(media, initialDescription);
      const analysis = await service.analyze({ inputs: [stored] });
      content.media = { ...stored, description: analysis.description };
      return { ...observation, content };
    } catch (error) {
      delete content.media;
      content.mediaError = mediaErrorResult(error);
      return { ...observation, content };
    }
  }

  async outbound(interaction: Interaction): Promise<Interaction> {
    if (!isRecord(interaction.args) || interaction.args.media === undefined) return interaction;
    const ref = parseMediaRef(interaction.args.media);
    const service = this.getService();
    if (!service) throw new Error("Media capability is not loaded");
    const media = await service.resolve(ref);
    return { ...interaction, args: { ...interaction.args, media } };
  }
}

export function publicMediaMetadata(media: MediaMetadata) {
  return {
    kind: media.kind,
    mimeType: media.mimeType,
    size: media.size,
    sha256: media.sha256,
    ...(media.width !== undefined ? { width: media.width } : {}),
    ...(media.height !== undefined ? { height: media.height } : {}),
    ...(media.durationMs !== undefined ? { durationMs: media.durationMs } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
