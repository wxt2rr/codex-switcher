import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readLegacyState, type ReadLegacyStateOptions } from "./legacy.js";
import {
  createStateStore,
  type SwitcherState,
} from "./store.js";

export interface MigrateLegacyStateOptions extends ReadLegacyStateOptions {
  coreRootDir: string;
}

export interface MigrationResult {
  migrated: SwitcherState;
  backupFile: string;
}

export async function migrateLegacyState(
  options: MigrateLegacyStateOptions,
): Promise<MigrationResult> {
  const migrated = await readLegacyState(options);
  const store = createStateStore({ rootDir: options.coreRootDir });
  const previousState = await tryLoadExistingState(store);
  const backupFile = await writeBackup(options.coreRootDir, migrated, options.now);

  try {
    await store.save(migrated);
  } catch (error) {
    if (previousState) {
      await store.save(previousState);
    }
    throw error;
  }

  const canonical = await store.load();

  return {
    migrated: canonical,
    backupFile,
  };
}

async function writeBackup(
  coreRootDir: string,
  state: SwitcherState,
  now?: string,
): Promise<string> {
  const stamp = (now ?? new Date().toISOString()).replace(/:/g, "-");
  const backupDir = join(coreRootDir, "backups");
  const backupFile = join(backupDir, `legacy-state-${stamp}.json`);
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return backupFile;
}

async function tryLoadExistingState(
  store: ReturnType<typeof createStateStore>,
): Promise<SwitcherState | null> {
  try {
    return await store.load();
  } catch {
    return null;
  }
}
