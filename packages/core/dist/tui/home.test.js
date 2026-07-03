import assert from "node:assert/strict";
import test from "node:test";
import { HOME_MENU_ITEMS, renderHomeScreen, runHomeLoop } from "./home.js";
test("renderHomeScreen prints logo, menu, and nav hint", () => {
    const screen = renderHomeScreen(0, "Update available");
    assert.match(screen, /https:\/\/github\.com\/wxt2rr\/codex-switcher/);
    assert.match(screen, /> 1\.\s+Switch/);
    assert.match(screen, /8\.\s+Quit/);
    assert.match(screen, /Use arrow keys, Enter, number keys, or q to quit\./);
});
test("runHomeLoop renders plain output in non-interactive mode", async () => {
    let rendered = "";
    const terminal = {
        isInteractive: false,
        colorEnabled: false,
        columns: 80,
        rows: 24,
        enter() { },
        leave() { },
        clear() { },
        async readKey() {
            return "quit";
        },
    };
    const choice = await runHomeLoop(terminal, {
        write(chunk) {
            rendered += chunk;
            return true;
        },
    });
    assert.equal(choice, 0);
    assert.match(rendered, /Switch active account quickly/);
    assert.equal(HOME_MENU_ITEMS.length, 8);
});
//# sourceMappingURL=home.test.js.map