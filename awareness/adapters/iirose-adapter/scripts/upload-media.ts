import type { ResolvedMedia } from "../../../../media/type.ts";
import type { IIroseConfig } from "../config.ts";

export interface UploadedIIroseMedia {
  path: string;
  url: string;
}

/** Upload Media bytes through IIROSE's first-party multipart endpoint. */
export async function uploadIIroseMedia(
  config: IIroseConfig,
  media: ResolvedMedia,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadedIIroseMedia> {
  if (!config.credentials.uid) throw new Error("credentials.uid is required for IIROSE media upload");
  if (!media.data.byteLength) throw new Error("Cannot upload empty media");
  if (media.data.byteLength > config.media.maxBytes) {
    throw new Error(`IIROSE media exceeds ${config.media.maxBytes} bytes`);
  }

  const bytes = new ArrayBuffer(media.data.byteLength);
  new Uint8Array(bytes).set(media.data);
  const form = new FormData();
  form.set("i", config.credentials.uid);
  form.append(
    "f[]",
    new Blob([bytes], { type: media.artifact.mimeType }),
    media.artifact.fileName ?? defaultFileName(media.artifact.kind, media.artifact.mimeType),
  );
  const response = await fetchImpl(config.media.uploadEndpoint, {
    method: "POST",
    body: form,
    headers: { Accept: "*/*", Origin: "https://iirose.com" },
    signal: AbortSignal.timeout(config.media.timeoutMs),
  });
  if (!response.ok) throw new Error(`IIROSE media upload failed with HTTP ${response.status}`);
  const path = (await response.text()).trim().replace(/^\/+/, "");
  if (!isSafeUploadPath(path, media.artifact.kind)) {
    throw new Error(`IIROSE media upload returned an invalid path: ${path.slice(0, 120)}`);
  }
  return { path, url: new URL(path, ensureTrailingSlash(config.media.publicBaseUrl)).toString() };
}

function isSafeUploadPath(path: string, kind: string): boolean {
  const expectedPrefix = kind === "image" ? "i/" : kind === "audio" ? "m/" : "";
  return Boolean(expectedPrefix) && path.startsWith(expectedPrefix)
    && !path.includes("..") && /^[A-Za-z0-9._/-]+$/.test(path);
}

function ensureTrailingSlash(value: string): string { return value.endsWith("/") ? value : `${value}/`; }

function defaultFileName(kind: string, mimeType: string): string {
  const extension = ({
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a",
  } as Record<string, string>)[mimeType] ?? (kind === "image" ? "png" : kind === "audio" ? "mp3" : "bin");
  return `tobe-${Date.now()}.${extension}`;
}
