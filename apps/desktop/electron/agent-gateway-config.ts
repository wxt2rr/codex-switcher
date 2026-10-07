export interface AgentGatewayBinding {
  agentId: string;
  displayName: string;
  gatewayId: string;
  defaultModelId?: string;
  defaultRouteGroupId?: string;
  reasoningProfile?: string;
  fallbackModelId?: string;
  subAgentModelId?: string;
  originalConfigRef: string;
  enabled: boolean;
}

export function buildAgentGatewayBinding(input: Omit<AgentGatewayBinding, "enabled"> & { enabled?: boolean }): AgentGatewayBinding {
  return { ...input, enabled: input.enabled ?? true };
}

export function restoreAgentConfigRef(binding: AgentGatewayBinding): string {
  return binding.originalConfigRef;
}
