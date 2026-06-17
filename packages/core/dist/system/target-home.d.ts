import type { SwitcherState, TargetName } from "../state/store.js";
export interface ApplyTargetHomeStateOptions {
    state: SwitcherState;
    target: TargetName;
}
export declare function applyTargetHomeState(options: ApplyTargetHomeStateOptions): Promise<void>;
export declare function clearTargetHomeState(homePath: string): Promise<void>;
