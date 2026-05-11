import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

export function serverEnvPaths(): string[] {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return [
    resolve(packageRoot, ".env"),
    resolve(packageRoot, ".env.local")
  ];
}

export function loadServerEnv() {
  const [baseEnv, localEnv] = serverEnvPaths();
  if (existsSync(baseEnv)) {
    loadDotenv({ path: baseEnv, override: false });
  }
  if (existsSync(localEnv)) {
    loadDotenv({ path: localEnv, override: true });
  }
}
