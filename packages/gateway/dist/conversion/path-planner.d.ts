import type { GatewayProtocol } from "../protocol.js";
import { type ConversionPath } from "./formats.js";
import type { ConversionMetadata, ConversionOptions, ConversionPlanResult } from "./types.js";
export declare class ConversionPathPlanner {
    plan(from: GatewayProtocol, to: GatewayProtocol, metadata?: ConversionMetadata, options?: ConversionOptions): ConversionPlanResult;
    stepPaths(from: GatewayProtocol, to: GatewayProtocol): ConversionPath["steps"];
}
