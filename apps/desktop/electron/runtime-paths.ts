import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const CORE_MARKER = join("packages", "core", "dist", "api", "core-api.js");

export interface RuntimePathOptions {
  currentFile: string;
  resourcesPath?: string;
}

function isPackagedRuntimeRoot(candidate: string): boolean {
  return existsSync(join(candidate, CORE_MARKER));
}

function isWorkspaceRoot(candidate: string): boolean {
  return existsSync(join(candidate, "package.json")) && isPackagedRuntimeRoot(candidate);
}

export function resolveWorkspaceRoot(currentFile: string): string {
  let current = dirname(currentFile);

  for (let index = 0; index < 12; index += 1) {
    if (isWorkspaceRoot(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error("Unable to resolve codex-switcher workspace root");
}

export function resolveRuntimeRoot(options: RuntimePathOptions): string {
  if (options.resourcesPath && isPackagedRuntimeRoot(options.resourcesPath)) {
    return options.resourcesPath;
  }

  return resolveWorkspaceRoot(options.currentFile);
}

export function resolveRuntimeResource(
  relativePath: string,
  options: RuntimePathOptions,
): string {
  if (options.resourcesPath) {
    const bundledPath = join(options.resourcesPath, relativePath);
    if (existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  return join(resolveWorkspaceRoot(options.currentFile), relativePath);
}

export function getConfiguredResourcesPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.CODEX_SWITCHER_DESKTOP_RESOURCES_PATH?.trim();
  return value || undefined;
}
