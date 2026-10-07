import test from "node:test";
import assert from "node:assert/strict";

import { initializeModelRouteEngine, resolveModelRoute } from "./model-router.js";
import type { RouteTarget } from "./usage-routing-model.js";

const routes: RouteTarget[] = [
  {
    routeId: "deepseek-route", envName: "work", accountName: "deepseek", providerId: "deepseek",
    exposedModelId: "deepseek-chat", upstreamModel: "deepseek-chat", upstreamBaseUrl: "https://deepseek.example/v1",
    originalBaseUrl: "https://deepseek.example/v1", protocol: "responses", reasoningProfile: "auto",
    enabled: true, createdAt: 1, updatedAt: 1,
  },
  {
    routeId: "chatgpt-route", envName: "work", accountName: "chatgpt", providerId: "chatgpt",
    exposedModelId: "gpt-5", upstreamModel: "gpt-5", upstreamBaseUrl: "https://chatgpt.example/v1",
    originalBaseUrl: "default", protocol: "responses", reasoningProfile: "auto",
    enabled: true, createdAt: 1, updatedAt: 1,
  },
];

test("desktop route adapter loads the shared framework-agnostic Gateway engine", async () => {
  assert.equal(await initializeModelRouteEngine(), true);
});

test("model router selects an exact logical model route", () => {
  const result = resolveModelRoute(routes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "deepseek-chat",
  });
  assert.equal("route" in result ? result.route.routeId : result.code, "deepseek-route");
  assert.equal("reason" in result ? result.reason : undefined, "model_exact");
});

test("model router does not silently send an unknown model to the default route", () => {
  const result = resolveModelRoute(routes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "unknown-model",
  });
  assert.deepEqual(result, {
    code: "MODEL_NOT_FOUND",
    message: "Model 'unknown-model' is not available in gateway 'gateway-work'",
  });
});

test("model router keeps account selection as an explicit compatibility fallback", () => {
  const result = resolveModelRoute(routes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedAccountName: "chatgpt",
  });
  assert.equal("route" in result ? result.route.routeId : result.code, "chatgpt-route");
  assert.equal("reason" in result ? result.reason : undefined, "account_exact");
});

test("model router resolves a cross-provider route group and keeps session selection deterministic", () => {
  const groupRoutes = routes.map((route, index) => ({
    ...route,
    routeId: `${route.routeId}-group`,
    routeGroupId: "shared-gpt",
    exposedModelId: `${route.providerId}:${route.upstreamModel}`,
    upstreamModel: "provider-model",
    accountName: index === 0 ? "first" : "second",
  }));
  const result = resolveModelRoute(groupRoutes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses",
    requestedModel: "gpt-shared", sessionKey: "conversation-1",
  }, undefined, {
    "shared-gpt": {
      id: "shared-gpt",
      exposedModelId: "gpt-shared",
      routeIds: groupRoutes.map((route) => route.routeId),
      strategy: "rotate",
      sessionPolicy: "session",
      fallbackEnabled: true,
    },
  });
  assert.equal("route" in result ? result.reason : result.code, "route_group");
  assert.equal("route" in result ? result.route.upstreamModel : undefined, "provider-model");
  const repeated = resolveModelRoute(groupRoutes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses",
    requestedModel: "gpt-shared", sessionKey: "conversation-1",
  }, undefined, {
    "shared-gpt": {
      id: "shared-gpt", exposedModelId: "gpt-shared", routeIds: groupRoutes.map((route) => route.routeId),
      strategy: "rotate", sessionPolicy: "session", fallbackEnabled: true,
    },
  });
  assert("route" in result && "route" in repeated);
  assert.equal(result.route.routeId, repeated.route.routeId);
});

test("model router expands group/<id> nested route groups", () => {
  const nestedRoute = { ...routes[0]!, routeId: "nested-route", routeGroupId: "inner" };
  const result = resolveModelRoute([nestedRoute], {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "nested-model",
  }, undefined, {
    inner: {
      id: "inner", exposedModelId: "inner-model", routeIds: [nestedRoute.routeId],
      strategy: "order", sessionPolicy: "off", fallbackEnabled: true,
    },
    outer: {
      id: "outer", exposedModelId: "nested-model", routeIds: [], nestedGroupIds: ["inner"],
      strategy: "order", sessionPolicy: "off", fallbackEnabled: true,
    },
  });
  assert.equal("route" in result ? result.route.routeId : result.code, "nested-route");
  assert.equal("reason" in result ? result.reason : undefined, "route_group");
});

test("model router rejects a route group that cannot satisfy required capabilities", () => {
  const result = resolveModelRoute(routes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "gpt-tools",
    requiredCapabilities: { tools: true },
  }, undefined, {
    "tools-group": {
      id: "tools-group", exposedModelId: "gpt-tools", routeIds: ["chatgpt-route"],
      strategy: "smart", sessionPolicy: "auto", fallbackEnabled: true, capabilities: { tools: false },
    },
  });
  assert.deepEqual(result, {
    code: "MODEL_NOT_FOUND",
    message: "Model group 'gpt-tools' does not support the requested capabilities",
  });
});

test("model router selects a converted upstream protocol only when the Gateway opts in", () => {
  const convertedRoute: RouteTarget = {
    ...routes[0],
    routeId: "anthropic-route",
    accountName: "anthropic",
    providerId: "anthropic",
    protocol: "anthropic",
    exposedModelId: "shared-model",
    upstreamModel: "claude-sonnet",
  };
  const group = {
    "shared-model": {
      id: "shared-model",
      exposedModelId: "shared-model",
      routeIds: [convertedRoute.routeId],
      strategy: "order" as const,
      sessionPolicy: "off" as const,
      fallbackEnabled: true,
    },
  };
  const withoutConversion = resolveModelRoute([convertedRoute], {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "shared-model",
  }, undefined, group);
  assert.deepEqual(withoutConversion, {
    code: "NO_ROUTE",
    message: "Gateway 'gateway-work' has no compatible route",
  });
  const withConversion = resolveModelRoute([convertedRoute], {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", allowProtocolConversion: true,
    requestedModel: "shared-model",
  }, undefined, group);
  assert.equal("route" in withConversion ? withConversion.route.routeId : withConversion.code, convertedRoute.routeId);
  assert.equal("route" in withConversion ? withConversion.route.protocol : undefined, "anthropic");
});

test("model router forwards runtime usage metrics to the shared usage strategy", async () => {
  await initializeModelRouteEngine();
  const groupRoutes = routes.map((route) => ({
    ...route,
    routeId: `${route.routeId}-usage`,
    exposedModelId: "usage-model",
    routeGroupId: "usage-model",
  }));
  const result = resolveModelRoute(groupRoutes, {
    gatewayId: "gateway-work", envName: "work", protocol: "responses", requestedModel: "usage-model",
    routeMetrics: {
      [groupRoutes[0]!.routeId]: { requestsInWindow: 8, tokensInWindow: 800, latencyMs: 120 },
      [groupRoutes[1]!.routeId]: { requestsInWindow: 1, tokensInWindow: 100, latencyMs: 40 },
    },
  }, undefined, {
    "usage-model": {
      id: "usage-model", exposedModelId: "usage-model", routeIds: groupRoutes.map((route) => route.routeId),
      strategy: "usage", sessionPolicy: "off", fallbackEnabled: true,
    },
  });
  assert.equal("route" in result ? result.route.routeId : result.code, groupRoutes[1]!.routeId);
});

test("model-name route rules remap an explicit model only when it is named by the rule", () => {
  const routed = {
    routeId: "routed-route",
    envName: "work",
    accountName: "routed",
    providerId: "anthropic",
    exposedModelId: "routed-model",
    upstreamModel: "routed-upstream",
    upstreamBaseUrl: "https://anthropic.example/v1",
    originalBaseUrl: "https://anthropic.example/v1",
    protocol: "anthropic" as const,
    reasoningProfile: "auto" as const,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const groups = {
    routed: {
      id: "routed",
      exposedModelId: "routed-model",
      routeIds: [routed.routeId],
      strategy: "order" as const,
      sessionPolicy: "off" as const,
      fallbackEnabled: true,
    },
  };
  const result = resolveModelRoute([routed], {
    gatewayId: "gateway-work",
    envName: "work",
    protocol: "responses",
    allowProtocolConversion: true,
    requestedModel: "requested-model",
    routeRules: [
      { id: "named-model", targetModelId: "routed-model", priority: 0, enabled: true, match: { modelIds: ["requested-model"] } },
    ],
    ruleContext: { requestedModel: "requested-model" },
  }, undefined, groups);
  assert.equal("route" in result ? result.route.routeId : result.code, "routed-route");
  assert.equal("reason" in result ? result.reason : undefined, "route_rule");
  assert.equal("routeGroupId" in result ? result.routeGroupId : undefined, "routed");
  assert.equal("routeRuleId" in result ? result.routeRuleId : undefined, "named-model");
});
