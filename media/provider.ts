import type { MediaApiConfig, MediaConfig } from "./config.ts";
import { MediaError } from "./errors.ts";
import { detectMimeType, extensionForMime } from "./mime.ts";
import type { GeneratedMedia, MediaData, MediaGenerateRequest, MediaKind, MediaModelProvider } from "./type.ts";

type Fetch = typeof fetch;

export class HttpMediaModelProvider implements MediaModelProvider {
  readonly id = "http-media-model";
  readonly #config: MediaConfig;
  readonly #fetch: Fetch;

  constructor(config: MediaConfig, fetchImplementation: Fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  supportsRecognition(kind: MediaKind): boolean {
    return kind === "image" ? this.#config.providers.imageRecognition.enabled
      : kind === "audio" ? this.#config.providers.audioRecognition.enabled : false;
  }

  supportsGeneration(kind: MediaKind): boolean {
    return kind === "image" ? this.#config.providers.imageGeneration.enabled
      : kind === "audio" ? this.#config.providers.audioGeneration.enabled : false;
  }

  async recognize(input: MediaData, signal?: AbortSignal): Promise<string> {
    if (input.kind === "image") return this.#recognizeImage(input, signal);
    if (input.kind === "audio") return this.#recognizeAudio(input, signal);
    throw new MediaError("MEDIA_UNSUPPORTED", `Recognition is not supported for ${input.kind}`);
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    if (request.kind === "image") return this.#generateImage(request, signal);
    return this.#generateAudio(request, signal);
  }

  async #recognizeImage(input: MediaData, signal?: AbortSignal): Promise<string> {
    const config = this.#require(this.#config.providers.imageRecognition, "image recognition");
    const response = await this.#request(config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "请准确描述这张图片的内容。只输出对图片的文本解释，不要声称图片是文本消息。" },
            { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.data).toString("base64")}` } },
          ],
        }],
      }),
    }, signal);
    const json = await readJson(response);
    const text = nestedString(json, ["choices", 0, "message", "content"]);
    if (!text) throw new MediaError("MEDIA_PROVIDER_FAILED", "Image recognition response did not contain text");
    return text.trim();
  }

  async #recognizeAudio(input: MediaData, signal?: AbortSignal): Promise<string> {
    const config = this.#require(this.#config.providers.audioRecognition, "audio recognition");
    const form = new FormData();
    form.set("model", config.model);
    const audioBytes = new ArrayBuffer(input.data.byteLength);
    new Uint8Array(audioBytes).set(input.data);
    form.set("file", new Blob([audioBytes], { type: input.mimeType }), input.fileName ?? `audio${extensionForMime(input.mimeType)}`);
    const response = await this.#request(config, { method: "POST", body: form }, signal);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      const text = (await response.text()).trim();
      if (!text) throw new MediaError("MEDIA_PROVIDER_FAILED", "Audio recognition response was empty");
      return text;
    }
    const json = await readJson(response);
    const text = typeof json === "object" && json && "text" in json && typeof json.text === "string" ? json.text : undefined;
    if (!text?.trim()) throw new MediaError("MEDIA_PROVIDER_FAILED", "Audio recognition response did not contain text");
    return text.trim();
  }

  async #generateImage(request: MediaGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    const config = this.#require(this.#config.providers.imageGeneration, "image generation");
    const response = await this.#request(config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt: request.text,
        response_format: config.responseFormat ?? "b64_json",
        ...safeGenerationOptions(request.options),
      }),
    }, signal);
    const json = await readJson(response);
    const encoded = nestedString(json, ["data", 0, "b64_json"]);
    let data: Uint8Array;
    if (encoded) data = Buffer.from(encoded, "base64");
    else {
      const url = nestedString(json, ["data", 0, "url"]);
      if (!url) throw new MediaError("MEDIA_PROVIDER_FAILED", "Image generation response did not contain image data");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new MediaError("MEDIA_PROVIDER_FAILED", "Generated image URL must use HTTPS");
      const download = await this.#fetch(parsed, { signal: combinedSignal(signal, config.timeoutMs) });
      if (!download.ok) throw new MediaError("MEDIA_PROVIDER_FAILED", `Generated image download failed: HTTP ${download.status}`);
      data = await readLimitedBytes(download, this.#config.maxGeneratedBytes);
    }
    const detected = detectMimeType(data);
    if (detected.kind !== "image") throw new MediaError("MEDIA_PROVIDER_FAILED", "Image generation returned non-image data");
    return { kind: "image", mimeType: detected.mimeType, data, fileName: `generated${extensionForMime(detected.mimeType)}`, provider: this.id, description: request.text };
  }

  async #generateAudio(request: MediaGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    const config = this.#require(this.#config.providers.audioGeneration, "audio generation");
    const response = await this.#request(config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        input: request.text,
        voice: stringOption(request.options, "voice") ?? config.voice ?? "alloy",
        response_format: stringOption(request.options, "responseFormat") ?? config.responseFormat ?? "mp3",
      }),
    }, signal);
    const data = await readLimitedBytes(response, this.#config.maxGeneratedBytes);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || detectMimeType(data).mimeType;
    if (!mimeType.startsWith("audio/")) throw new MediaError("MEDIA_PROVIDER_FAILED", "Audio generation returned non-audio data");
    return { kind: "audio", mimeType, data, fileName: `generated${extensionForMime(mimeType)}`, provider: this.id, description: request.text };
  }

  #require(config: MediaApiConfig, operation: string): MediaApiConfig {
    if (!config.enabled) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${operation} provider is not enabled`);
    return config;
  }

  async #request(config: MediaApiConfig, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const url = new URL(config.endpoint, withTrailingSlash(config.baseUrl));
    const headers = new Headers(init.headers);
    const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv]?.trim() : undefined;
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
    let response: Response;
    try {
      response = await this.#fetch(url, { ...init, headers, signal: combinedSignal(signal, config.timeoutMs) });
    } catch (error) {
      throw new MediaError("MEDIA_PROVIDER_FAILED", `Media provider request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500).trim();
      throw new MediaError("MEDIA_PROVIDER_FAILED", `Media provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response;
  }
}

function withTrailingSlash(value: string): string { return value.endsWith("/") ? value : `${value}/`; }
function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; }
  catch (error) { throw new MediaError("MEDIA_PROVIDER_FAILED", "Media provider returned invalid JSON", { cause: error }); }
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Media response exceeds ${maxBytes} bytes`);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new MediaError("MEDIA_TOO_LARGE", `Media response exceeds ${maxBytes} bytes`);
    }
    chunks.push(part.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function nestedString(value: unknown, path: readonly (string | number)[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number") current = Array.isArray(current) ? current[key] : undefined;
    else current = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
  }
  return typeof current === "string" ? current : undefined;
}

function stringOption(options: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeGenerationOptions(options: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!options) return {};
  const allowed = ["size", "quality", "style"];
  return Object.fromEntries(allowed.flatMap((key) => options[key] === undefined ? [] : [[key, options[key]]]));
}
