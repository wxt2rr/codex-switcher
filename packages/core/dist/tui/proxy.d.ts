export interface ProxyPageStatus {
    source: "manual" | "auto-env" | "auto-system" | "off";
    value: string;
}
export interface ProxyPageAction {
    id: "auto" | "manual" | "test";
    title: string;
    description: string;
}
export declare const PROXY_PAGE_ACTIONS: ProxyPageAction[];
export declare function renderProxyScreen(input: {
    status: ProxyPageStatus;
    selected?: number;
    message?: string;
}): string;
