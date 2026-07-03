export type SwitchTarget = "cli" | "app";
export interface SwitchEnvOption {
    name: string;
    isCurrentCli?: boolean;
    isCurrentApp?: boolean;
}
export interface SwitchAccountOption {
    envName: string;
    name: string;
    authMode: string;
    isCurrentCli?: boolean;
    isCurrentApp?: boolean;
    runtime?: {
        preferredAuthMethod?: string;
    };
}
export declare function listTargetOptions(): SwitchTarget[];
export declare function listEnvOptions(envs: SwitchEnvOption[], target: SwitchTarget): SwitchEnvOption[];
export declare function listAccountOptions(accounts: SwitchAccountOption[], envName: string, target: SwitchTarget): SwitchAccountOption[];
export declare function renderSwitchSummary(input: {
    target: SwitchTarget;
    envName: string;
    accountName: string;
    actionLabel?: string;
}): string;
