import assert from "node:assert/strict";
import test from "node:test";

import { buildLegacyGatewayEnvironmentState } from "../../../packages/core/dist/gateway/legacy-adapter.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import {
  createAccountSecretRef,
  createGatewayAccountDiscoveryView,
  resolveRuntimeProviderId,
  synchronizeGatewayAccountMetadata,
} from "./gateway-account-sync.js";

function environment(): EnvState {
  return {
    name: "test",
    path: "/tmp/test",
    accounts: {
      阿里云: {
        name: "阿里云",
        authMode: "apikey",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrlMode: "custom",
          openaiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          providerId: "qwen",
          providerAuthMethod: "api_key",
          apiProtocol: "chat_completions",
        },
      },
    },
  };
}

test("runtime provider id is preferred over the legacy default", () => {
  const env = environment();
  assert.equal(resolveRuntimeProviderId(env.accounts["阿里云"]!), "qwen");
  assert.equal(createAccountSecretRef("test", "阿里云"), "account:test:%E9%98%BF%E9%87%8C%E4%BA%91");
});

test("provider switch synchronizes credential, provider, and account routes", () => {
  const env = environment();
  const gateway = buildLegacyGatewayEnvironmentState({
    ...env,
    accounts: {
      阿里云: {
        ...env.accounts["阿里云"]!,
        runtime: {
          ...env.accounts["阿里云"]!.runtime,
          providerId: "openai",
          apiProtocol: "responses",
          openaiBaseUrl: "https://legacy.example/v1",
        },
      },
    },
  });
  const credentialId = Object.keys(gateway.credentials)[0]!;
  const modelId = "legacy-model";
  const routeGroupId = "legacy-group";
  gateway.models[modelId] = {
    id: modelId,
    providerId: "openai",
    upstreamModelId: "qwen-plus",
    displayName: "Qwen Plus",
    protocols: ["responses"],
    capabilities: {},
    enabled: true,
  };
  gateway.routeGroups[routeGroupId] = {
    id: routeGroupId,
    displayName: "Qwen Plus",
    exposedModelId: "qwen-plus",
    members: [{
      providerId: "openai",
      modelId,
      credentialSelector: { credentialIds: [credentialId] },
      priority: 0,
      weight: 1,
    }],
    strategy: "smart",
    sessionPolicy: "auto",
    fallbackEnabled: true,
  };
  const persisted = structuredClone(gateway);

  const next = synchronizeGatewayAccountMetadata(env, gateway);
  const credential = next.credentials[credentialId]!;
  assert.equal(credential.providerId, "qwen");
  assert.equal(credential.secretRef, createAccountSecretRef("test", "阿里云"));
  assert.deepEqual(credential.supportedProtocols.sort(), ["chat_completions", "responses"]);
  assert.equal(next.providers.qwen?.endpoints.responses, "https://legacy.example/v1");
  assert.equal(next.providers.qwen?.endpoints.chatCompletions, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(next.routeGroups[routeGroupId]!.members[0]!.providerId, "qwen");
  assert.equal(next.models[modelId]!.providerId, "qwen");
  assert.equal(gateway.credentials[credentialId]!.providerId, "openai");
  assert.equal(persisted.providers.openai?.endpoints.responses, "https://legacy.example/v1");
});

test("discovery view is isolated and only rebinds the selected account", () => {
  const env = environment();
  const gateway = buildLegacyGatewayEnvironmentState({
    ...env,
    accounts: {
      阿里云: env.accounts["阿里云"]!,
      other: {
        name: "other",
        authMode: "apikey",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrlMode: "custom",
          openaiBaseUrl: "https://other.example/v1",
          providerId: "openai",
          apiProtocol: "responses",
        },
      },
    },
  });
  const view = createGatewayAccountDiscoveryView(env, gateway, "阿里云");
  const selected = Object.values(view.credentials).find((credential) => credential.secretRef === createAccountSecretRef("test", "阿里云"));
  const other = Object.values(view.credentials).find((credential) => credential.secretRef === createAccountSecretRef("test", "other"));
  assert.equal(selected?.providerId, "qwen");
  assert.equal(other?.providerId, "openai");
  const originalOther = Object.values(gateway.credentials).find((credential) => credential.secretRef === createAccountSecretRef("test", "other"));
  assert.equal(originalOther?.providerId, "openai");
});
