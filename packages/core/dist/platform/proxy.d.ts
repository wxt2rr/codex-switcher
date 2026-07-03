export interface UsageProxyState {
    source: "manual" | "auto-env" | "auto-system" | "off";
    value: string;
}
export declare function usageProxyFilePath(stateDir: string): string;
export declare function normalizeUsageProxyValue(raw: string): string;
export declare function readUsageProxyState(stateDir: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<UsageProxyState>;
export declare function setManualUsageProxy(stateDir: string, value: string): Promise<string>;
export declare function clearManualUsageProxy(stateDir: string): Promise<void>;
