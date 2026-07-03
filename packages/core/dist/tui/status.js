export function renderStatusScreen(input) {
    const lines = buildStatusLines(input.status, input.accounts);
    const offset = Math.max(0, input.offset ?? 0);
    const viewLines = Math.max(6, input.viewLines ?? lines.length);
    const visible = lines.slice(offset, offset + viewLines);
    return `codex-sw-node - Status\n\n${visible.join("\n")}\n\nUp/Down scroll  Esc/q back\n`;
}
export function buildStatusLines(status, accounts) {
    const lines = [
        `CLI [${status.cli.loginState}]`,
        "--------------------------------------------------------",
        `TARGET        ${status.cli.current}`,
        `AUTH          ${status.cli.auth}`,
        `AUTH EXPIRY   ${status.cli.authExpiry}`,
        "",
        `APP [${status.app.loginState}]`,
        "--------------------------------------------------------",
        `TARGET        ${status.app.current}`,
        `AUTH          ${status.app.auth}`,
        `AUTH EXPIRY   ${status.app.authExpiry}`,
        "",
        `TOKEN REFRESH ${status.tokenRefresh.guard}`,
        `NEED RELOGIN  ${status.tokenRefresh.needReloginLastRun}`,
        "",
    ];
    const grouped = new Map();
    for (const account of accounts) {
        const list = grouped.get(account.envName) || [];
        list.push(account);
        grouped.set(account.envName, list);
    }
    for (const envName of [...grouped.keys()].sort()) {
        lines.push(`ENV: ${envName}`);
        lines.push("--------------------------------------------------------");
        const envAccounts = grouped.get(envName) || [];
        for (const account of envAccounts.sort((a, b) => a.name.localeCompare(b.name))) {
            const tags = [
                account.isCurrentCli ? "[cli]" : "",
                account.isCurrentApp ? "[app]" : "",
            ]
                .filter(Boolean)
                .join(" ");
            lines.push(`${account.name}${tags ? ` ${tags}` : ""}`);
            lines.push(`  auth: ${account.authMode} / ${account.runtime?.preferredAuthMethod ?? "-"}`);
            if (account.authMode === "apikey") {
                lines.push(`  api key: ${account.apiKeyPreview ?? "-"}`);
                lines.push(`  base url: ${account.runtime?.openaiBaseUrl || "default"}`);
            }
            lines.push("");
        }
    }
    return lines;
}
//# sourceMappingURL=status.js.map