import { MediaError } from "./errors.ts";
import type { MediaInput } from "./type.ts";

export function parseMediaInput(value: unknown): MediaInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaError("MEDIA_INVALID_REQUEST", "media must be an object");
  const input = value as Record<string, unknown>;
  if (input.source === "artifact") return { source: "artifact", mediaId: requiredString(input.mediaId, "media.mediaId") };
  if (input.source === "library") {
    const selection = input.selection;
    if (selection !== undefined && selection !== "random" && selection !== "best") {
      throw new MediaError("MEDIA_INVALID_REQUEST", "media.selection must be random or best");
    }
    const revision = optionalString(input.revision, "media.revision");
    return {
      source: "library",
      library: requiredString(input.library, "media.library"),
      category: requiredString(input.category, "media.category"),
      ...(selection ? { selection } : {}),
      ...(revision ? { revision } : {}),
    };
  }
  throw new MediaError("MEDIA_INVALID_REQUEST", "media.source must be artifact or library");
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new MediaError("MEDIA_INVALID_REQUEST", `${name} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}
