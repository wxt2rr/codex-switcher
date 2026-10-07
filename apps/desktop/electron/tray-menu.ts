export interface DesktopTrayGatewayState {
  envName: string;
  mode: "direct" | "gateway";
  gatewayEnabled: boolean;
  localGatewayBaseUrl?: string;
}

export interface DesktopTrayAction {
  id: "open" | "refresh" | "quit" | "status" | "separator";
  label: string;
  enabled: boolean;
}

export function buildDesktopTrayActions(states: readonly DesktopTrayGatewayState[]): DesktopTrayAction[] {
  const first = states[0];
  return [
    { id: "open", label: "Open Codex Switcher", enabled: true },
    { id: "status", label: first ? `${first.envName}: ${first.mode === "gateway" && first.gatewayEnabled ? "Gateway routing" : "Manual switching"}` : "No environment", enabled: false },
    { id: "separator", label: "", enabled: true },
    { id: "refresh", label: "Refresh gateway status", enabled: true },
    { id: "quit", label: "Quit", enabled: true },
  ];
}
