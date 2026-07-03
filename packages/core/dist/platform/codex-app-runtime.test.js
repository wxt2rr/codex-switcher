import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listManagedAppInstances, readLastManagedAppInstanceId, readManagedAppPid, resolveManagedAppStatePaths, setManagedAppInstance, stopManagedAppPid, writeManagedAppPid, } from "./codex-app-runtime.js";
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
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=codex-app-runtime.test.js.map