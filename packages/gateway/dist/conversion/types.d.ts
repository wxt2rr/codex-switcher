import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ConversionDiagnostic, ToolLossPolicy } from "./diagnostics.js";
import type { ConversionPath, ConversionQuality, ConversionStep } from "./formats.js";
export interface ReasoningConversionState {
    enabled?: boolean;
    effort?: "low" | "medium" | "high" | "xhigh";
    budgetTokens?: number;
    returnThinking?: boolean;
}
export interface ConversionMetadata {
    requestId?: string;
    traceId?: string;
    originModelName?: string;
    upstreamModelName?: string;
    reasoning?: ReasoningConversionState;
    toolState?: JsonObject;
    providerDialect?: string;
    options?: JsonObject;
}
export interface ConversionOptions {
    toolLossPolicy?: ToolLossPolicy;
    mediaResolver?: MediaResolver;
    emitSequenceNumber?: boolean;
}
export interface MediaResolver {
    resolveImage?(input: string): Promise<{
        mimeType: string;
        data: string;
    }>;
    resolveFile?(input: string): Promise<{
        mimeType: string;
        data: string;
        fileName?: string;
    }>;
}
export interface ConversionResult<T extends JsonValue | JsonValue[] | JsonObject = JsonObject> {
    value: T;
    from: GatewayProtocol;
    to: GatewayProtocol;
    converterId: string;
    quality: ConversionQuality;
    steps: ConversionStep[];
    diagnostics: ConversionDiagnostic[];
    usage?: JsonObject;
    stream?: boolean;
}
export interface ConversionPlanResult {
    path: ConversionPath;
    metadata: ConversionMetadata;
    options: ConversionOptions;
}
