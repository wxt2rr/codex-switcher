import test from "node:test";
import assert from "node:assert/strict";

import { parseProxyStatusOutput, shouldAutoLoadProxy } from "./proxy-status.js";

test("parseProxyStatusOutput extracts detected and manual proxy values", () => {
  assert.equal(parseProxyStatusOutput("usage_api_proxy: http://127.0.0.1:7890 (auto-system)\n"), "http://127.0.0.1:7890");
  assert.equal(parseProxyStatusOutput("usage_api_proxy: http://proxy.test:8080 (manual)\n"), "http://proxy.test:8080");
  assert.equal(parseProxyStatusOutput("usage_api_proxy: off\n"), "");
});

test("automatic proxy loading does not overwrite a user edit", () => {
  assert.equal(shouldAutoLoadProxy("operations", false), true);
  assert.equal(shouldAutoLoadProxy("operations", true), false);
  assert.equal(shouldAutoLoadProxy("accounts", false), false);
});
