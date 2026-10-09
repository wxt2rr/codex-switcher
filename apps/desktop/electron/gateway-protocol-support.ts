import type {
  GatewayCredentialDefinition,
  GatewayProtocol,
  GatewayProviderDefinition,
} from "../../../packages/core/dist/gateway/model.js";

/**
 * Keep the CommonJS Electron side free of static imports from Core's ESM
 * runtime. The Core module remains the source of truth; these shape helpers
 * mirror its small protocol predicates for synchronous desktop compilation.
 */
export function gatewayProviderProtocols(
  provider: Pick<GatewayProviderDefinition, "endpoints">,
): GatewayProtocol[] {
  return [
    provider.endpoints.responses ? "responses" : undefined,
    provider.endpoints.chatCompletions ? "chat_completions" : undefined,
    provider.endpoints.anthropicMessages ? "anthropic" : undefined,
    provider.endpoints.gemini ? "gemini" : undefined,
  ].filter((protocol): protocol is GatewayProtocol => protocol !== undefined);
}

export function gatewayProviderSupportsProtocol(
  provider: Pick<GatewayProviderDefinition, "endpoints">,
  protocol: GatewayProtocol,
): boolean {
  return gatewayProviderProtocols(provider).includes(protocol);
}

export function gatewayCredentialSupportsProtocol(
  credential: Pick<GatewayCredentialDefinition, "supportedProtocols">,
  protocol: GatewayProtocol,
): boolean {
  return credential.supportedProtocols.includes(protocol);
}
