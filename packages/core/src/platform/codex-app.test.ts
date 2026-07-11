import assert from "node:assert/strict";
import test from "node:test";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCodexAppLaunchSpec,
  launchCodexApp,
  launchNewCodexApp,
  restartCurrentCodexApp,
  stopManagedCodexApp,
} from "./codex-app.js";
import {
  listManagedAppInstances,
  readLastManagedAppInstanceId,
  readManagedAppPid,
  resolveManagedAppStatePaths,
} from "./codex-app-runtime.js";

test("launchCodexApp passes CODEX_HOME and managed marker to the runner", async () => {
  let received:
    | {
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      }
    | undefined;

  const result = await launchCodexApp(
    {
      codexHome: "/tmp/codex-home",
      env: {
        CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
      },
    },
    async (command, args, env) => {
      received = { command, args, env };
      return { pid: 1234 };
    },
  );

  assert.equal(result.pid, 1234);
  assert.equal(received?.command, "/tmp/Codex");
  assert.deepEqual(received?.args, []);
  assert.equal(received?.env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(received?.env.CODEX_SWITCHER_MANAGED, "1");
});

test("buildCodexAppLaunchSpec uses cmd start wrapper on windows by default", () => {
  const spec = buildCodexAppLaunchSpec(
    "C:\\Program Files\\Codex\\Codex.exe",
    {},
    "win32",
  );

  assert.equal(spec.command, "cmd.exe");
  assert.deepEqual(spec.args, [
    "/d",
    "/s",
    "/c",
    'start "" /b "C:\\Program Files\\Codex\\Codex.exe"',
  ]);
});

test("buildCodexAppLaunchSpec supports PowerShell launcher on windows", () => {
  const spec = buildCodexAppLaunchSpec(
    "C:\\Program Files\\Codex\\Codex.exe",
    {
      CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: "powershell",
    },
    "win32",
  );

  assert.equal(spec.command, "powershell.exe");
  assert.deepEqual(spec.args, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Start-Process -FilePath 'C:\\Program Files\\Codex\\Codex.exe'",
  ]);
});

test("buildCodexAppLaunchSpec supports Windows Terminal launcher on windows", () => {
  const spec = buildCodexAppLaunchSpec(
    "C:\\Program Files\\Codex\\Codex.exe",
    {
      CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: "wt",
    },
    "win32",
  );

  assert.equal(spec.command, "wt.exe");
  assert.deepEqual(spec.args, [
    "-w",
    "new",
    "C:\\Program Files\\Codex\\Codex.exe",
  ]);
});

test("launchNewCodexApp records the managed app pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-launch-new-"));

  try {
    const result = await launchNewCodexApp(
      {
        codexHome: "/tmp/codex-home",
        stateDir: root,
        env: {
          CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
        },
      },
      async () => ({ pid: 2222 }),
    );

    assert.equal(result.pid, 2222);
    assert.equal(
      await readManagedAppPid(resolveManagedAppStatePaths(root)),
      2222,
    );
    assert.equal(
      await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)),
      "instance-1",
    );
    assert.deepEqual(
      await listManagedAppInstances(resolveManagedAppStatePaths(root)),
      [{ instanceId: "instance-1", pid: 2222 }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restartCurrentCodexApp replaces the managed app pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-restart-"));
  const calls: string[] = [];

  try {
    await writeFile(join(root, "app.pid"), "2222\n", "utf8");
    await writeFile(join(root, "app-last-instance"), "instance-9\n", "utf8");
    await mkdir(join(root, "app-instances"), { recursive: true });
    await writeFile(join(root, "app-instances", "instance-9.pid"), "2222\n", "utf8");

    const result = await restartCurrentCodexApp(
      {
        codexHome: "/tmp/codex-home",
        stateDir: root,
        env: {
          CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
        },
      },
      async () => {
        calls.push("launch");
        return { pid: 3333 };
      },
      async (pid) => {
        calls.push(`stop:${pid}`);
        return true;
      },
    );

    assert.equal(result.pid, 3333);
    assert.deepEqual(calls, ["stop:2222", "launch"]);
    assert.equal(
      await readManagedAppPid(resolveManagedAppStatePaths(root)),
      3333,
    );
    assert.equal(
      await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)),
      "instance-1",
    );
    assert.deepEqual(
      await listManagedAppInstances(resolveManagedAppStatePaths(root)),
      [{ instanceId: "instance-1", pid: 3333 }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restartCurrentCodexApp derives the macOS application name from the configured binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-chatgpt-restart-"));
  const calls: string[] = [];

  try {
    await writeFile(join(root, "app.pid"), "2222\n", "utf8");
    const result = await restartCurrentCodexApp(
      {
        codexHome: "/tmp/codex-home",
        stateDir: root,
        env: { CODEX_SWITCHER_APP_BIN: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" },
      },
      async () => ({ pid: 3333 }),
      async (_pid, applicationName) => {
        calls.push(applicationName ?? "");
        return true;
      },
    );

    assert.equal(result.pid, 3333);
    assert.deepEqual(calls, ["ChatGPT"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopManagedCodexApp clears pid file after stopping a managed process", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-stop-"));
  const calls: string[] = [];

  try {
    await writeFile(join(root, "app.pid"), "4444\n", "utf8");
    await writeFile(join(root, "app-last-instance"), "instance-2\n", "utf8");
    await mkdir(join(root, "app-instances"), { recursive: true });
    await writeFile(join(root, "app-instances", "instance-2.pid"), "4444\n", "utf8");

    const stopped = await stopManagedCodexApp(
      { stateDir: root },
      async (pid) => {
        calls.push(`stop:${pid}`);
        return true;
      },
    );

    assert.equal(stopped, true);
    assert.deepEqual(calls, ["stop:4444"]);
    assert.equal(
      await readManagedAppPid(resolveManagedAppStatePaths(root)),
      null,
    );
    assert.equal(
      await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)),
      null,
    );
    assert.deepEqual(
      await listManagedAppInstances(resolveManagedAppStatePaths(root)),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopManagedCodexApp is a no-op when there is no managed pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-stop-empty-"));
  let called = false;

  try {
    const stopped = await stopManagedCodexApp(
      { stateDir: root },
      async () => {
        called = true;
        return true;
      },
    );

    assert.equal(stopped, false);
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
