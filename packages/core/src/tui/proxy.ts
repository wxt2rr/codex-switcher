export interface ProxyPageStatus {
  source: "manual" | "auto-env" | "auto-system" | "off";
  value: string;
}

export interface ProxyPageAction {
  id: "auto" | "manual" | "test";
  title: string;
  description: string;
}

export const PROXY_PAGE_ACTIONS: ProxyPageAction[] = [
  {
    id: "auto",
    title: "Auto Detect",
    description: "Disable manual proxy and use env or system detection",
  },
  {
    id: "manual",
    title: "Manual Input",
    description: "Set usage API proxy manually",
  },
  {
    id: "test",
    title: "Test Proxy",
    description: "Run usage API connectivity test through current proxy",
  },
];

export function renderProxyScreen(input: {
  status: ProxyPageStatus;
  selected?: number;
  message?: string;
}): string {
  const selected = input.selected ?? 0;
  const lines = [
    "codex-sw-node - Proxy",
    "",
    `Current: ${formatProxyStatus(input.status)}`,
    "",
  ];

  if (input.message) {
    lines.push(input.message, "");
  }

  for (const [index, action] of PROXY_PAGE_ACTIONS.entries()) {
    const marker = index === selected ? ">" : " ";
    lines.push(`${marker} ${action.title.padEnd(16, " ")} ${action.description}`);
  }

  lines.push("", "Up/Down move  Enter select  Esc/q back", "");
  return lines.join("\n");
}

function formatProxyStatus(status: ProxyPageStatus): string {
  if (status.source === "manual") {
    return `manual (${status.value})`;
  }
  if (status.source === "auto-env") {
    return `auto-detected from env (${status.value})`;
  }
  if (status.source === "auto-system") {
    return `auto-detected from system (${status.value})`;
  }
  return "auto-detect (no proxy detected)";
}
