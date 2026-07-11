import test from "node:test";
import assert from "node:assert/strict";

import { maskApiKeyForDisplay } from "./api-key-display.js";

test("API key display preserves four leading and trailing characters", () => {
  assert.equal(maskApiKeyForDisplay("sk-abcd123456wxyz"), "sk-a****wxyz");
});

test("API key display masks short secrets without exposing the middle", () => {
  assert.equal(maskApiKeyForDisplay("12345678"), "1234****5678");
  assert.equal(maskApiKeyForDisplay("short"), "s****t");
  assert.equal(maskApiKeyForDisplay(""), "");
});
