import type { IIroseConfig } from "../config.ts";
import { createLoginFrame, loginFailure } from "../protocol.ts";
import type { IIroseClient } from "./client.ts";

export async function login(client: IIroseClient, config: IIroseConfig): Promise<void> {
  await client.connect(config.websocketUrl, config.connection.loginTimeoutMs);
  const response = client.waitForFrame((frame) => frame.startsWith("%"), config.connection.loginTimeoutMs);
  await client.send(createLoginFrame(config));
  const firstFrame = await response;
  const failure = loginFailure(firstFrame);
  if (failure) {
    client.close(1000, "login rejected");
    throw new Error(`IIROSE login failed: ${failure}`);
  }
}
