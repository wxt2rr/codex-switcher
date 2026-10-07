export interface GatewayTuiProvider {
    id: string;
    status: string;
}
export interface GatewayTuiCredential {
    id: string;
    providerId: string;
    status: string;
}
export interface GatewayTuiModel {
    id: string;
    providerId: string;
    upstreamModelId: string;
    enabled: boolean;
}
export interface GatewayTuiRouteGroup {
    id: string;
    exposedModelId: string;
    strategy: string;
    sessionPolicy: string;
    members: number;
}
export interface GatewayTuiAgent {
    id: string;
    status: string;
}
export interface GatewayTuiUsage {
    window: "today";
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cost: number | null;
}
export interface GatewayTuiSnapshot {
    envName: string;
    mode: "manual" | "gateway";
    process: "running" | "stopped";
    gatewayId: string;
    providers: GatewayTuiProvider[];
    credentials: GatewayTuiCredential[];
    models: GatewayTuiModel[];
    routeGroups: GatewayTuiRouteGroup[];
    agents: GatewayTuiAgent[];
    profiles: string[];
    usage: GatewayTuiUsage;
}
export interface GatewayTuiAction {
    id: "toggle-mode" | "start-stop" | "providers" | "models" | "groups" | "agents" | "usage" | "profiles" | "refresh" | "back";
    title: string;
    description: string;
}
export declare const GATEWAY_TUI_ACTIONS: GatewayTuiAction[];
export declare function renderGatewayScreen(input: {
    snapshot: GatewayTuiSnapshot;
    selected?: number;
    message?: string;
}): string;
