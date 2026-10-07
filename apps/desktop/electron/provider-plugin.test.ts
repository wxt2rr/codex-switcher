import assert from "node:assert/strict";
import test from "node:test";

import { materializePluginCredential, type GatewayProviderPlugin } from "./provider-plugin.js";

const plugin: GatewayProviderPlugin = {
  id: "custom-provider", version: "1.0.0",
  provider: { id: "custom-provider", displayName: "Custom", kind: "custom", endpoints: { responses: "https://example.test/v1" }, modelDiscovery: "plugin", enabled: true },
  resolveCredential: (input) => ({ id: input.credentialId, providerId: input.providerId, displayName: input.displayName, kind: "plugin", secretRef: input.secretRef, supportedProtocols: input.supportedProtocols, status: "active" }),
};

test("provider plugins materialize only managed credential metadata", () => {
  const credential = materializePluginCredential(plugin, { credentialId: "credential-1", displayName: "Plugin login", providerId: plugin.id, secretRef: "secure:credential-1", supportedProtocols: ["responses"] });
  assert.equal(credential.secretRef, "secure:credential-1");
  assert.equal(JSON.stringify(credential).includes("token"), false);
});

test("provider plugins cannot replace the managed secret reference", () => {
  assert.throws(() => materializePluginCredential({ ...plugin, resolveCredential: (input) => ({ ...plugin.resolveCredential(input), secretRef: "leaked" }) }, { credentialId: "credential-1", displayName: "Plugin login", providerId: plugin.id, secretRef: "secure:credential-1", supportedProtocols: ["responses"] }), /managed secret reference/);
});
