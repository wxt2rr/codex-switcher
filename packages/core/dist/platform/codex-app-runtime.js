import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export function resolveManagedAppStatePaths(stateDir) {
    return {
        stateDir,
        appPidFile: join(stateDir, "app.pid"),
        appInstancesDir: join(stateDir, "app-instances"),
        appLastInstanceFile: join(stateDir, "app-last-instance"),
    };
}
export async function readManagedAppPid(paths) {
    try {
        const raw = await readFile(paths.appPidFile, "utf8");
        const pid = Number(raw.trim());
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    }
    catch {
        return null;
    }
}
export async function writeManagedAppPid(paths, pid) {
    await mkdir(dirname(paths.appPidFile), { recursive: true });
    if (pid === null) {
        await rm(paths.appPidFile, { force: true });
        return;
    }
    await writeFile(paths.appPidFile, `${pid}\n`, "utf8");
}
export async function readLastManagedAppInstanceId(paths) {
    try {
        const raw = await readFile(paths.appLastInstanceFile, "utf8");
        const value = raw.trim();
        return value ? value : null;
    }
    catch {
        return null;
    }
}
export async function listManagedAppInstances(paths) {
    try {
        const entries = await readDirPidFiles(paths.appInstancesDir);
        return entries
            .map(({ name, raw }) => {
            const pid = Number(raw.trim());
            if (!Number.isFinite(pid) || pid <= 0) {
                return null;
            }
            return {
                instanceId: name.replace(/\.pid$/, ""),
                pid,
            };
        })
            .filter((value) => value !== null)
            .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    }
    catch {
        return [];
    }
}
export async function setManagedAppInstance(paths, input) {
    await mkdir(paths.appInstancesDir, { recursive: true });
    await writeFile(join(paths.appInstancesDir, `${input.instanceId}.pid`), `${input.pid}\n`, "utf8");
    await writeFile(paths.appLastInstanceFile, `${input.instanceId}\n`, "utf8");
    await writeManagedAppPid(paths, input.pid);
}
export async function clearManagedAppInstance(paths, instanceId) {
    await rm(join(paths.appInstancesDir, `${instanceId}.pid`), { force: true });
    const current = await readLastManagedAppInstanceId(paths);
    if (current === instanceId) {
        const nextInstances = await listManagedAppInstances(paths);
        const fallback = nextInstances[nextInstances.length - 1];
        if (fallback) {
            await writeFile(paths.appLastInstanceFile, `${fallback.instanceId}\n`, "utf8");
            await writeManagedAppPid(paths, fallback.pid);
            return;
        }
        await rm(paths.appLastInstanceFile, { force: true });
    }
}
export async function stopManagedAppPid(paths, stopper) {
    const lastInstanceId = await readLastManagedAppInstanceId(paths);
    const instances = await listManagedAppInstances(paths);
    const selected = (lastInstanceId
        ? instances.find((instance) => instance.instanceId === lastInstanceId)
        : undefined) ?? instances[0];
    const pid = selected?.pid ?? (await readManagedAppPid(paths));
    if (pid === null) {
        return false;
    }
    try {
        await stopper(pid);
    }
    finally {
        if (selected) {
            await clearManagedAppInstance(paths, selected.instanceId);
        }
        if (!selected || (await readManagedAppPid(paths)) === pid) {
            await writeManagedAppPid(paths, null);
        }
    }
    return true;
}
async function readDirPidFiles(dir) {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(dir);
    const values = await Promise.all(names
        .filter((name) => name.endsWith(".pid"))
        .map(async (name) => ({
        name,
        raw: await readFile(join(dir, name), "utf8"),
    })));
    return values;
}
//# sourceMappingURL=codex-app-runtime.js.map