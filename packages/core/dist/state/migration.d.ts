import { type ReadLegacyStateOptions } from "./legacy.js";
import { type SwitcherState } from "./store.js";
export interface MigrateLegacyStateOptions extends ReadLegacyStateOptions {
    coreRootDir: string;
}
export interface MigrationResult {
    migrated: SwitcherState;
    backupFile: string;
}
export declare function migrateLegacyState(options: MigrateLegacyStateOptions): Promise<MigrationResult>;
