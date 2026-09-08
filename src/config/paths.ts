import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env";

/**
 * Resolves the path to the model dataset directory cleanly:
 * 1. Checks env.MODEL_DATASET_DIR (if set and exists)
 * 2. Fallbacks to sibling directory '../flood-analysis-model/dataset' relative to process.cwd() if it exists
 * 3. Returns null if neither is available (enables graceful degradation in production / CI)
 */
export function getModelDatasetDir(): string | null {
  if (env.MODEL_DATASET_DIR && env.MODEL_DATASET_DIR.trim() !== "") {
    const configuredPath = resolve(process.cwd(), env.MODEL_DATASET_DIR);
    if (existsSync(configuredPath)) {
      return configuredPath;
    }
  }

  // Fallback to sibling repository if running in local monorepo / workspace setup
  const localSibling = resolve(process.cwd(), "../flood-analysis-model/dataset");
  if (existsSync(localSibling)) {
    return localSibling;
  }

  return null;
}
