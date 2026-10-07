import assert from "node:assert/strict";
import test from "node:test";

import { buildDesktopTrayActions } from "./tray-menu.js";

test("tray status distinguishes gateway routing from manual account switching", () => {
  const actions = buildDesktopTrayActions([{ envName: "personal", mode: "gateway", gatewayEnabled: true, localGatewayBaseUrl: "http://127.0.0.1:17832/gateways/personal" }]);
  assert.equal(actions.find((item) => item.id === "status")?.label, "personal: Gateway routing");
});

test("tray keeps a refresh action even when no gateway is configured", () => {
  const actions = buildDesktopTrayActions([]);
  assert.equal(actions.find((item) => item.id === "status")?.label, "No environment");
  assert.equal(actions.find((item) => item.id === "refresh")?.enabled, true);
});
