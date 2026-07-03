export const HOME_MENU_ITEMS = [
    { title: "Switch", description: "Switch active account quickly" },
    { title: "Accounts", description: "Manage accounts" },
    { title: "Environments", description: "Manage environments" },
    { title: "App", description: "Manage Codex App lifecycle" },
    { title: "Status", description: "View usage and status dashboard" },
    { title: "Refresh", description: "Run one token refresh scan now" },
    { title: "Logs", description: "View token refresh logs" },
    { title: "Quit", description: "Exit" },
];
const HOME_LOGO = [
    "  ____ ___  ____  _______  __     _____ _        __",
    " / ___/ _ \\|  _ \\| ____\\ \\/ /    / ____\\ \\      / /",
    "| |  | | | | | | |  _|  \\  /____| (___  \\ \\ /\\ / /",
    "| |__| |_| | |_| | |___ /  \\_____\\___ \\  \\ V  V /",
    " \\____\\___/|____/|_____/_/\\_\\    |____/   \\_/\\_/",
];
export function renderHomeScreen(selected = 0, updateHint = "") {
    const lines = [...HOME_LOGO, "  https://github.com/wxt2rr/codex-switcher", ""];
    if (updateHint) {
        lines.push(`  ${updateHint}`, "");
    }
    for (const [index, item] of HOME_MENU_ITEMS.entries()) {
        const marker = index === selected ? ">" : " ";
        const label = `${index + 1}.`.padEnd(4, " ");
        lines.push(`${marker} ${label}${item.title.padEnd(22, " ")} ${item.description}`);
    }
    lines.push("", "Use arrow keys, Enter, number keys, or q to quit.");
    return `${lines.join("\n")}\n`;
}
export async function runHomeLoop(terminal, output = process.stdout, updateHint = "") {
    let selected = 0;
    if (!terminal.isInteractive) {
        output.write(renderHomeScreen(selected, updateHint));
        return selected;
    }
    while (true) {
        terminal.clear();
        output.write(renderHomeScreen(selected, updateHint));
        const key = await terminal.readKey();
        switch (key) {
            case "up":
                selected = (selected - 1 + HOME_MENU_ITEMS.length) % HOME_MENU_ITEMS.length;
                break;
            case "down":
                selected = (selected + 1) % HOME_MENU_ITEMS.length;
                break;
            case "enter":
                return selected;
            case "quit":
                return HOME_MENU_ITEMS.length - 1;
            default:
                if (key.startsWith("digit:")) {
                    const digit = Number(key.slice("digit:".length));
                    if (digit >= 1 && digit <= HOME_MENU_ITEMS.length) {
                        return digit - 1;
                    }
                }
                break;
        }
    }
}
//# sourceMappingURL=home.js.map