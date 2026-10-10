import test from "node:test";
import assert from "node:assert/strict";

import { useLegacyProtocolConversion } from "./gateway-conversion-runtime.js";

test("shared gateway conversion is the default and legacy mode is explicit", () => {
  assert.equal(useLegacyProtocolConversion({}), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "0" }), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "1" }), true);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "true" }), true);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "yes" }), false);
});
