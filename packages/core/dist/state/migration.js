import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readLegacyState } from "./legacy.js";
import { createStateStore, } from "./store.js";
export async function migrateLegacyState(options) {
    const migrated = await readLegacyState(options);
    const store = createStateStore({ rootDir: options.coreRootDir });
    const previousState = await tryLoadExistingState(store);
    const backupFile = await writeBackup(options.coreRootDir, migrated, options.now);
    try {
        await store.save(migrated);
    }
    catch (error) {
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
async function writeBackup(coreRootDir, state, now) {
    const stamp = (now ?? new Date().toISOString()).replace(/:/g, "-");
    const backupDir = join(coreRootDir, "backups");
    const backupFile = join(backupDir, `legacy-state-${stamp}.json`);
    await mkdir(backupDir, { recursive: true });
    await writeFile(backupFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return backupFile;
}
async function tryLoadExistingState(store) {
    try {
        return await store.load();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=migration.js.map