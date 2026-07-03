import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountsLines, renderAccountsScreen } from "./accounts.js";
test("buildAccountsLines groups accounts by env and shows flags", () => {
    const lines = buildAccountsLines([
        {
            envName: "default",
            name: "personal",
            authMode: "apikey",
            isCurrentApp: true,
            apiKeyPreview: "sk-***7890",
            runtime: {
                preferredAuthMethod: "apikey",
                openaiBaseUrl: "https://proxy.example.test/v1",
            },
        },
        {
            envName: "default",
            name: "work",
            authMode: "auth",
            isCurrentCli: true,
            runtime: {
                preferredAuthMethod: "chatgpt",
            },
        },
    ]);
    assert.match(lines.join("\n"), /ENV: default/);
    assert.match(lines.join("\n"), /work \[cli\]/);
    assert.match(lines.join("\n"), /personal \[app\]/);
    assert.match(lines.join("\n"), /api key: sk-\*\*\*7890/);
});
test("renderAccountsScreen applies scrolling window", () => {
    const screen = renderAccountsScreen({
        accounts: [],
        viewLines: 6,
    });
    assert.match(screen, /codex-sw-node - Accounts/);
    assert.match(screen, /No accounts found\./);
});
//# sourceMappingURL=accounts.test.js.map