import type { GatewayProtocol, JsonObject } from "../protocol.js";
import { type GatewayRequestContext, type GatewayRequestIR } from "../request/request-ir.js";
import type { GatewayResponseEvent } from "../response/response-ir.js";
export interface GatewayProtocolCodec {
    readonly protocol: GatewayProtocol;
    decodeRequest(body: JsonObject, context: GatewayRequestContext): GatewayRequestIR;
    encodeRequest(request: GatewayRequestIR, upstreamModel?: string): JsonObject;
    decodeResponse(body: JsonObject): GatewayResponseEvent[];
    encodeResponse(events: GatewayResponseEvent[]): JsonObject;
}
export declare function decodeGatewayRequest(protocol: GatewayProtocol, body: JsonObject, context: GatewayRequestContext): GatewayRequestIR;
export declare function encodeGatewayRequest(protocol: GatewayProtocol, request: GatewayRequestIR, upstreamModel?: string): JsonObject;
export declare function decodeGatewayResponse(protocol: GatewayProtocol, body: JsonObject): GatewayResponseEvent[];
export declare function encodeGatewayResponse(protocol: GatewayProtocol, events: GatewayResponseEvent[]): JsonObject;
export declare function parseSseData(protocol: GatewayProtocol, data: string): GatewayResponseEvent[];
