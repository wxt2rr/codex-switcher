import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { GatewayCapability } from "../../../packages/gateway/dist/protocol.js";
import type { RouteGroupNode, RuntimeRouteCandidate } from "../../../packages/gateway/dist/routing/engine.js";
import { getConfiguredResourcesPath, resolveRuntimeResource } from "./runtime-paths.js";
import type {
  EnvironmentGatewayRouteGroup,
  GatewayRequestContext,
  GatewayRouteRule,
  GatewayRouteRuleContext,
  RouteTarget,
} from "./usage-routing-model.js";

export interface ModelRouteDecision {
  route: RouteTarget;
  reason: "model_exact" | "route_group" | "route_rule" | "account_exact" | "default";
  routeGroupId?: string;
  /** Explicit metadata rule ID, if one selected this route. */
  routeRuleId?: string;
  fallbackRoutes?: RouteTarget[];
}

export interface ModelRouteFailure {
  code: "MODEL_NOT_FOUND" | "ACCOUNT_NOT_FOUND" | "NO_ROUTE";
  message: string;
}

type GatewayResolveRoute = typeof import("../../../packages/gateway/dist/routing/engine.js").resolveRoute;
let gatewayResolveRoute: GatewayResolveRoute | undefined;

/** Load the framework-agnostic route engine for the real desktop service. */
export async function initializeModelRouteEngine(): Promise<boolean> {
  if (gatewayResolveRoute) return true;
  const runtimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "routing", "engine.js"), {
    currentFile: typeof __filename === "string" ? __filename : join(process.cwd(), "apps", "desktop", "electron", "model-router.ts"),
    resourcesPath: getConfiguredResourcesPath(),
  });
  if (!existsSync(runtimePath)) return false;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ resolveRoute: GatewayResolveRoute }>;
    gatewayResolveRoute = (await dynamicImport(pathToFileURL(runtimePath).href)).resolveRoute;
    return true;
  } catch {
    gatewayResolveRoute = undefined;
    return false;
  }
}

export function resolveModelRoute(
  routes: RouteTarget[],
  context: GatewayRequestContext,
  defaultRouteId?: string,
  routeGroups: Record<string, EnvironmentGatewayRouteGroup> = {},
): ModelRouteDecision | ModelRouteFailure {
  // The packaged Gateway engine is the normal path.  Keep the same explicit
  // metadata-rule semantics when a portable deployment has to use this local
  // compatibility resolver instead.
  context = gatewayResolveRoute ? context : applyLocalRouteRule(context);
  const candidates = routes.filter((route) =>
    route.enabled && route.envName === context.envName
      && (context.allowProtocolConversion === true || route.protocol === context.protocol),
  );
  if (!candidates.length) {
    return { code: "NO_ROUTE", message: `Gateway '${context.gatewayId}' has no compatible route` };
  }

  const explicitRule = context.requestedModel
    ? selectLocalRouteRule(context.routeRules ?? [], { ...(context.ruleContext ?? {}), requestedModel: context.requestedModel })
    : undefined;
  const explicitRuleTarget = explicitRule?.targetModelId;
  if (explicitRuleTarget) {
    const ruleGroup = Object.values(routeGroups).find((group) => group.exposedModelId === explicitRuleTarget || group.id === explicitRuleTarget);
    if (ruleGroup) {
      if (!capabilitiesMatch(ruleGroup.capabilities, context.requiredCapabilities)) {
        return { code: "MODEL_NOT_FOUND", message: `Model group '${ruleGroup.exposedModelId}' does not support the requested capabilities` };
      }
      const groupRouteIds = expandGroupRouteIds(ruleGroup.id, routeGroups);
      const groupCandidates = candidates.filter((route) => groupRouteIds.includes(route.routeId)
        && capabilitiesMatch(route.capabilities, context.requiredCapabilities));
      const accountCandidates = context.requestedAccountName
        ? groupCandidates.filter((route) => route.accountName === context.requestedAccountName)
        : groupCandidates;
      if (!accountCandidates.length) {
        return { code: context.requestedAccountName ? "ACCOUNT_NOT_FOUND" : "MODEL_NOT_FOUND", message: context.requestedAccountName
          ? `Account '${context.requestedAccountName}' has no route in model group '${ruleGroup.exposedModelId}'`
          : `Model group '${ruleGroup.exposedModelId}' has no compatible route` };
      }
      return resolveWithGatewayEngine(accountCandidates, {
        ...context,
        requestedModel: ruleGroup.exposedModelId,
        routeRules: undefined,
        ruleContext: undefined,
      }, ruleGroup, "route_rule", routeGroups, explicitRule.id)
        ?? { route: selectRouteGroupCandidate(accountCandidates, ruleGroup, context, routeGroups), reason: "route_rule", routeGroupId: ruleGroup.id, routeRuleId: explicitRule.id };
    }
    const ruleCandidates = candidates.filter((route) =>
      (route.exposedModelId === explicitRuleTarget || route.upstreamModel === explicitRuleTarget)
      && capabilitiesMatch(route.capabilities, context.requiredCapabilities),
    );
    const accountCandidates = context.requestedAccountName
      ? ruleCandidates.filter((route) => route.accountName === context.requestedAccountName)
      : ruleCandidates;
    if (accountCandidates[0]) {
      return resolveWithGatewayEngine(accountCandidates, {
        ...context,
        requestedModel: explicitRuleTarget,
        routeRules: undefined,
        ruleContext: undefined,
      }, undefined, "route_rule", routeGroups, explicitRule.id)
        ?? { route: accountCandidates[0], reason: "route_rule", routeRuleId: explicitRule.id };
    }
    return { code: "MODEL_NOT_FOUND", message: `Model '${explicitRuleTarget}' is not available in gateway '${context.gatewayId}'` };
  }

  if (context.requestedModel?.trim()) {
    const requestedModel = context.requestedModel.trim();
    const routeGroup = Object.values(routeGroups).find((group) => group.exposedModelId === requestedModel);
    if (routeGroup) {
      const groupRouteIds = expandGroupRouteIds(routeGroup.id, routeGroups);
      const groupCandidates = candidates.filter((route) => groupRouteIds.includes(route.routeId)
        && capabilitiesMatch(route.capabilities, context.requiredCapabilities));
      if (!capabilitiesMatch(routeGroup.capabilities, context.requiredCapabilities)) {
        return { code: "MODEL_NOT_FOUND", message: `Model group '${requestedModel}' does not support the requested capabilities` };
      }
      const accountCandidates = context.requestedAccountName
        ? groupCandidates.filter((route) => route.accountName === context.requestedAccountName)
        : groupCandidates;
      if (accountCandidates[0]) {
        return resolveWithGatewayEngine(accountCandidates, context, routeGroup, "route_group", routeGroups)
          ?? { route: selectRouteGroupCandidate(accountCandidates, routeGroup, context, routeGroups), reason: "route_group" };
      }
      return { code: context.requestedAccountName ? "ACCOUNT_NOT_FOUND" : "MODEL_NOT_FOUND", message: context.requestedAccountName
        ? `Account '${context.requestedAccountName}' has no route in model group '${requestedModel}'`
        : `Model group '${requestedModel}' has no compatible route` };
    }
    const modelCandidates = candidates.filter((route) =>
      (route.exposedModelId === requestedModel || route.upstreamModel === requestedModel)
        && capabilitiesMatch(route.capabilities, context.requiredCapabilities),
    );
    const accountCandidates = context.requestedAccountName
      ? modelCandidates.filter((route) => route.accountName === context.requestedAccountName)
      : modelCandidates;
    if (accountCandidates[0]) return resolveWithGatewayEngine(accountCandidates, context, undefined, "model_exact", routeGroups)
      ?? { route: accountCandidates[0], reason: "model_exact" };
    return { code: "MODEL_NOT_FOUND", message: `Model '${requestedModel}' is not available in gateway '${context.gatewayId}'` };
  }

  if (context.requestedAccountName) {
    const accountRoute = candidates.find((route) => route.accountName === context.requestedAccountName
      && capabilitiesMatch(route.capabilities, context.requiredCapabilities));
    if (accountRoute) return resolveWithGatewayEngine([accountRoute], context, undefined, "account_exact", routeGroups)
      ?? { route: accountRoute, reason: "account_exact" };
    return { code: "ACCOUNT_NOT_FOUND", message: `Account '${context.requestedAccountName}' has no compatible route` };
  }

  const compatibleCandidates = candidates.filter((route) => capabilitiesMatch(route.capabilities, context.requiredCapabilities));
  if (!compatibleCandidates.length) return { code: "NO_ROUTE", message: `Gateway '${context.gatewayId}' has no route for the requested capabilities` };
  const defaultRoute = defaultRouteId ? compatibleCandidates.find((route) => route.routeId === defaultRouteId) : undefined;
  return resolveWithGatewayEngine(defaultRoute ? [defaultRoute, ...compatibleCandidates.filter((route) => route.routeId !== defaultRoute.routeId)] : compatibleCandidates, context, undefined, "default", routeGroups)
    ?? { route: defaultRoute ?? compatibleCandidates[0], reason: "default" };
}

function resolveWithGatewayEngine(
  routes: RouteTarget[],
  context: GatewayRequestContext,
  routeGroup: EnvironmentGatewayRouteGroup | undefined,
  reason: ModelRouteDecision["reason"],
  routeGroups: Record<string, EnvironmentGatewayRouteGroup>,
  explicitRouteRuleId?: string,
): ModelRouteDecision | undefined {
  if (!gatewayResolveRoute || !routes.length) return undefined;
  const candidates: RuntimeRouteCandidate[] = routes.map((route, index) => ({
    id: route.routeId,
    providerId: route.providerId ?? "custom",
    credentialId: route.routeId,
    modelId: route.upstreamModel ?? route.exposedModelId ?? route.routeId,
    protocol: route.protocol,
    capabilities: routeCapabilitiesToList(route.capabilities),
    priority: index,
    weight: routeGroup?.weights?.[route.routeId] ?? 1,
    healthy: true,
    ...context.routeMetrics?.[route.routeId],
  }));
  const group: RouteGroupNode = {
    id: routeGroup?.id ?? "__explicit_default__",
    displayName: routeGroup?.exposedModelId ?? "Explicit default",
    exposedModelId: routeGroup?.exposedModelId ?? "__explicit_default__",
    members: routeGroup
      ? [
        ...routeGroup.routeIds.filter((routeId) => routes.some((route) => route.routeId === routeId)),
        ...(routeGroup.nestedGroupIds ?? []).map((groupId) => `group/${groupId}`),
      ]
      : candidates.map((candidate) => candidate.id),
    strategy: routeGroup?.strategy ?? "order",
    affinity: routeGroup ? routeGroup.sessionPolicy : "off",
    fallbackEnabled: routeGroup?.fallbackEnabled ?? true,
    priority: 0,
    ...(routeGroup?.weights ? { weights: routeGroup.weights } : {}),
    ...(routeGroup?.capabilities ? { capabilities: routeGroup.capabilities } : {}),
  };
  const engineGroupEntries = Object.values(routeGroups).map((candidateGroup): RouteGroupNode => ({
    id: candidateGroup.id,
    displayName: candidateGroup.exposedModelId,
    exposedModelId: candidateGroup.exposedModelId,
    members: [
      ...candidateGroup.routeIds.filter((routeId) => routes.some((route) => route.routeId === routeId)),
      ...(candidateGroup.nestedGroupIds ?? []).map((groupId) => `group/${groupId}`),
    ],
    strategy: candidateGroup.strategy,
    affinity: candidateGroup.sessionPolicy,
    fallbackEnabled: candidateGroup.fallbackEnabled,
    ...(candidateGroup.weights ? { weights: candidateGroup.weights } : {}),
    ...(candidateGroup.capabilities ? { capabilities: candidateGroup.capabilities } : {}),
    priority: 0,
  })).filter((candidateGroup) => candidateGroup.members.length > 0);
  const engineGroups: Record<string, RouteGroupNode> = Object.fromEntries(engineGroupEntries.map((candidateGroup) => [candidateGroup.id, candidateGroup]));
  engineGroups[group.id] = group;
  try {
    const result = gatewayResolveRoute(candidates, engineGroups, {
      // Leave the model unset for default Gateway requests so the shared
      // engine can evaluate explicit metadata rules.  An explicitly supplied
      // model has already been resolved by the adapter and must remain an
      // explicit override.
      requestedModel: context.requestedModel ? group.exposedModelId : undefined,
      protocol: context.protocol,
      allowProtocolConversion: context.allowProtocolConversion === true,
      requiredCapabilities: requiredCapabilitiesToMap(context.requiredCapabilities),
      sessionKey: context.sessionKey,
      agentId: context.gatewayId,
      rules: context.routeRules,
      ruleContext: context.ruleContext,
    });
    const routeById = new Map(routes.map((route) => [route.routeId, route]));
    const selected = routeById.get(result.route.credentialId);
    if (!selected) return undefined;
    return {
      route: selected,
      reason: result.traces.some((trace) => trace.reason.startsWith("matched explicit route rule ")) ? "route_rule" : reason,
      ...(() => {
        if (explicitRouteRuleId) return { routeRuleId: explicitRouteRuleId };
        const match = result.traces.find((trace) => trace.reason.startsWith("matched explicit route rule "))?.reason.match(/^matched explicit route rule '([^']+)'$/);
        return match?.[1] ? { routeRuleId: match[1] } : {};
      })(),
      ...(reason === "route_rule" && routeGroup?.id
        ? { routeGroupId: routeGroup.id }
        : result.groupId && result.groupId !== group.id && result.groupId !== "__explicit_default__"
          ? { routeGroupId: result.groupId }
          : {}),
      fallbackRoutes: result.fallbackRoutes.flatMap((fallback) => {
        const candidate = routeById.get(fallback.credentialId);
        return candidate ? [candidate] : [];
      }),
    };
  } catch {
    return undefined;
  }
}

function applyLocalRouteRule(context: GatewayRequestContext): GatewayRequestContext {
  if (context.requestedModel || !context.routeRules?.length) return context;
  const targetModelId = selectLocalRouteRule(context.routeRules, context.ruleContext)?.targetModelId;
  return targetModelId ? { ...context, requestedModel: targetModelId } : context;
}

function selectLocalRouteRule(rules: readonly GatewayRouteRule[], context: GatewayRouteRuleContext | undefined): GatewayRouteRule | undefined {
  const ruleContext = context ?? {};
  return [...rules]
    .filter((rule) => rule.enabled
      && localRouteRuleMatches(rule.match, ruleContext)
      && (ruleContext.requestedModel === undefined || Boolean(rule.match.modelIds?.includes(ruleContext.requestedModel))))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
}

function localRouteRuleMatches(
  match: GatewayRouteRule["match"],
  context: GatewayRouteRuleContext,
): boolean {
  if (match.tokenCount) {
    if (context.tokenCount === undefined) return false;
    if (match.tokenCount.min !== undefined && context.tokenCount < match.tokenCount.min) return false;
    if (match.tokenCount.max !== undefined && context.tokenCount > match.tokenCount.max) return false;
  }
  if (match.hasImages !== undefined && context.hasImages !== match.hasImages) return false;
  if (match.reasoning !== undefined && context.reasoning !== match.reasoning) return false;
  if (match.reasoningProfiles?.length && (!context.reasoningProfile || !match.reasoningProfiles.includes(context.reasoningProfile))) return false;
  if (match.agentIds?.length && (!context.agentId || !match.agentIds.includes(context.agentId))) return false;
  if (match.contextCompacted !== undefined && context.contextCompacted !== match.contextCompacted) return false;
  if (match.modelIds?.length && (!context.requestedModel || !match.modelIds.includes(context.requestedModel))) return false;
  if (match.providerIds?.length && (!context.providerId || !match.providerIds.includes(context.providerId))) return false;
  if (match.time && !localRouteRuleTimeMatches(match.time, context.now ?? Date.now())) return false;
  return true;
}

function localRouteRuleTimeMatches(
  match: NonNullable<GatewayRouteRule["match"]["time"]>,
  timestamp: number,
): boolean {
  const date = new Date(timestamp);
  const hour = match.timezone === "utc" ? date.getUTCHours() : date.getHours();
  const day = match.timezone === "utc" ? date.getUTCDay() : date.getDay();
  if (match.daysOfWeek?.length && !match.daysOfWeek.includes(day)) return false;
  if (match.startHour === match.endHour) return true;
  return match.startHour < match.endHour
    ? hour >= match.startHour && hour < match.endHour
    : hour >= match.startHour || hour < match.endHour;
}

function routeCapabilitiesToList(value: RouteTarget["capabilities"] | undefined): GatewayCapability[] {
  return Object.entries(value ?? {}).filter(([, enabled]) => enabled === true).map(([key]) => key as GatewayCapability);
}

function requiredCapabilitiesToMap(value: GatewayRequestContext["requiredCapabilities"] | undefined): Partial<Record<GatewayCapability, boolean>> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([, enabled]) => enabled === true)) as Partial<Record<GatewayCapability, boolean>>;
}

function selectRouteGroupCandidate(
  candidates: RouteTarget[],
  group: EnvironmentGatewayRouteGroup,
  context: GatewayRequestContext,
  routeGroups: Record<string, EnvironmentGatewayRouteGroup> = { [group.id]: group },
): RouteTarget {
  const ordered = expandGroupRouteIds(group.id, routeGroups)
    .map((routeId) => candidates.find((route) => route.routeId === routeId))
    .filter((route): route is RouteTarget => Boolean(route));
  if (ordered.length <= 1 || group.strategy === "order" || group.strategy === "smart" || group.sessionPolicy === "off") {
    return ordered[0] ?? candidates[0];
  }
  const key = context.sessionKey ?? `${context.gatewayId}:${context.envName}:${group.id}`;
  const index = stableHash(key) % ordered.length;
  return ordered[index] ?? ordered[0] ?? candidates[0];
}

function expandGroupRouteIds(
  groupId: string,
  routeGroups: Record<string, EnvironmentGatewayRouteGroup>,
  visiting = new Set<string>(),
  depth = 0,
): string[] {
  if (depth >= 8 || visiting.has(groupId)) return [];
  const group = routeGroups[groupId];
  if (!group) return [];
  const nextVisiting = new Set(visiting).add(groupId);
  const routeIds = [...group.routeIds];
  for (const nestedId of group.nestedGroupIds ?? []) {
    routeIds.push(...expandGroupRouteIds(nestedId.replace(/^group\//, ""), routeGroups, nextVisiting, depth + 1));
  }
  return [...new Set(routeIds)];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function capabilitiesMatch(
  available: RouteTarget["capabilities"] | EnvironmentGatewayRouteGroup["capabilities"],
  required: GatewayRequestContext["requiredCapabilities"],
): boolean {
  if (!required) return true;
  return Object.entries(required).every(([key, needed]) => {
    if (!needed) return true;
    return available?.[key as keyof NonNullable<typeof available>] === true;
  });
}
