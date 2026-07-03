import assert from "node:assert/strict";
import test from "node:test";

import { HOME_MENU_ITEMS, renderHomeScreen, runHomeLoop } from "./home.js";
import type { TerminalLike } from "./terminal.js";

test("renderHomeScreen prints logo, menu, and nav hint", () => {
  const screen = renderHomeScreen(
    0,
    "Update available",
    "Mismatch: current launcher PowerShell is not ready; target cmd is ready | Suggestion: ready target available: cmd",
  );

  assert.match(screen, /https:\/\/github\.com\/wxt2rr\/codex-switcher/);
  assert.match(screen, /Mismatch: current launcher PowerShell is not ready; target cmd is ready/);
  assert.match(screen, /Suggestion: ready target available: cmd/);
  assert.match(screen, /Press 7 for Setup to fix shell or terminal initialization\./);
  assert.match(screen, /> 1\.\s+Switch/);
  assert.match(screen, /6\.\s+Proxy/);
  assert.match(screen, /7\.\s+Setup/);
  assert.match(screen, /8\.\s+Refresh/);
  assert.match(screen, /9\.\s+Logs/);
  assert.match(screen, /10\.\s+Quit/);
  assert.match(screen, /Use arrow keys, Enter, number keys, or q to quit\./);
});

test("runHomeLoop renders plain output in non-interactive mode", async () => {
  let rendered = "";
  const terminal: TerminalLike = {
    isInteractive: false,
    colorEnabled: false,
    columns: 80,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  const choice = await runHomeLoop(terminal, {
    write(chunk: string) {
      rendered += chunk;
      return true;
    },
  } as NodeJS.WriteStream, "", "Mismatch: current launcher bash is not ready; target zsh is ready");

  assert.equal(choice, 0);
  assert.match(rendered, /Mismatch: current launcher bash is not ready; target zsh is ready/);
  assert.match(rendered, /Press 7 for Setup to fix shell or terminal initialization\./);
  assert.match(rendered, /Switch active account quickly/);
  assert.match(rendered, /View usage API proxy settings and test connectivity/);
  assert.match(rendered, /Initialize codex-sw for your shell or terminal/);
  assert.match(rendered, /Run one token refresh scan now/);
  assert.match(rendered, /View token refresh logs/);
  assert.equal(HOME_MENU_ITEMS.length, 10);
});
