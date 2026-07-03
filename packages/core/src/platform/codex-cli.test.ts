import assert from "node:assert/strict";
import test from "node:test";

import { launchCodexCli } from "./codex-cli.js";

test("launchCodexCli passes CODEX_HOME and args to the runner", async () => {
  let received:
    | {
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      }
    | undefined;

  const result = await launchCodexCli(
    {
      codexHome: "/tmp/codex-home",
      args: ["login", "status"],
      env: {
        PATH: "/tmp/bin",
        CODEX_SWITCHER_CODEX_BIN: "/tmp/bin/codex",
      },
    },
    async (command, args, env) => {
      received = { command, args, env };
      return { exitCode: 0 };
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(received?.command, "/tmp/bin/codex");
  assert.deepEqual(received?.args, ["login", "status"]);
  assert.equal(received?.env.CODEX_HOME, "/tmp/codex-home");
});
