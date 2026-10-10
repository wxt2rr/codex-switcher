import type { GatewayProtocol } from "../protocol.js";
import { planConversion, type ConversionPath } from "./formats.js";
import type { ConversionMetadata, ConversionOptions, ConversionPlanResult } from "./types.js";

export class ConversionPathPlanner {
  plan(
    from: GatewayProtocol,
    to: GatewayProtocol,
    metadata: ConversionMetadata = {},
    options: ConversionOptions = {},
  ): ConversionPlanResult {
    const path = planConversion(from, to);
    return { path, metadata: { ...metadata }, options: { ...options } };
  }

  stepPaths(from: GatewayProtocol, to: GatewayProtocol): ConversionPath["steps"] {
    return planConversion(from, to).steps;
  }
}
