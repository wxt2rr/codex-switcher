export interface AccountListItem {
  envName: string;
  name: string;
  authMode: string;
  isCurrentCli?: boolean;
  isCurrentApp?: boolean;
  runtime?: {
    preferredAuthMethod?: string;
    openaiBaseUrl?: string;
  };
  apiKeyPreview?: string;
}

export function buildAccountsLines(accounts: AccountListItem[]): string[] {
  const grouped = new Map<string, AccountListItem[]>();
  for (const account of accounts) {
    const list = grouped.get(account.envName) || [];
    list.push(account);
    grouped.set(account.envName, list);
  }

  const lines: string[] = [];
  for (const envName of [...grouped.keys()].sort()) {
    lines.push(`ENV: ${envName}`);
    lines.push("--------------------------------------------------------");

    for (const account of (grouped.get(envName) || []).sort((a, b) => a.name.localeCompare(b.name))) {
      const tags = [
        account.isCurrentCli ? "[cli]" : "",
        account.isCurrentApp ? "[app]" : "",
      ]
        .filter(Boolean)
        .join(" ");

      lines.push(`${account.name}${tags ? ` ${tags}` : ""}`);
      lines.push(
        `  auth: ${account.authMode} / ${account.runtime?.preferredAuthMethod ?? "-"}`,
      );
      if (account.authMode === "apikey") {
        lines.push(`  api key: ${account.apiKeyPreview ?? "-"}`);
        lines.push(`  base url: ${account.runtime?.openaiBaseUrl || "default"}`);
      }
      lines.push("");
    }
  }

  if (lines.length === 0) {
    return ["No accounts found."];
  }

  return lines;
}

export function renderAccountsScreen(input: {
  accounts: AccountListItem[];
  offset?: number;
  viewLines?: number;
}): string {
  const lines = buildAccountsLines(input.accounts);
  const offset = Math.max(0, input.offset ?? 0);
  const viewLines = Math.max(6, input.viewLines ?? lines.length);
  const visible = lines.slice(offset, offset + viewLines);

  return `codex-sw-node - Accounts\n\n${visible.join("\n")}\n\nUp/Down scroll  Esc/q back\n`;
}
