import { type ReadLegacyStateOptions } from "./legacy.js";
import { type StateStore, type SwitcherState } from "./store.js";
export interface MigrateLegacyStateOptions extends ReadLegacyStateOptions {
    coreRootDir: string;
    /** Optional store injection used to exercise failure recovery without filesystem-name assumptions. */
    stateStore?: StateStore;
}
export interface MigrationResult {
    migrated: SwitcherState;
    backupFile: string;
}
export declare function migrateLegacyState(options: MigrateLegacyStateOptions): Promise<MigrationResult>;
