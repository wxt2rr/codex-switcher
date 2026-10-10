import type { GatewayProtocol } from "../protocol.js";
export type ConversionQuality = "good" | "fair" | "discouraged";
export interface ConversionStep {
    id: string;
    from: GatewayProtocol;
    to: GatewayProtocol;
    kind: "identity" | "direct" | "pivot";
}
export interface ConversionPath {
    from: GatewayProtocol;
    to: GatewayProtocol;
    quality: ConversionQuality;
    steps: ConversionStep[];
}
export declare function planConversion(from: GatewayProtocol, to: GatewayProtocol): ConversionPath;
export declare function conversionMatrix(): ConversionPath[];
