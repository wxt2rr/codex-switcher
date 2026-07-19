import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUsageStore } from "./usage-store.js";
import type { AccountPool } from "./account-pool-routing.js";

test("usage store persists pool members, health, bindings, and cursor without secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pool-store-"));
  const store = await createUsageStore(join(dir, "usage.db"));
  const pool: AccountPool = {
    poolId: "pool-work", envName: "work", protocol: "responses", enabled: true,
    strategy: "sticky_weighted_round_robin", sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 2,
    createdAt: 1, updatedAt: 2,
    members: [{ accountName: "one", routeId: "route-one", protocol: "responses", upstreamBaseUrl: "https://api.example/v1", originalBaseUrl: "https://api.example/v1", enabled: true, weight: 2, priority: 0 }],
  };
  await store.upsertPool(pool, 3);
  await store.upsertPoolBinding({ poolId: pool.poolId, sessionKeyHash: "hash", accountName: "one", responseIds: ["resp"], createdAt: 1, lastUsedAt: 2, expiresAt: Date.now() + 60_000 });
  const saved = await store.listPools();
  assert.equal(saved[0].cursor, 3);
  assert.equal(saved[0].maxSameAccountFailures, 2);
  assert.equal(saved[0].members[0].accountName, "one");
  assert.deepEqual((await store.listPoolBindings(pool.poolId))[0].responseIds, ["resp"]);
  assert.equal(JSON.stringify(saved).includes("sk-"), false);
  await store.removePoolBindings(pool.poolId, "one");
  await store.removePool(pool.poolId);
  assert.deepEqual(await store.listPools(), []);
  await store.close();
});
