import type { SwitcherState } from "../state/store.js";
export interface CoreApiOptions {
    getState(): SwitcherState;
}
export declare function createCoreApi(options: CoreApiOptions): {
    getOverview(): {
        generatedAt: string;
        current: Record<import("../state/store.js").TargetName, import("../state/store.js").TargetPointer>;
        status: {
            cli: {
                current: string;
                auth: string;
                authExpiry: string;
                loginState: string;
            };
            app: {
                current: string;
                auth: string;
                authExpiry: string;
                loginState: string;
            };
            tokenRefresh: {
                guard: string;
                needReloginLastRun: string;
            };
        };
        envs: import("../domain/env-service.js").EnvSummary[];
        accounts: {
            apiKeyPreview: string | undefined;
            name: string;
            authMode: SwitcherState["envs"][string]["accounts"][string]["authMode"];
            runtime: import("../state/store.js").AccountRuntimeSettings;
            isCurrentCli: boolean;
            isCurrentApp: boolean;
            envName: string;
        }[];
        recentTasks: import("../state/store.js").TaskSummary[];
    };
    listEnvs(): import("../domain/env-service.js").EnvSummary[];
    listAccounts(): {
        apiKeyPreview: string | undefined;
        name: string;
        authMode: SwitcherState["envs"][string]["accounts"][string]["authMode"];
        runtime: import("../state/store.js").AccountRuntimeSettings;
        isCurrentCli: boolean;
        isCurrentApp: boolean;
        envName: string;
    }[];
    selectEnv(input: {
        target: "cli" | "app";
        envName: string;
        now: string;
    }): SwitcherState;
    selectAccount(input: {
        target: "cli" | "app";
        envName: string;
        accountName: string;
        now: string;
    }): SwitcherState;
    createEnv(input: {
        envName: string;
        homePath: string;
        cloneFromEnv?: string;
        now: string;
    }): SwitcherState;
    updateEnv(input: {
        envName: string;
        nextEnvName: string;
        homePath: string;
        now: string;
    }): SwitcherState;
    updateAccountRuntime(input: {
        envName: string;
        accountName: string;
        runtime: SwitcherState["envs"][string]["accounts"][string]["runtime"];
        now: string;
    }): SwitcherState;
    getStatus(): {
        cli: {
            current: string;
            auth: string;
            authExpiry: string;
            loginState: string;
        };
        app: {
            current: string;
            auth: string;
            authExpiry: string;
            loginState: string;
        };
        tokenRefresh: {
            guard: string;
            needReloginLastRun: string;
        };
    };
    getAccounts(envName: string): import("../domain/account-service.js").AccountSummary[];
};
