import { type GatewayEnvironmentState } from "./model.js";
import type { GatewayAgentBindingV2 } from "./v2.js";
export interface GatewayImportResult {
    sourceFormat: "provider_gateway" | "gateway" | "generic";
    gateway: GatewayEnvironmentState;
    agentBindings: Record<string, GatewayAgentBindingV2>;
    warnings: string[];
    excludedFields: string[];
}
export interface GatewayImportPreview {
    sourceFormat: GatewayImportResult["sourceFormat"];
    providers: number;
    credentials: number;
    models: number;
    routeGroups: number;
    agents: number;
    warnings: string[];
    excludedFields: string[];
}
export declare function importGatewayConfiguration(source: unknown, environmentId: string): GatewayImportResult;
export declare function previewGatewayImport(source: unknown, environmentId: string): GatewayImportPreview;
