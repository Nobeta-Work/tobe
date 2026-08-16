import type { IIroseConfig } from "../config.ts";
import type { IIroseClient } from "./client.ts";
import { sendMessage } from "./send-message.ts";

/** Send an uploaded MP3 URL as an ordinary IIROSE message. */
export async function sendIIroseAudioUrl(
  client: Pick<IIroseClient, "send">,
  config: IIroseConfig,
  url: string,
): Promise<"audio_url"> {
  const content = url.trim();
  if (!content) throw new Error("audio URL must not be empty");
  await sendMessage(client, config, { content });
  return "audio_url";
}
