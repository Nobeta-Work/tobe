import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve a runtime data path and reject escapes from the Adapter's data directory. */
export function resolveAdapterDataPath(adapterDir: string, configuredPath: string, fallback: string): string {
  const dataRoot = resolve(adapterDir, "data");
  const requested = configuredPath.trim() || fallback;
  const target = isAbsolute(requested) ? resolve(requested) : resolve(adapterDir, requested);
  const relativePath = relative(dataRoot, target);
  if (relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))) {
    return target;
  }
  throw new Error(`Adapter data path must stay inside ${dataRoot}: ${configuredPath}`);
}
