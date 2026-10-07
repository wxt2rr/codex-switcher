import type { SwitcherState, TargetName } from "../state/store.js";
export interface ApplyTargetHomeStateOptions {
    state: SwitcherState;
    target: TargetName;
}
export interface LegacyTargetHomeRepairEntry {
    envName: string;
    homePath: string;
    beforeConfigToml: string;
    afterConfigToml: string;
    providerAuthEnabled: boolean;
}
export interface LegacyTargetHomeRepairResult {
    checked: number;
    repaired: LegacyTargetHomeRepairEntry[];
    unresolved: string[];
    failures: Array<{
        envName: string;
        error: string;
    }>;
}
export declare function repairLegacyTargetHomeConfigs(options: {
    state: SwitcherState;
    beforeWrite?: (entry: LegacyTargetHomeRepairEntry) => Promise<void>;
}): Promise<LegacyTargetHomeRepairResult>;
export declare function applyTargetHomeState(options: ApplyTargetHomeStateOptions): Promise<void>;
export declare function clearTargetHomeState(homePath: string): Promise<void>;
