export function buildEnvsLines(envs) {
    if (envs.length === 0) {
        return ["No environments found."];
    }
    return [...envs]
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((env) => {
        const tags = [
            env.isCurrentCli ? "[cli]" : "",
            env.isCurrentApp ? "[app]" : "",
        ]
            .filter(Boolean)
            .join(" ");
        return [
            `${env.name}${tags ? ` ${tags}` : ""}`,
            `  home: ${env.path}`,
            `  accounts: ${env.accountCount}`,
            "",
        ];
    });
}
export function renderEnvsScreen(input) {
    const lines = buildEnvsLines(input.envs);
    const offset = Math.max(0, input.offset ?? 0);
    const viewLines = Math.max(6, input.viewLines ?? lines.length);
    const visible = lines.slice(offset, offset + viewLines);
    return `codex-sw-node - Environments\n\n${visible.join("\n")}\n\nUp/Down scroll  Esc/q back\n`;
}
//# sourceMappingURL=envs.js.map