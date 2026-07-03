export interface StatusViewData {
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
}
export interface StatusOverviewData {
    envName: string;
    name: string;
    isCurrentCli?: boolean;
    isCurrentApp?: boolean;
    authMode: string;
    runtime?: {
        preferredAuthMethod?: string;
        openaiBaseUrl?: string;
    };
    apiKeyPreview?: string;
}
export declare function renderStatusScreen(input: {
    status: StatusViewData;
    accounts: StatusOverviewData[];
    offset?: number;
    viewLines?: number;
}): string;
export declare function buildStatusLines(status: StatusViewData, accounts: StatusOverviewData[]): string[];
