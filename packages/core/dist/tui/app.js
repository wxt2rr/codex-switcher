export const APP_PAGE_ACTIONS = [
    {
        id: "restart-current",
        title: "Restart Current",
        description: "Stop the managed app and relaunch current target",
    },
    {
        id: "launch-new",
        title: "Launch New",
        description: "Open another managed app instance for current target",
    },
    {
        id: "stop-managed",
        title: "Stop Managed",
        description: "Stop the latest managed app instance",
    },
];
export function renderAppScreen(input) {
    const selected = input.selected ?? 0;
    const lines = [
        "codex-sw-node - App",
        "",
        `Current: ${input.status.currentEnv}/${input.status.currentAccount}`,
        "",
    ];
    if (input.status.launcher) {
        lines.push(`Launcher: ${input.status.launcher}`, "");
    }
    if (input.status.instances && input.status.instances.length > 0) {
        lines.push("Managed instances:");
        for (const instance of input.status.instances) {
            lines.push(`- ${instance.instanceId} (pid=${instance.pid})${instance.isLatest ? " [latest]" : ""}`);
        }
        lines.push("");
    }
    if (input.message) {
        lines.push(input.message, "");
    }
    for (const [index, action] of APP_PAGE_ACTIONS.entries()) {
        const marker = index === selected ? ">" : " ";
        lines.push(`${marker} ${action.title.padEnd(16, " ")} ${action.description}`);
    }
    lines.push("", "Up/Down move  Enter select  Esc/q back", "");
    return lines.join("\n");
}
//# sourceMappingURL=app.js.map