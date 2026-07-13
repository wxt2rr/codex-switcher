import test from "node:test";
import assert from "node:assert/strict";

import { runCompatibilityCheck, type CompatibilityStage } from "./compatibility-check.js";

test("mandatory probe failures fail, optional failures degrade, and full support is ready", async () => {
  for (const mandatory of ["auth", "text", "stream", "sequential_tool"] as CompatibilityStage[]) {
    const result = await runCompatibilityCheck({ probe: async (stage) => { if (stage === mandatory) throw new Error("no"); } });
    assert.equal(result.state, "failed");
  }
  const degraded = await runCompatibilityCheck({ probe: async (stage) => { if (stage === "parallel_tool") throw new Error("no parallel"); } });
  assert.equal(degraded.state, "degraded");
  assert.equal(degraded.capabilities.parallelTools, false);
  assert.equal((await runCompatibilityCheck({ probe: async () => undefined })).state, "ready");
});
