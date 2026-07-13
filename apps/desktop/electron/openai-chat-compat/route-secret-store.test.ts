import test from "node:test";
import assert from "node:assert/strict";

import { RouteSecretStore } from "./route-secret-store.js";

test("route secret store clones values and removes hydrated secrets", () => {
  const store = new RouteSecretStore();
  const secret = {
    routeId: "route-a",
    upstreamApiKey: "sk-upstream",
    localRouteToken: "local-token",
    hydratedAt: 123,
  };
  store.set(secret);
  const first = store.get("route-a");
  assert.deepEqual(first, secret);
  assert.notEqual(first, secret);
  if (first) first.upstreamApiKey = "mutated";
  assert.equal(store.get("route-a")?.upstreamApiKey, "sk-upstream");
  store.delete("route-a");
  assert.equal(store.get("route-a"), undefined);
});

test("route secret store rejects incomplete secrets", () => {
  const store = new RouteSecretStore();
  assert.throws(() => store.set({ routeId: "", upstreamApiKey: "key", localRouteToken: "token", hydratedAt: 1 }));
  assert.throws(() => store.set({ routeId: "route", upstreamApiKey: "", localRouteToken: "token", hydratedAt: 1 }));
  assert.throws(() => store.set({ routeId: "route", upstreamApiKey: "key", localRouteToken: "", hydratedAt: 1 }));
});
