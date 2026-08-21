import type { MediaApiConfig, MediaConfig } from "../config.ts";
import { detectMimeType, extensionForMime } from "../files/mime.ts";
import { MediaError, type GeneratedMedia, type MediaData, type MediaKind, type MediaModelGenerateRequest, type MediaModels } from "../type.ts";

type Fetch = typeof fetch;

export class HttpMediaModels implements MediaModels {
  readonly id = "http-media-model";
  readonly #config: MediaConfig;
  readonly #fetch: Fetch;

  constructor(config: MediaConfig, fetchImplementation: Fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  canAnalyze(kind: MediaKind): boolean {
    return kind === "image" ? this.#config.providers.imageRecognition.enabled
      : kind === "audio" ? this.#config.providers.audioRecognition.enabled : false;
  }

  canGenerate(kind: MediaKind): boolean {
    return kind === "image" ? this.#config.providers.imageGeneration.enabled
      : kind === "audio" ? this.#config.providers.audioGeneration.enabled : false;
  }

  async analyze(inputs: readonly MediaData[], prompt: string, signal?: AbortSignal): Promise<string> {
    if (inputs.every((input) => input.kind === "image")) return this.#analyzeImages(inputs, prompt, signal);
    if (inputs.length === 1 && inputs[0]?.kind === "audio") return this.#analyzeAudio(inputs[0], prompt, signal);
    throw new MediaError("MEDIA_UNSUPPORTED", "The configured HTTP providers cannot analyze mixed media or multiple audio files");
  }

  async generate(request: MediaModelGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    if (request.kind === "image") return this.#generateImage(request, signal);
    return this.#generateAudio(request, signal);
  }

  async #analyzeImages(inputs: readonly MediaData[], prompt: string, signal?: AbortSignal): Promise<string> {
    const config = this.#require(this.#config.providers.imageRecognition, "image recognition");
    const response = await this.#request(config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...inputs.map((input) => ({ type: "image_url", image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.data).toString("base64")}` } })),
          ],
        }],
      }),
    }, signal);
    const json = await readJson(response);
    const text = nestedString(json, ["choices", 0, "message", "content"]);
    if (!text) throw new MediaError("MEDIA_PROVIDER_FAILED", "Image recognition response did not contain text");
    return text.trim();
  }

  async #analyzeAudio(input: MediaData, prompt: string, signal?: AbortSignal): Promise<string> {
    const config = this.#require(this.#config.providers.audioRecognition, "audio recognition");
    const form = new FormData();
    form.set("model", config.model);
    if (prompt) form.set("prompt", prompt);
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

  async #generateImage(request: MediaModelGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    const config = this.#require(this.#config.providers.imageGeneration, "image generation");
    const init = request.references.length
      ? imageEditRequest(request, config)
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            prompt: request.prompt,
            response_format: config.responseFormat ?? "b64_json",
            ...safeGenerationOptions(request.options),
          }),
        };
    const response = await this.#request(config, {
      ...init,
    }, signal, request.references.length ? config.referenceEndpoint ?? "/v1/images/edits" : undefined);
    const json = await readJson(response);
    const encoded = nestedString(json, ["data", 0, "b64_json"]);
    let data: Uint8Array;
    if (encoded) data = Buffer.from(encoded, "base64");
    else {
      const url = nestedString(json, ["data", 0, "url"]);
      if (!url) throw new MediaError("MEDIA_PROVIDER_FAILED", "Image generation response did not contain image data");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new MediaError("MEDIA_PROVIDER_FAILED", "Generated image URL must use HTTPS");
      const apiHost = new URL(config.baseUrl).hostname.toLowerCase();
      const allowedHosts = new Set([apiHost, ...(config.downloadHosts ?? []).map((host) => host.toLowerCase())]);
      if (!allowedHosts.has(parsed.hostname.toLowerCase())) throw new MediaError("MEDIA_PROVIDER_FAILED", `Generated image host is not allowed: ${parsed.hostname}`);
      const download = await this.#fetch(parsed, { signal: combinedSignal(signal, config.timeoutMs) });
      if (!download.ok) throw new MediaError("MEDIA_PROVIDER_FAILED", `Generated image download failed: HTTP ${download.status}`);
      data = await readLimitedBytes(download, this.#config.maxGeneratedBytes);
    }
    const detected = detectMimeType(data);
    if (detected.kind !== "image") throw new MediaError("MEDIA_PROVIDER_FAILED", "Image generation returned non-image data");
    return { kind: "image", mimeType: detected.mimeType, data, fileName: `generated${extensionForMime(detected.mimeType)}`, provider: this.id, description: request.prompt };
  }

  async #generateAudio(request: MediaModelGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia> {
    const config = this.#require(this.#config.providers.audioGeneration, "audio generation");
    if (request.references.length) throw new MediaError("MEDIA_UNSUPPORTED", "Audio generation references are not supported by the configured HTTP provider");
    const response = await this.#request(config, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        input: request.prompt,
        voice: stringOption(request.options, "voice") ?? config.voice ?? "alloy",
        response_format: stringOption(request.options, "responseFormat") ?? config.responseFormat ?? "mp3",
      }),
    }, signal);
    const data = await readLimitedBytes(response, this.#config.maxGeneratedBytes);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || detectMimeType(data).mimeType;
    if (!mimeType.startsWith("audio/")) throw new MediaError("MEDIA_PROVIDER_FAILED", "Audio generation returned non-audio data");
    return { kind: "audio", mimeType, data, fileName: `generated${extensionForMime(mimeType)}`, provider: this.id, description: request.prompt };
  }

  #require(config: MediaApiConfig, operation: string): MediaApiConfig {
    if (!config.enabled) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${operation} provider is not enabled`);
    return config;
  }

  async #request(config: MediaApiConfig, init: RequestInit, signal?: AbortSignal, endpoint = config.endpoint): Promise<Response> {
    const url = new URL(endpoint, withTrailingSlash(config.baseUrl));
    const headers = new Headers(init.headers);
    const apiKey = config.apiKey.trim();
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

function imageEditRequest(request: MediaModelGenerateRequest, config: MediaApiConfig): RequestInit {
  if (request.references.some((input) => input.kind !== "image")) {
    throw new MediaError("MEDIA_UNSUPPORTED", "Image generation references must all be images");
  }
  const form = new FormData();
  form.set("model", config.model);
  form.set("prompt", request.prompt);
  form.set("response_format", config.responseFormat ?? "b64_json");
  for (const [key, value] of Object.entries(safeGenerationOptions(request.options))) form.set(key, String(value));
  for (const [index, input] of request.references.entries()) {
    const bytes = new ArrayBuffer(input.data.byteLength);
    new Uint8Array(bytes).set(input.data);
    form.append("image", new Blob([bytes], { type: input.mimeType }), input.fileName ?? `reference-${index}${extensionForMime(input.mimeType)}`);
  }
  return { method: "POST", body: form };
}

function safeGenerationOptions(options: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!options) return {};
  const allowed = ["size", "quality", "style"];
  return Object.fromEntries(allowed.flatMap((key) => options[key] === undefined ? [] : [[key, options[key]]]));
}
