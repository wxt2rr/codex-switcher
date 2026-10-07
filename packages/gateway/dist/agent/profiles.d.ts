import type { AgentAdapterProfile, GatewayAgentId } from "./contracts.js";
export declare const BUILT_IN_AGENT_PROFILES: readonly AgentAdapterProfile[];
export declare const AGENT_PROFILE_BY_ID: ReadonlyMap<GatewayAgentId, AgentAdapterProfile>;
export declare function getAgentProfile(id: GatewayAgentId): AgentAdapterProfile;
