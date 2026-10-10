import type { GatewayProtocol } from "../protocol.js";
export type ConversionDiagnosticLevel = "warning" | "error";
export type ToolLossPolicy = "allow" | "safe" | "strict";
export interface ConversionDiagnostic {
    code: string;
    level: ConversionDiagnosticLevel;
    message: string;
    source: GatewayProtocol;
    target: GatewayProtocol;
    path?: string;
}
export declare class ConversionLossError extends Error {
    readonly diagnostics: readonly ConversionDiagnostic[];
    constructor(diagnostics: readonly ConversionDiagnostic[]);
}
export declare function enforceToolLossPolicy(diagnostics: readonly ConversionDiagnostic[], policy: ToolLossPolicy): void;
