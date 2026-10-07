import type { GatewayCredentialDefinition, GatewayProviderDefinition } from "../../../packages/core/dist/gateway/model.js";

export interface ProviderPluginCredentialInput {
  credentialId: string;
  displayName: string;
  providerId: string;
  secretRef: string;
  supportedProtocols: GatewayCredentialDefinition["supportedProtocols"];
}

export interface GatewayProviderPlugin {
  id: string;
  version: string;
  provider: GatewayProviderDefinition;
  resolveCredential(input: ProviderPluginCredentialInput): GatewayCredentialDefinition;
}

export function validateProviderPlugin(plugin: GatewayProviderPlugin): void {
  if (!plugin.id.trim() || !plugin.version.trim()) throw new Error("Provider plugin identity is required");
  if (plugin.provider.id !== plugin.id) throw new Error("Provider plugin/provider IDs must match");
  if (!plugin.provider.enabled) throw new Error("Provider plugin must expose an enabled provider");
}

export function materializePluginCredential(
  plugin: GatewayProviderPlugin,
  input: ProviderPluginCredentialInput,
): GatewayCredentialDefinition {
  validateProviderPlugin(plugin);
  const credential = plugin.resolveCredential(input);
  if (credential.secretRef !== input.secretRef) throw new Error("Provider plugin cannot replace the managed secret reference");
  return { ...credential, providerId: plugin.id, secretRef: input.secretRef };
}
