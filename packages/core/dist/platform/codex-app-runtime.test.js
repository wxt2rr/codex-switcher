import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearManagedAppInstance, listManagedAppInstances, readLastManagedAppInstanceId, readManagedAppPid, reconcileManagedAppInstanceCount, removeManagedAppProfile, resolveManagedAppStatePaths, setManagedAppInstance, stopManagedAppPid, writeManagedAppPid, } from "./codex-app-runtime.js";
test("reconcileManagedAppInstanceCount removes stopped instances only in the requested environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-reconcile-count-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env-a/account-a" });
        await setManagedAppInstance(paths, { instanceId: "instance-2", pid: 2222, targetKey: "env-a/account-a" });
        await setManagedAppInstance(paths, { instanceId: "instance-3", pid: 3333, targetKey: "env-b/account-b" });
        await mkdir(join(paths.appProfilesDir, "instance-2"), { recursive: true });
        const count = await reconcileManagedAppInstanceCount(paths, "env-a", async (pid) => pid === 1111);
        assert.equal(count, 1);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-1", pid: 1111, targetKey: "env-a/account-a" },
            { instanceId: "instance-3", pid: 3333, targetKey: "env-b/account-b" },
        ]);
        await assert.rejects(access(join(paths.appProfilesDir, "instance-2")));
        assert.equal(await reconcileManagedAppInstanceCount(paths, "untracked", async () => false), undefined);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("reconcileManagedAppInstanceCount reports zero when every tracked window has exited", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-reconcile-empty-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env-a" });
        assert.equal(await reconcileManagedAppInstanceCount(paths, "env-a", async () => false), 0);
        assert.deepEqual(await listManagedAppInstances(paths), []);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("profile removal retries transient Chromium directory races", async () => {
    let attempts = 0;
    await removeManagedAppProfile("/tmp/profile", {
        maxRetries: 3,
        retryDelayMs: 1,
        async remove() {
            attempts += 1;
            if (attempts < 3) {
                const error = new Error("directory not empty");
                error.code = "ENOTEMPTY";
                throw error;
            }
        },
        async delay() { },
    });
    assert.equal(attempts, 3);
});
test("instance metadata remains recoverable when profile cleanup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-cleanup-failure-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 2468, targetKey: "env/account" });
        await assert.rejects(() => clearManagedAppInstance(paths, "instance-1", {
            maxRetries: 0,
            async remove() {
                const error = new Error("directory not empty");
                error.code = "ENOTEMPTY";
                throw error;
            },
        }), /directory not empty/);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-1", pid: 2468, targetKey: "env/account" },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("managed app pid round-trips through the state file", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await writeManagedAppPid(paths, 4321);
        assert.equal(await readManagedAppPid(paths), 4321);
        await writeManagedAppPid(paths, null);
        assert.equal(await readManagedAppPid(paths), null);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid calls the stopper and clears the pid file", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-stop-"));
    const calls = [];
    try {
        const paths = resolveManagedAppStatePaths(root);
        await writeManagedAppPid(paths, 8765);
        const stopped = await stopManagedAppPid(paths, async (pid) => {
            calls.push(pid);
            return true;
        });
        assert.equal(stopped, true);
        assert.deepEqual(calls, [8765]);
        assert.equal(await readManagedAppPid(paths), null);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid returns false when no managed pid exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-stop-empty-"));
    let called = false;
    try {
        const paths = resolveManagedAppStatePaths(root);
        const stopped = await stopManagedAppPid(paths, async () => {
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
test("setManagedAppInstance records instance pid and last-instance pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-instance-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, {
            instanceId: "instance-1",
            pid: 2468,
        });
        assert.equal(await readManagedAppPid(paths), 2468);
        assert.equal(await readLastManagedAppInstanceId(paths), "instance-1");
        assert.deepEqual(await listManagedAppInstances(paths), [
            {
                instanceId: "instance-1",
                pid: 2468,
            },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid falls back to the previous managed instance when others remain", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-fallback-"));
    const calls = [];
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, {
            instanceId: "instance-1",
            pid: 1111,
        });
        await setManagedAppInstance(paths, {
            instanceId: "instance-2",
            pid: 2222,
        });
        await mkdir(join(paths.appProfilesDir, "instance-2"), { recursive: true });
        const stopped = await stopManagedAppPid(paths, async (pid) => {
            calls.push(pid);
            return true;
        });
        assert.equal(stopped, true);
        assert.deepEqual(calls, [2222]);
        assert.equal(await readManagedAppPid(paths), 1111);
        assert.equal(await readLastManagedAppInstanceId(paths), "instance-1");
        assert.deepEqual(await listManagedAppInstances(paths), [
            {
                instanceId: "instance-1",
                pid: 1111,
            },
        ]);
        await assert.rejects(access(join(paths.appProfilesDir, "instance-2")));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid drains all instances in the requested environment scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-scope-"));
    const calls = [];
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env-a/account-a" });
        await setManagedAppInstance(paths, { instanceId: "instance-2", pid: 2222, targetKey: "env-b/account-b" });
        await setManagedAppInstance(paths, { instanceId: "instance-3", pid: 3333, targetKey: "env-a/account-a" });
        const stopped = await stopManagedAppPid(paths, async (pid) => { calls.push(pid); return true; }, undefined, "env-a");
        assert.equal(stopped, true);
        assert.deepEqual(calls, [3333, 1111]);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-2", pid: 2222, targetKey: "env-b/account-b" },
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid preserves instance state when process termination fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-stop-failure-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env/account" });
        await mkdir(join(paths.appProfilesDir, "instance-1"), { recursive: true });
        await assert.rejects(() => stopManagedAppPid(paths, async () => {
            throw new Error("process group still running");
        }), /still running/);
        assert.deepEqual(await listManagedAppInstances(paths), [
            { instanceId: "instance-1", pid: 1111, targetKey: "env/account" },
        ]);
        await access(join(paths.appProfilesDir, "instance-1"));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("stopManagedAppPid clears stale instance state when the stopper cannot manage its pid", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-runtime-stale-permission-"));
    try {
        const paths = resolveManagedAppStatePaths(root);
        await setManagedAppInstance(paths, { instanceId: "instance-1", pid: 1111, targetKey: "env/account" });
        await mkdir(join(paths.appProfilesDir, "instance-1"), { recursive: true });
        assert.equal(await stopManagedAppPid(paths, async () => false, undefined, "env/account"), true);
        assert.deepEqual(await listManagedAppInstances(paths), []);
        assert.equal(await readManagedAppPid(paths), null);
        await assert.rejects(access(join(paths.appProfilesDir, "instance-1")));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=codex-app-runtime.test.js.map