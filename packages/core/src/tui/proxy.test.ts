import assert from "node:assert/strict";
import test from "node:test";

import { PROXY_PAGE_ACTIONS, renderProxyScreen } from "./proxy.js";

test("renderProxyScreen shows proxy source and actions", () => {
  const output = renderProxyScreen({
    status: {
      source: "manual",
      value: "http://127.0.0.1:7890",
    },
    selected: 1,
    message: "Manual proxy saved",
  });

  assert.match(output, /codex-sw-node - Proxy/);
  assert.match(output, /Current: manual \(http:\/\/127\.0\.0\.1:7890\)/);
  assert.match(output, /Manual proxy saved/);
  assert.match(output, /> Manual Input/);
  assert.match(output, /Auto Detect/);
  assert.match(output, /Test Proxy/);
  assert.equal(PROXY_PAGE_ACTIONS.length, 3);
});
