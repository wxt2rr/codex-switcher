import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexAppLaunchSpec, launchCodexApp, launchNewCodexApp, restartCurrentCodexApp, stopManagedCodexApp, } from "./codex-app.js";
import { listManagedAppInstances, readLastManagedAppInstanceId, readManagedAppPid, resolveManagedAppStatePaths, setManagedAppInstance, } from "./codex-app-runtime.js";
test("launchCodexApp passes CODEX_HOME and managed marker to the runner", async () => {
    let received;
    const result = await launchCodexApp({
        codexHome: "/tmp/codex-home",
        env: {
            CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
        },
    }, async (command, args, env) => {
        received = { command, args, env };
        return { pid: 1234 };
    });
    assert.equal(result.pid, 1234);
    assert.equal(received?.command, "/tmp/Codex");
    assert.deepEqual(received?.args, []);
    assert.equal(received?.env.CODEX_HOME, "/tmp/codex-home");
    assert.equal(received?.env.CODEX_SWITCHER_MANAGED, "1");
});
test("buildCodexAppLaunchSpec uses cmd start wrapper on windows by default", () => {
    const spec = buildCodexAppLaunchSpec("C:\\Program Files\\Codex\\Codex.exe", {}, "win32");
    assert.equal(spec.command, "cmd.exe");
    assert.deepEqual(spec.args, [
        "/d",
        "/s",
        "/c",
        'start "" /b "C:\\Program Files\\Codex\\Codex.exe"',
    ]);
});
test("buildCodexAppLaunchSpec launches a Windows packaged AppID through Explorer", () => {
    const spec = buildCodexAppLaunchSpec("shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App", {}, "win32");
    assert.deepEqual(spec, {
        command: "explorer.exe",
        args: ["shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"],
        acceptEarlyExit: true,
    });
});
test("buildCodexAppLaunchSpec isolates a non-Windows App instance with user-data-dir", () => {
    const spec = buildCodexAppLaunchSpec("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", {}, "darwin", "/tmp/codex-switcher/app profile");
    assert.equal(spec.command, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
    assert.deepEqual(spec.args, ["--user-data-dir=/tmp/codex-switcher/app profile"]);
});
test("buildCodexAppLaunchSpec supports PowerShell launcher on windows", () => {
    const spec = buildCodexAppLaunchSpec("C:\\Program Files\\Codex\\Codex.exe", {
        CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: "powershell",
    }, "win32");
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
test("buildCodexAppLaunchSpec forwards the isolated profile to Windows execution aliases", () => {
    const spec = buildCodexAppLaunchSpec("C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ChatGPT.exe", {}, "win32", "C:\\Users\\tester\\App Data\\instance-1");
    assert.equal(spec.command, "cmd.exe");
    assert.deepEqual(spec.args, [
        "/d",
        "/s",
        "/c",
        'start "" /b "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ChatGPT.exe" "--user-data-dir=C:\\Users\\tester\\App Data\\instance-1"',
    ]);
});
test("buildCodexAppLaunchSpec supports Windows Terminal launcher on windows", () => {
    const spec = buildCodexAppLaunchSpec("C:\\Program Files\\Codex\\Codex.exe", {
        CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: "wt",
    }, "win32");
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
        const result = await launchNewCodexApp({
            codexHome: "/tmp/codex-home",
            stateDir: root,
            env: {
                CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
            },
        }, async (_command, args) => {
            assert.deepEqual(args, [`--user-data-dir=${join(root, "app-profiles", "instance-1")}`]);
            return { pid: 2222 };
        });
        assert.equal(result.pid, 2222);
        assert.equal(await readManagedAppPid(resolveManagedAppStatePaths(root)), 2222);
        assert.equal(await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)), "instance-1");
        assert.deepEqual(await listManagedAppInstances(resolveManagedAppStatePaths(root)), [{ instanceId: "instance-1", pid: 2222 }]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("launchNewCodexApp does not create an isolated profile for a packaged AppID", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-launch-packaged-"));
    try {
        const target = "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App";
        const result = await launchNewCodexApp({
            codexHome: "C:\\Users\\tester\\.codex",
            stateDir: root,
            env: {
                CODEX_SWITCHER_APP_BIN: target,
                CODEX_SWITCHER_TEST_PLATFORM: "win32",
            },
        }, async (command, args, _env, options) => {
            assert.equal(command, "explorer.exe");
            assert.deepEqual(args, [target]);
            assert.equal(options?.acceptEarlyExit, true);
            return { pid: null };
        });
        assert.equal(result.pid, null);
        await assert.rejects(access(join(root, "app-profiles", "instance-1")));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("managed app launches are serialized so instance profiles cannot collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-launch-serialized-"));
    const profileArgs = [];
    let nextPid = 3000;
    try {
        const input = {
            codexHome: "/tmp/codex-home",
            stateDir: root,
            env: { CODEX_SWITCHER_APP_BIN: "/tmp/Codex" },
        };
        await Promise.all([
            launchNewCodexApp(input, async (_command, args) => {
                profileArgs.push(args[0] ?? "");
                return { pid: nextPid++ };
            }),
            launchNewCodexApp(input, async (_command, args) => {
                profileArgs.push(args[0] ?? "");
                return { pid: nextPid++ };
            }),
        ]);
        assert.deepEqual(profileArgs, [
            `--user-data-dir=${join(root, "app-profiles", "instance-1")}`,
            `--user-data-dir=${join(root, "app-profiles", "instance-2")}`,
        ]);
        assert.deepEqual(await listManagedAppInstances(resolveManagedAppStatePaths(root)), [
            { instanceId: "instance-1", pid: 3000 },
            { instanceId: "instance-2", pid: 3001 },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("restartCurrentCodexApp replaces the managed app pid", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-restart-"));
    const calls = [];
    try {
        await writeFile(join(root, "app.pid"), "2222\n", "utf8");
        await writeFile(join(root, "app-last-instance"), "instance-9\n", "utf8");
        await mkdir(join(root, "app-instances"), { recursive: true });
        await writeFile(join(root, "app-instances", "instance-9.pid"), "2222\n", "utf8");
        const result = await restartCurrentCodexApp({
            codexHome: "/tmp/codex-home",
            stateDir: root,
            env: {
                CODEX_SWITCHER_APP_BIN: "/tmp/Codex",
            },
        }, async () => {
            calls.push("launch");
            return { pid: 3333 };
        }, async (pid) => {
            calls.push(`stop:${pid}`);
            return true;
        });
        assert.equal(result.pid, 3333);
        assert.deepEqual(calls, ["stop:2222", "launch"]);
        assert.equal(await readManagedAppPid(resolveManagedAppStatePaths(root)), 3333);
        assert.equal(await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)), "instance-1");
        assert.deepEqual(await listManagedAppInstances(resolveManagedAppStatePaths(root)), [{ instanceId: "instance-1", pid: 3333 }]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("restartCurrentCodexApp continues when the recorded process is no longer manageable", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-restart-stale-"));
    const calls = [];
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 2222, targetKey: "env/account" });
        const result = await restartCurrentCodexApp({
            codexHome: "/tmp/codex-home",
            stateDir: root,
            targetKey: "env/account",
            env: { CODEX_SWITCHER_APP_BIN: "/tmp/Codex" },
        }, async () => {
            calls.push("launch");
            return { pid: 3333 };
        }, async (pid) => {
            calls.push(`stale:${pid}`);
            return false;
        });
        assert.equal(result.pid, 3333);
        assert.deepEqual(calls, ["stale:2222", "launch"]);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-1", pid: 3333, targetKey: "env/account" },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("restartCurrentCodexApp avoids application-wide quit when replacing one instance", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-chatgpt-restart-"));
    const calls = [];
    try {
        await writeFile(join(root, "app.pid"), "2222\n", "utf8");
        const result = await restartCurrentCodexApp({
            codexHome: "/tmp/codex-home",
            stateDir: root,
            env: { CODEX_SWITCHER_APP_BIN: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" },
        }, async () => ({ pid: 3333 }), async (_pid, applicationName) => {
            calls.push(applicationName ?? "");
            return true;
        });
        assert.equal(result.pid, 3333);
        assert.deepEqual(calls, [""]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("restartCurrentCodexApp stops only the instance bound to its target account", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-target-restart-"));
    const stopped = [];
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env-a/account-a" });
        await setManagedAppInstance(paths, { instanceId: "instance-2", pid: 2222, targetKey: "env-b/account-b" });
        await restartCurrentCodexApp({ codexHome: "/tmp/a", stateDir: root, targetKey: "env-a/account-a",
            env: { CODEX_SWITCHER_APP_BIN: "/tmp/Codex" } }, async () => ({ pid: 3333 }), async (pid) => {
            stopped.push(pid);
            return true;
        });
        assert.deepEqual(stopped, [1111]);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-2", pid: 2222, targetKey: "env-b/account-b" },
            { instanceId: "instance-3", pid: 3333, targetKey: "env-a/account-a" },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedCodexApp clears pid file after stopping a managed process", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-stop-"));
    const calls = [];
    try {
        await writeFile(join(root, "app.pid"), "4444\n", "utf8");
        await writeFile(join(root, "app-last-instance"), "instance-2\n", "utf8");
        await mkdir(join(root, "app-instances"), { recursive: true });
        await writeFile(join(root, "app-instances", "instance-2.pid"), "4444\n", "utf8");
        const stopped = await stopManagedCodexApp({ stateDir: root }, async (pid) => {
            calls.push(`stop:${pid}`);
            return true;
        });
        assert.equal(stopped, true);
        assert.deepEqual(calls, ["stop:4444"]);
        assert.equal(await readManagedAppPid(resolveManagedAppStatePaths(root)), null);
        assert.equal(await readLastManagedAppInstanceId(resolveManagedAppStatePaths(root)), null);
        assert.deepEqual(await listManagedAppInstances(resolveManagedAppStatePaths(root)), []);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedCodexApp is a no-op when there is no managed pid", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-stop-empty-"));
    let called = false;
    try {
        const stopped = await stopManagedCodexApp({ stateDir: root }, async () => {
            called = true;
            return true;
        });
        assert.equal(stopped, false);
        assert.equal(called, false);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=codex-app.test.js.map