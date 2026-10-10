import type { GatewayProtocol, JsonObject } from "../protocol.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";
export declare function convertGatewayRequest(source: GatewayProtocol, target: GatewayProtocol, body: JsonObject, metadata?: ConversionMetadata, options?: ConversionOptions): Promise<ConversionResult<JsonObject>>;
