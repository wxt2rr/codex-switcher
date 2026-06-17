import test from "node:test";
import assert from "node:assert/strict";

import { createTaskRunner } from "./task-runner.js";
import {
  createBridgeTaskService,
  type ExternalCommandRunner,
} from "./bridge.js";

test("bridge task service runs auth login through external command runner", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: ExternalCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };

  const service = createBridgeTaskService({
    runner,
    tasks: createTaskRunner(),
  });

  const result = await service.runAuthLogin({
    codexBin: "codex",
    codexHome: "/tmp/example-home",
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, [
    {
      command: "codex",
      args: ["login"],
    },
  ]);
});

test("bridge task service runs proxy test through task adapter", async () => {
  const runner: ExternalCommandRunner = async () => ({
    exitCode: 0,
    stdout: "proxy ok",
    stderr: "",
  });

  const service = createBridgeTaskService({
    runner,
    tasks: createTaskRunner(),
  });

  const result = await service.runProxyTest({
    command: "curl",
    args: ["-I", "https://example.test"],
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.output?.stdout, "proxy ok");
});
