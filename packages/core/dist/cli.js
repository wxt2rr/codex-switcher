export function formatWhoami(state, target) {
    if (target === "cli" || target === "app") {
        const pointer = state.targets[target];
        return `${pointer.env}/${pointer.account}`;
    }
    return [
        `cli: ${state.targets.cli.env}/${state.targets.cli.account}`,
        `app: ${state.targets.app.env}/${state.targets.app.account}`,
    ].join("\n");
}
//# sourceMappingURL=cli.js.map