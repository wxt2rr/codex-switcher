import test from "node:test";
import assert from "node:assert/strict";

import { PluginHost, type GatewayPluginManifest, type PluginRpcRequest, type PluginTransport } from "./host.js";
import { GatewayMiddlewareRegistry, type ActiveGatewayMiddleware, type GatewayMiddlewareContext } from "./middleware.js";

const context: GatewayMiddlewareContext = {
  requestId: "request-1",
  traceId: "trace-1",
  protocol: "responses",
  model: "demo-model",
  stream: true,
  state: {},
};

function activeMiddleware(
  id: string,
  priority: number,
  hooks: ActiveGatewayMiddleware["hooks"],
  handler: (request: PluginRpcRequest) => unknown,
): ActiveGatewayMiddleware {
  const manifest: GatewayPluginManifest = {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 2,
    entry: "plugin.mjs",
    permissions: ["middleware"],
  };
  const transport: PluginTransport = {
    send: async (request) => ({ jsonrpc: "2.0", id: request.id, result: handler(request) }),
    close: async () => undefined,
  };
  return { id, name: id, priority, manifest, hooks, host: new PluginHost(transport, { manifest }) };
}

test("middleware registry applies deterministic request/event/response order and state", async () => {
  const registry = new GatewayMiddlewareRegistry();
  registry.register(activeMiddleware("late", 20, ["onRequest", "onEvent", "onResponse"], (request) => {
    if (request.method === "middleware.onRequest") {
      const body = request.params?.body as Record<string, unknown>;
      const current = request.params?.context as GatewayMiddlewareContext;
      current.state.late = true;
      return { body: { ...body, order: `${String(body.order ?? "")}|late` } };
    }
    if (request.method === "middleware.onEvent") return { body: { ...(request.params?.event as Record<string, unknown>), late: true } };
    return { body: { ...(request.params?.body as Record<string, unknown>), response: true } };
  }));
  registry.register(activeMiddleware("early", 10, ["onRequest", "onEvent", "onResponse"], (request) => {
    if (request.method === "middleware.onRequest") {
      const body = request.params?.body as Record<string, unknown>;
      return { body: { ...body, order: `${String(body.order ?? "")}|early` } };
    }
    if (request.method === "middleware.onEvent") return { body: { ...(request.params?.event as Record<string, unknown>), early: true } };
    return { body: { ...(request.params?.body as Record<string, unknown>), response: "early" } };
  }));

  const request = await registry.runRequest({ hello: "world" }, context);
  assert.deepEqual(request.body, { hello: "world", order: "|early|late" });
  assert.equal(context.state.late, true);
  const event = await registry.runEvent({ delta: "x" }, context);
  assert.deepEqual(event, { event: { delta: "x", early: true, late: true } });
  const response = await registry.runResponse({ result: "ok" }, context);
  assert.deepEqual(response.body, { result: "ok", response: true });
  await registry.close();
});

test("middleware registry is fail-open for crashes but honors explicit reject and drop", async () => {
  const registry = new GatewayMiddlewareRegistry();
  registry.register(activeMiddleware("broken", 1, ["onRequest", "onEvent"], () => { throw new Error("crashed"); }));
  registry.register(activeMiddleware("dropper", 4, ["onEvent"], (request) => request.method === "middleware.onEvent" ? { drop: true } : undefined));
  registry.register(activeMiddleware("rejector", 2, ["onRequest", "onEvent"], (request) => request.method === "middleware.onEvent"
    ? { reject: { status: 429, code: "RATE_LIMITED", message: "slow down" } }
    : { reject: { status: 400, code: "BAD_REQUEST", message: "blocked" } }));

  const request = await registry.runRequest({ hello: "world" }, context);
  assert.deepEqual(request.reject, { status: 400, code: "BAD_REQUEST", message: "blocked" });
  const event = await registry.runEvent({ delta: "x" }, context);
  assert.deepEqual(event.reject, { status: 429, code: "RATE_LIMITED", message: "slow down" });
  const dropRegistry = new GatewayMiddlewareRegistry();
  dropRegistry.register(activeMiddleware("dropper", 1, ["onEvent"], () => ({ drop: true })));
  assert.deepEqual(await dropRegistry.runEvent({ delta: "x" }, context), { event: null });
  await registry.close();
  await dropRegistry.close();
});
