import { constants, copyFileSync } from "node:fs";

/**
 * Materialize an instance-owned adapter config from the tracked default.
 * COPYFILE_EXCL keeps concurrent starts from overwriting a config another
 * process has just created.
 */
export function ensureAdapterConfig(configPath: string, defaultConfigPath: string): string {
  try {
    copyFileSync(defaultConfigPath, configPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  return configPath;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
