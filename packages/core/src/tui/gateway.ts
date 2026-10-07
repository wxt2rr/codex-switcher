export interface GatewayTuiProvider {
  id: string;
  status: string;
}

export interface GatewayTuiCredential {
  id: string;
  providerId: string;
  status: string;
}

export interface GatewayTuiModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  enabled: boolean;
}

export interface GatewayTuiRouteGroup {
  id: string;
  exposedModelId: string;
  strategy: string;
  sessionPolicy: string;
  members: number;
}

export interface GatewayTuiAgent {
  id: string;
  status: string;
}

export interface GatewayTuiUsage {
  window: "today";
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface GatewayTuiSnapshot {
  envName: string;
  mode: "manual" | "gateway";
  process: "running" | "stopped";
  gatewayId: string;
  providers: GatewayTuiProvider[];
  credentials: GatewayTuiCredential[];
  models: GatewayTuiModel[];
  routeGroups: GatewayTuiRouteGroup[];
  agents: GatewayTuiAgent[];
  profiles: string[];
  usage: GatewayTuiUsage;
}

export interface GatewayTuiAction {
  id:
    | "toggle-mode"
    | "start-stop"
    | "providers"
    | "models"
    | "groups"
    | "agents"
    | "usage"
    | "profiles"
    | "refresh"
    | "back";
  title: string;
  description: string;
}

export const GATEWAY_TUI_ACTIONS: GatewayTuiAction[] = [
  { id: "toggle-mode", title: "Toggle Mode", description: "Switch between manual account mode and Gateway routing" },
  { id: "start-stop", title: "Start/Stop", description: "Start or stop the local environment Gateway" },
  { id: "providers", title: "Providers", description: "List configured Provider sources and credentials" },
  { id: "models", title: "Models", description: "List logical and upstream model bindings" },
  { id: "groups", title: "Route Groups", description: "List explicit model RouteGroups and strategies" },
  { id: "agents", title: "Agents", description: "List Agent Gateway bindings and connection state" },
  { id: "usage", title: "Usage", description: "Show today's Gateway requests, tokens, and cost" },
  { id: "profiles", title: "Profiles", description: "List saved Gateway configuration profiles" },
  { id: "refresh", title: "Refresh", description: "Reload the current environment snapshot" },
  { id: "back", title: "Back", description: "Return to the main TUI" },
];

export function renderGatewayScreen(input: {
  snapshot: GatewayTuiSnapshot;
  selected?: number;
  message?: string;
}): string {
  const selected = input.selected ?? 0;
  const { snapshot } = input;
  const lines = [
    "codex-sw-node - Gateway",
    "",
    `Environment: ${snapshot.envName}`,
    `Mode: ${snapshot.mode === "gateway" ? "Gateway routing" : "Manual account switching"}`,
    `Process: ${snapshot.process}`,
    `Gateway: ${snapshot.gatewayId}`,
    `Providers: ${snapshot.providers.length}  Credentials: ${snapshot.credentials.length}`,
    `Models: ${snapshot.models.length}  RouteGroups: ${snapshot.routeGroups.length}  Agents: ${snapshot.agents.filter((agent) => agent.status === "connected").length}/${snapshot.agents.length}`,
    `Profiles: ${snapshot.profiles.length}`,
    `Usage (today): ${snapshot.usage.requests} requests  ${snapshot.usage.inputTokens + snapshot.usage.outputTokens} tokens  cost=${snapshot.usage.cost === null ? "n/a" : snapshot.usage.cost}`,
    "",
  ];

  if (snapshot.providers.length > 0) {
    lines.push(`Provider sources: ${snapshot.providers.map((provider) => `${provider.id}(${provider.status})`).join(", ")}`);
    lines.push("");
  }

  if (snapshot.routeGroups.length > 0) {
    lines.push("RouteGroups:");
    for (const group of snapshot.routeGroups) {
      lines.push(`- ${group.id}: ${group.exposedModelId} / ${group.strategy} / ${group.sessionPolicy} / ${group.members} members`);
    }
    lines.push("");
  }

  if (input.message) lines.push(input.message, "");

  for (const [index, action] of GATEWAY_TUI_ACTIONS.entries()) {
    const marker = index === selected ? ">" : " ";
    lines.push(`${marker} ${action.title.padEnd(14, " ")} ${action.description}`);
  }
  lines.push("", "Up/Down move  Enter select  Esc/q back", "");
  return lines.join("\n");
}
