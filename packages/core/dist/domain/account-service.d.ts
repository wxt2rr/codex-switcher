import type { AccountRuntimeSettings, SwitcherState, TargetName } from "../state/store.js";
export interface AccountSummary {
    name: string;
    authMode: SwitcherState["envs"][string]["accounts"][string]["authMode"];
    runtime: AccountRuntimeSettings;
    isCurrentCli: boolean;
    isCurrentApp: boolean;
}
export interface ListAccountsInput {
    envName: string;
}
export interface SelectAccountInput {
    envName: string;
    accountName: string;
    target: TargetName;
    now: string;
}
export interface UpdateRuntimeInput {
    envName: string;
    accountName: string;
    runtime: AccountRuntimeSettings;
    now: string;
}
export interface RemoveAccountInput {
    envName: string;
    accountName: string;
    now: string;
}
export interface AccountServiceError extends Error {
    code: "ENV_NOT_FOUND" | "ACCOUNT_NOT_FOUND";
}
export declare function createAccountService(): {
    listAccounts(state: SwitcherState, input: ListAccountsInput): AccountSummary[];
    selectAccount(state: SwitcherState, input: SelectAccountInput): SwitcherState;
    updateRuntime(state: SwitcherState, input: UpdateRuntimeInput): SwitcherState;
    removeAccount(state: SwitcherState, input: RemoveAccountInput): SwitcherState;
};
