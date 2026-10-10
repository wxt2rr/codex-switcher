import type { GatewayProtocol, JsonValue } from "../protocol.js";
import type { ConversionDiagnostic } from "./diagnostics.js";
import type { MediaResolver } from "./types.js";
export interface CanonicalMediaPart {
    type: "image" | "file";
    url?: string;
    data?: string;
    mimeType?: string;
    fileName?: string;
}
export declare function resolveMediaPart(source: GatewayProtocol, target: GatewayProtocol, part: CanonicalMediaPart, resolver: MediaResolver | undefined): Promise<{
    part: CanonicalMediaPart;
    diagnostics: ConversionDiagnostic[];
}>;
export declare function asMediaPart(value: JsonValue | undefined): CanonicalMediaPart | undefined;
