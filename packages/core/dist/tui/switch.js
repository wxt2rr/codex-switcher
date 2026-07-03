export function listTargetOptions() {
    return ["cli", "app"];
}
export function listEnvOptions(envs, target) {
    return [...envs].sort((a, b) => {
        const aCurrent = target === "cli" ? Boolean(a.isCurrentCli) : Boolean(a.isCurrentApp);
        const bCurrent = target === "cli" ? Boolean(b.isCurrentCli) : Boolean(b.isCurrentApp);
        if (aCurrent !== bCurrent) {
            return aCurrent ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}
export function listAccountOptions(accounts, envName, target) {
    return accounts
        .filter((account) => account.envName === envName)
        .sort((a, b) => {
        const aCurrent = target === "cli" ? Boolean(a.isCurrentCli) : Boolean(a.isCurrentApp);
        const bCurrent = target === "cli" ? Boolean(b.isCurrentCli) : Boolean(b.isCurrentApp);
        if (aCurrent !== bCurrent) {
            return aCurrent ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}
export function renderSwitchSummary(input) {
    return [
        "codex-sw-node - Switch",
        "",
        `Target:  ${input.target}`,
        `Env:     ${input.envName}`,
        `Account: ${input.accountName}`,
        `Action:  ${input.actionLabel ?? "switch-only"}`,
        "",
        "Enter confirm  Esc/q back",
        "",
    ].join("\n");
}
//# sourceMappingURL=switch.js.map