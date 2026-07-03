import assert from "node:assert/strict";
import test from "node:test";

import { renderSetupScreen, SETUP_OPTIONS_UNIX, SETUP_OPTIONS_WINDOWS } from "./setup.js";

test("renderSetupScreen shows Windows shell setup targets and launcher readiness", () => {
  const output = renderSetupScreen({
    platform: "windows",
    selected: 1,
    selectedTargetPath: "C:\\Users\\tester\\cmd-init.bat",
    message: "Initialized codex-sw for cmd",
    options: SETUP_OPTIONS_WINDOWS,
    statusLines: [
      "Recommended: PowerShell",
      "Current launcher: Windows Terminal",
      "Initialized: no",
      "Issues: launcher missing",
      "Init target: C:\\Users\\tester\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
      "launcher wt.exe: ok",
      "launcher powershell.exe: ok",
      "launcher cmd.exe: ok",
    ],
  });

  assert.match(output, /codex-sw-node - Setup/);
  assert.match(output, /Platform: windows/);
  assert.match(output, /Selected target: cmd/);
  assert.match(output, /Enter action: initialize cmd -> C:\\Users\\tester\\cmd-init\.bat/);
  assert.match(output, /Recommended: PowerShell/);
  assert.match(output, /Current launcher: Windows Terminal/);
  assert.match(output, /Initialized: no/);
  assert.match(output, /Issues: launcher missing/);
  assert.match(output, /Init target: C:\\Users\\tester\\Documents\\PowerShell\\Microsoft\.PowerShell_profile\.ps1/);
  assert.match(output, /launcher wt\.exe: ok/);
  assert.match(output, /launcher powershell\.exe: ok/);
  assert.match(output, /Initialized codex-sw for cmd/);
  assert.match(output, /> cmd/);
  assert.match(output, /Windows Terminal/);
  assert.equal(SETUP_OPTIONS_WINDOWS.length, 3);
});

test("renderSetupScreen shows Unix shell setup targets", () => {
  const output = renderSetupScreen({
    platform: "macos",
    selected: 0,
    selectedTargetPath: "/Users/test/.zshrc",
    options: SETUP_OPTIONS_UNIX,
    statusLines: [
      "Recommended: zsh",
      "Current launcher: zsh",
      "Initialized: no",
      "Issues: init block missing",
      "Init target: /Users/test/.zshrc",
      "rc file: /Users/test/.zshrc",
    ],
  });

  assert.match(output, /Platform: macos/);
  assert.match(output, /Selected target: zsh/);
  assert.match(output, /Enter action: initialize zsh -> \/Users\/test\/\.zshrc/);
  assert.match(output, /Recommended: zsh/);
  assert.match(output, /Current launcher: zsh/);
  assert.match(output, /Initialized: no/);
  assert.match(output, /Issues: init block missing/);
  assert.match(output, /Init target: \/Users\/test\/\.zshrc/);
  assert.match(output, /> zsh/);
  assert.match(output, /bash/);
  assert.match(output, /rc file: \/Users\/test\/\.zshrc/);
  assert.equal(SETUP_OPTIONS_UNIX.length, 2);
});
