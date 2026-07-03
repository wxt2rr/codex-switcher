import assert from "node:assert/strict";
import test from "node:test";

import { buildEnvsLines, renderEnvsScreen } from "./envs.js";

test("buildEnvsLines shows env path, account count, and current flags", () => {
  const lines = buildEnvsLines([
    {
      name: "default",
      path: "/tmp/default-home",
      isCurrentCli: true,
      accountCount: 2,
    },
    {
      name: "project",
      path: "/tmp/project-home",
      isCurrentApp: true,
      accountCount: 1,
    },
  ]);

  assert.match(lines.join("\n"), /default \[cli\]/);
  assert.match(lines.join("\n"), /home: \/tmp\/default-home/);
  assert.match(lines.join("\n"), /project \[app\]/);
  assert.match(lines.join("\n"), /accounts: 1/);
});

test("renderEnvsScreen shows empty state", () => {
  const screen = renderEnvsScreen({
    envs: [],
    viewLines: 6,
  });

  assert.match(screen, /codex-sw-node - Environments/);
  assert.match(screen, /No environments found\./);
});
