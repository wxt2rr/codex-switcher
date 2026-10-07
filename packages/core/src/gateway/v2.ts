import {
  GATEWAY_SCHEMA_VERSION,
  containsExcludedGatewayRoutingFields,
  isGatewayEnvironmentState,
  type GatewayEnvironmentState,
  type GatewayProtocol,
} from "./model.js";

export const GATEWAY_PERSISTENCE_SCHEMA_VERSION = 2 as const;

export interface GatewayAgentBindingV2 {
  agentId: string;
  displayName: string;
  gatewayId: string;
  defaultModelId?: string;
  defaultRouteGroupId?: string;
  reasoningProfile?: string;
  fallbackModelId?: string;
  subAgentModelId?: string;
  originalConfigRef: string;
  enabled: boolean;
}

export interface GatewayEnvironmentStateV2
  extends Omit<GatewayEnvironmentState, "schemaVersion"> {
  schemaVersion: typeof GATEWAY_PERSISTENCE_SCHEMA_VERSION;
  environmentId: string;
  revision: number;
  sourceSchemaVersion: typeof GATEWAY_SCHEMA_VERSION | typeof GATEWAY_PERSISTENCE_SCHEMA_VERSION;
  listener: {
    basePath: string;
    protocols: GatewayProtocol[];
  };
  agentBindings: Record<string, GatewayAgentBindingV2>;
}

export function isGatewayEnvironmentStateV2(
  value: unknown,
): value is GatewayEnvironmentStateV2 {
  if (!isRecord(value) || value.schemaVersion !== GATEWAY_PERSISTENCE_SCHEMA_VERSION) {
    return false;
  }
  if (containsExcludedGatewayRoutingFields(value)) return false;
  if (!isGatewayEnvironmentShape(value)) return false;
  if (typeof value.environmentId !== "string" || !value.environmentId.trim()) return false;
  if (!Number.isInteger(value.revision) || value.revision < 1) return false;
  if (value.sourceSchemaVersion !== 1 && value.sourceSchemaVersion !== 2) return false;
  if (!isRecord(value.listener) || typeof value.listener.basePath !== "string" || !value.listener.basePath.startsWith("/")) {
    return false;
  }
  if (!Array.isArray(value.listener.protocols) || value.listener.protocols.some((protocol) =>
    protocol !== "responses" && protocol !== "chat_completions" && protocol !== "anthropic" && protocol !== "gemini")) {
    return false;
  }
  if (!isRecord(value.agentBindings)) return false;
  return Object.values(value.agentBindings).every(isGatewayAgentBindingV2);
}

export function migrateGatewayEnvironmentStateToV2(
  value: GatewayEnvironmentState | GatewayEnvironmentStateV2,
  environmentId = value.gatewayId,
): GatewayEnvironmentStateV2 {
  if (isGatewayEnvironmentStateV2(value)) return cloneV2(value);
  if (!isGatewayEnvironmentState(value)) {
    throw new Error("Cannot migrate an invalid gateway environment state");
  }
  const gatewayId = value.gatewayId.trim();
  return {
    ...value,
    schemaVersion: GATEWAY_PERSISTENCE_SCHEMA_VERSION,
    environmentId: environmentId.trim() || gatewayId,
    revision: 1,
    sourceSchemaVersion: GATEWAY_SCHEMA_VERSION,
    listener: {
      basePath: `/gateways/${encodeURIComponent(gatewayId)}`,
      protocols: ["responses", "chat_completions", "anthropic", "gemini"],
    },
    agentBindings: {},
  };
}

export function nextGatewayEnvironmentStateV2(
  previous: GatewayEnvironmentStateV2,
  patch: Partial<GatewayEnvironmentStateV2>,
): GatewayEnvironmentStateV2 {
  if (!isGatewayEnvironmentStateV2(previous)) {
    throw new Error("Cannot update an invalid gateway environment state");
  }
  const next = {
    ...cloneV2(previous),
    ...patch,
    schemaVersion: GATEWAY_PERSISTENCE_SCHEMA_VERSION,
    revision: previous.revision + 1,
    sourceSchemaVersion: GATEWAY_PERSISTENCE_SCHEMA_VERSION,
  } as GatewayEnvironmentStateV2;
  if (!isGatewayEnvironmentStateV2(next)) {
    throw new Error("Gateway environment state update is invalid");
  }
  return next;
}

export function toLegacyGatewayEnvironmentState(
  value: GatewayEnvironmentStateV2,
): GatewayEnvironmentState {
  if (!isGatewayEnvironmentStateV2(value)) {
    throw new Error("Cannot downgrade an invalid gateway environment state");
  }
  const {
    schemaVersion: _schemaVersion,
    environmentId: _environmentId,
    revision: _revision,
    sourceSchemaVersion: _sourceSchemaVersion,
    listener: _listener,
    agentBindings: _agentBindings,
    ...legacy
  } = value;
  return { ...legacy, schemaVersion: GATEWAY_SCHEMA_VERSION };
}

function cloneV2(value: GatewayEnvironmentStateV2): GatewayEnvironmentStateV2 {
  return JSON.parse(JSON.stringify(value)) as GatewayEnvironmentStateV2;
}

function isGatewayEnvironmentShape(value: Record<string, unknown>): boolean {
  return value.mode === "direct" || value.mode === "gateway"
    ? typeof value.gatewayId === "string"
      && isRecord(value.providers)
      && isRecord(value.credentials)
      && isRecord(value.models)
      && isRecord(value.routeGroups)
      && typeof value.catalogVersion === "number"
    : false;
}

function isGatewayAgentBindingV2(value: unknown): value is GatewayAgentBindingV2 {
  if (!isRecord(value)) return false;
  return typeof value.agentId === "string"
    && typeof value.displayName === "string"
    && typeof value.gatewayId === "string"
    && typeof value.originalConfigRef === "string"
    && typeof value.enabled === "boolean"
    && (value.defaultModelId === undefined || typeof value.defaultModelId === "string")
    && (value.defaultRouteGroupId === undefined || typeof value.defaultRouteGroupId === "string")
    && (value.reasoningProfile === undefined || typeof value.reasoningProfile === "string")
    && (value.fallbackModelId === undefined || typeof value.fallbackModelId === "string")
    && (value.subAgentModelId === undefined || typeof value.subAgentModelId === "string");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
