import type { SwitcherState, TargetName } from "../state/store.js";
/** Stable Codex provider namespace used for all Switcher-managed API routes. */
export declare const MANAGED_PROVIDER_ID = "codex_switcher_router";
export interface ApplyTargetHomeStateOptions {
    state: SwitcherState;
    target: TargetName;
    /**
     * Override the selected account route with the environment gateway route.
     *
     * Account runtime data may still contain a direct compatibility route (or a
     * stale per-account router URL) while an environment gateway is active. The
     * target home must follow the environment gateway in that case.
     */
    gatewayBaseUrl?: string;
    /**
     * Windows packaged Codex Apps are activated by Explorer and cannot inherit
     * the Switcher process environment. Use the local route token directly in
     * the provider configuration when an environment variable is unavailable.
     */
    localRouterAuthMode?: "env" | "static";
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
