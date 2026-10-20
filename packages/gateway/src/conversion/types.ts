import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ConversionDiagnostic, ToolLossPolicy } from "./diagnostics.js";
import type { ConversionPath, ConversionQuality, ConversionStep } from "./formats.js";
import type { CapabilityProfile } from "../capability/contracts.js";

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
  /**
   * Role used for developer instructions when encoding Chat Completions.
   * Most compatible providers only accept `system`; preserve `developer`
   * only when the route explicitly opts into it.
   */
  instructionRole?: "auto" | "system" | "developer";
  /** Capability observations for the selected provider/model/protocol route. */
  capabilityProfile?: CapabilityProfile;
  /** Safe mode omits unknown hosted tools; allow preserves legacy conversion. */
  capabilityPolicy?: "safe" | "allow";
  mediaResolver?: MediaResolver;
  emitSequenceNumber?: boolean;
}

export interface MediaResolver {
  resolveImage?(input: string): Promise<{ mimeType: string; data: string }>;
  resolveFile?(input: string): Promise<{ mimeType: string; data: string; fileName?: string }>;
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
