import type { GatewayProtocol } from "../protocol.js";
import type { AgentAdapterProfile, AgentConfigFormat, GatewayAgentId } from "./contracts.js";
/**
 * A metadata-only view of an existing Agent configuration.
 *
 * The credential value is deliberately never returned.  Import callers can
 * use `credentialPresent` to ask the user to map the existing secret into a
 * protected account, while the Gateway state only stores a secret reference.
 */
export interface AgentConfigurationImport {
    agentId: GatewayAgentId;
    displayName: string;
    configPath: string;
    format: AgentConfigFormat;
    protocol: GatewayProtocol;
    model?: string;
    baseUrl?: string;
    reasoningProfile?: string;
    fallbackModelId?: string;
    subAgentModelId?: string;
    credentialPresent: boolean;
    warnings: string[];
}
export declare function resolveAgentProfile(value: string): AgentAdapterProfile;
export declare function importAgentConfiguration(profile: AgentAdapterProfile, content: string): AgentConfigurationImport;
