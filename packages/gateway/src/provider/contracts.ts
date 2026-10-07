import type { GatewayRequestIR } from "../request/request-ir.js";
import type { GatewayResponseEvent } from "../response/response-ir.js";
import type { GatewayProtocol, JsonObject } from "../protocol.js";

export interface GatewayProtocolAdapter {
  readonly protocol: GatewayProtocol;
  decodeRequest(body: JsonObject): GatewayRequestIR;
  encodeRequest(request: GatewayRequestIR): JsonObject;
  decodeResponse(body: JsonObject): GatewayResponseEvent[];
  encodeResponse(events: GatewayResponseEvent[]): JsonObject;
}
