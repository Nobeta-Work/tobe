import type { IIroseClient } from "./client.ts";

export async function logout(client: IIroseClient): Promise<void> {
  client.close(1000, "logout");
}
