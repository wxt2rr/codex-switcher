export interface AppPageStatus {
    currentEnv: string;
    currentAccount: string;
    launcher?: string;
    instances?: Array<{
        instanceId: string;
        pid: number;
        isLatest?: boolean;
    }>;
}
export interface AppPageAction {
    id: "restart-current" | "launch-new" | "stop-managed";
    title: string;
    description: string;
}
export declare const APP_PAGE_ACTIONS: AppPageAction[];
export declare function renderAppScreen(input: {
    status: AppPageStatus;
    selected?: number;
    message?: string;
}): string;
