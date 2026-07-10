import test from "node:test";
import assert from "node:assert/strict";

import { parseOperationOutput } from "./operation-result.js";

test("parseOperationOutput summarizes proxy output", () => {
  const summary = parseOperationOutput("ops", "proxy", [], "usage_api_proxy: http://127.0.0.1:7890");

  assert.ok(summary);
  assert.equal(summary?.title, "Proxy");
  assert.equal(summary?.sections[0]?.entries[0]?.label, "Proxy");
});

test("parseOperationOutput summarizes token refresh status", () => {
  const output = [
    "token_refresh_guard: enabled",
    "token_refresh_need_relogin_last_run: 0",
    "Summary: scanned=2 fresh=1 checked=2 refreshed=0 failed=0 relogin=0 duration=1.2s",
  ].join("\n");

  const summary = parseOperationOutput("ops", "token-refresh", ["status"], output);

  assert.ok(summary);
  assert.equal(summary?.title, "Token Refresh");
  assert.equal(summary?.tone, "ok");
  assert.equal(summary?.sections[1]?.entries[0]?.value, "2");
});

test("parseOperationOutput summarizes CLI session launch output", () => {
  const summary = parseOperationOutput("cli", "launch-current", [], "opened cli session\ncompleted");

  assert.ok(summary);
  assert.equal(summary?.title, "CLI Session");
  assert.equal(summary?.status, "Opened");
  assert.equal(summary?.sections[0]?.entries[0]?.label, "Session");
  assert.equal(summary?.sections[0]?.entries[0]?.value, "Opened");
});
