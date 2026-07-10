export const SETUP_OPTIONS_WINDOWS = [
    {
        id: "powershell",
        title: "PowerShell",
        description: "Add codex-sw to your PowerShell profile",
    },
    {
        id: "cmd",
        title: "cmd",
        description: "Create a cmd init script and launcher",
    },
    {
        id: "windows-terminal",
        title: "Windows Terminal",
        description: "Initialize codex-sw for PowerShell in Windows Terminal",
    },
];
export const SETUP_OPTIONS_UNIX = [
    {
        id: "zsh",
        title: "zsh",
        description: "Add codex-sw to your zsh PATH",
    },
    {
        id: "bash",
        title: "bash",
        description: "Add codex-sw to your bash PATH",
    },
];
export function renderSetupScreen(input) {
    const selected = input.selected ?? 0;
    const selectedOption = input.options[selected] ?? input.options[0];
    const selectedAction = selectedOption
        ? input.selectedTargetPath
            ? `Enter action: initialize ${selectedOption.id} -> ${input.selectedTargetPath}`
            : `Enter action: initialize ${selectedOption.id}`
        : "Enter action: initialize -";
    const lines = [
        "codex-sw-node - Setup",
        "",
        `Platform: ${input.platform}`,
        selectedOption ? `Selected target: ${selectedOption.id}` : "Selected target: -",
        selectedAction,
        "",
    ];
    if (input.statusLines.length > 0) {
        lines.push(...input.statusLines, "");
    }
    if (input.message) {
        lines.push(input.message, "");
    }
    for (const [index, option] of input.options.entries()) {
        const marker = index === selected ? ">" : " ";
        lines.push(`${marker} ${option.title.padEnd(18, " ")} ${option.description}`);
    }
    lines.push("", "Up/Down move  Enter initialize  Esc/q back", "");
    return lines.join("\n");
}
//# sourceMappingURL=setup.js.map