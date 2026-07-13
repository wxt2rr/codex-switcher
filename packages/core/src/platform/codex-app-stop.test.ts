import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManagedAppStopPlan,
  executeManagedAppStopPlan,
  waitForManagedAppExit,
} from "./codex-app-stop.js";

test("buildManagedAppStopPlan uses taskkill tree termination on windows", () => {
  const plan = buildManagedAppStopPlan({
    platform: "windows",
    pid: 4321,
  });

  assert.deepEqual(plan, [
    {
      kind: "spawn",
      command: "taskkill",
      args: ["/PID", "4321", "/T", "/F"],
    },
  ]);
});

test("buildManagedAppStopPlan uses AppleScript quit before pid fallback on macos", () => {
  const plan = buildManagedAppStopPlan({
    platform: "macos",
    pid: 9876,
    preferAppQuit: true,
  });

  assert.deepEqual(plan, [
    {
      kind: "spawn",
      command: "osascript",
      args: ["-e", 'tell application "Codex" to quit'],
      optional: true,
    },
    {
      kind: "spawn",
      command: "pkill",
      args: ["-x", "Codex"],
      optional: true,
    },
    {
      kind: "signal",
      pid: -9876,
      signal: "SIGTERM",
    },
  ]);
});

test("waitForManagedAppExit force-kills only the isolated process group after timeout", async () => {
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  let runningChecks = 0;
  await waitForManagedAppExit(
    { platform: "macos", pid: 9876, gracefulTimeoutMs: 2, forceTimeoutMs: 2, pollMs: 1 },
    {
      async isRunning(pid) {
        assert.equal(pid, -9876);
        runningChecks += 1;
        return runningChecks < 4;
      },
      async signal(pid, signal) { signals.push({ pid, signal }); },
      async delay() {},
    },
  );
  assert.deepEqual(signals, [{ pid: -9876, signal: "SIGKILL" }]);
});

test("buildManagedAppStopPlan quits the configured merged ChatGPT app on macos", () => {
  const plan = buildManagedAppStopPlan({
    platform: "macos",
    pid: 9876,
    preferAppQuit: true,
    applicationName: "ChatGPT",
  });

  assert.equal(plan[0]?.kind, "spawn");
  assert.deepEqual(plan[0], {
    kind: "spawn",
    command: "osascript",
    args: ["-e", 'tell application "ChatGPT" to quit'],
    optional: true,
  });
  assert.deepEqual(plan[1], {
    kind: "spawn",
    command: "pkill",
    args: ["-x", "ChatGPT"],
    optional: true,
  });
});

test("executeManagedAppStopPlan runs steps in order and tolerates optional failures", async () => {
  const calls: string[] = [];

  const result = await executeManagedAppStopPlan(
    [
      {
        kind: "spawn",
        command: "osascript",
        args: ["-e", 'tell application "Codex" to quit'],
        optional: true,
      },
      {
        kind: "signal",
        pid: 1111,
        signal: "SIGTERM",
      },
    ],
    {
      spawn: async (command, args) => {
        calls.push(`spawn:${command} ${args.join(" ")}`);
        throw new Error("missing osascript");
      },
      signal: async (pid, signal) => {
        calls.push(`signal:${pid}:${signal}`);
      },
    },
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [
    'spawn:osascript -e tell application "Codex" to quit',
    "signal:1111:SIGTERM",
  ]);
});

test("executeManagedAppStopPlan falls back to the main pid when process-group signaling is denied", async () => {
  const calls: string[] = [];
  const result = await executeManagedAppStopPlan(
    [{ kind: "signal", pid: -4321, signal: "SIGTERM" }],
    {
      async spawn() {},
      async signal(pid, signal) {
        calls.push(`${pid}:${signal}`);
        if (pid < 0) {
          const error = new Error("kill EPERM") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
      },
    },
  );

  assert.equal(result, true);
  assert.deepEqual(calls, ["-4321:SIGTERM", "4321:SIGTERM"]);
});

test("waitForManagedAppExit checks the main pid when process-group inspection is denied", async () => {
  const checked: number[] = [];
  await waitForManagedAppExit(
    { platform: "macos", pid: 4321, gracefulTimeoutMs: 1, pollMs: 1 },
    {
      async isRunning(pid) {
        checked.push(pid);
        if (pid < 0) {
          const error = new Error("kill EPERM") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
        return false;
      },
      async signal() {},
      async delay() {},
    },
  );

  assert.deepEqual(checked, [-4321, 4321]);
});

test("executeManagedAppStopPlan tolerates missing windows taskkill target", async () => {
  const calls: string[] = [];

  const result = await executeManagedAppStopPlan(
    [
      {
        kind: "spawn",
        command: "taskkill",
        args: ["/PID", "4321", "/T", "/F"],
      },
    ],
    {
      spawn: async (command, args) => {
        calls.push(`spawn:${command} ${args.join(" ")}`);
        const error = new Error("taskkill exited with code 128") as Error & { code?: string; stderr?: string };
        error.code = "TASKKILL_NOT_FOUND";
        error.stderr = "ERROR: The process \"4321\" not found.";
        throw error;
      },
      signal: async () => {
        calls.push("signal");
      },
    },
  );

  assert.equal(result, true);
  assert.deepEqual(calls, ["spawn:taskkill /PID 4321 /T /F"]);
});
