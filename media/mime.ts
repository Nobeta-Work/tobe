import { extname } from "node:path";
import type { MediaKind } from "./type.ts";

const BY_EXTENSION: Readonly<Record<string, { mimeType: string; kind: MediaKind }>> = {
  ".png": { mimeType: "image/png", kind: "image" },
  ".jpg": { mimeType: "image/jpeg", kind: "image" },
  ".jpeg": { mimeType: "image/jpeg", kind: "image" },
  ".gif": { mimeType: "image/gif", kind: "image" },
  ".webp": { mimeType: "image/webp", kind: "image" },
  ".wav": { mimeType: "audio/wav", kind: "audio" },
  ".mp3": { mimeType: "audio/mpeg", kind: "audio" },
  ".ogg": { mimeType: "audio/ogg", kind: "audio" },
  ".m4a": { mimeType: "audio/mp4", kind: "audio" },
  ".mp4": { mimeType: "video/mp4", kind: "video" },
  ".webm": { mimeType: "video/webm", kind: "video" },
};

export function mediaTypeFromFileName(fileName: string): { mimeType: string; kind: MediaKind } | undefined {
  return BY_EXTENSION[extname(fileName).toLowerCase()];
}

export function detectMimeType(data: Uint8Array, fileName?: string): { mimeType: string; kind: MediaKind } {
  const bytes = data;
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return { mimeType: "image/png", kind: "image" };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", kind: "image" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return { mimeType: "image/gif", kind: "image" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return { mimeType: "image/webp", kind: "image" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return { mimeType: "audio/wav", kind: "audio" };
  if (starts(bytes, [0x49, 0x44, 0x33]) || starts(bytes, [0xff, 0xfb]) || starts(bytes, [0xff, 0xf3])) return { mimeType: "audio/mpeg", kind: "audio" };
  if (ascii(bytes, 0, 4) === "OggS") return { mimeType: "audio/ogg", kind: "audio" };
  if (ascii(bytes, 4, 4) === "ftyp") {
    const extension = fileName ? extname(fileName).toLowerCase() : "";
    return extension === ".m4a" ? { mimeType: "audio/mp4", kind: "audio" } : { mimeType: "video/mp4", kind: "video" };
  }
  return fileName ? mediaTypeFromFileName(fileName) ?? { mimeType: "application/octet-stream", kind: "file" } : { mimeType: "application/octet-stream", kind: "file" };
}

export function extensionForMime(mimeType: string): string {
  return Object.entries(BY_EXTENSION).find(([, value]) => value.mimeType === mimeType)?.[0] ?? ".bin";
}

function starts(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => data[index] === value);
}

function ascii(data: Uint8Array, start: number, length: number): string {
  return Buffer.from(data.subarray(start, start + length)).toString("ascii");
}
