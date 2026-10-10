import type { GatewayProtocol, JsonObject } from "../protocol.js";
import type { ReasoningConversionState } from "./types.js";
export declare function decodeReasoning(protocol: GatewayProtocol, body: JsonObject): ReasoningConversionState | undefined;
export declare function encodeReasoning(protocol: GatewayProtocol, state: ReasoningConversionState | undefined): JsonObject | undefined;
