import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ManagedAppStatePaths {
  stateDir: string;
  appPidFile: string;
  appInstancesDir: string;
  appProfilesDir: string;
  appLastInstanceFile: string;
}

export interface ManagedAppInstanceRecord {
  instanceId: string;
  pid: number;
  targetKey?: string;
}

export interface ManagedAppProfileRemovalOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  remove?: (path: string) => Promise<void>;
  delay?: (ms: number) => Promise<void>;
}

/** App instances are scoped by environment. Older records may still contain env/account. */
export function normalizeManagedAppScope(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.split("/", 1)[0] || undefined;
}

export function resolveManagedAppStatePaths(stateDir: string): ManagedAppStatePaths {
  return {
    stateDir,
    appPidFile: join(stateDir, "app.pid"),
    appInstancesDir: join(stateDir, "app-instances"),
    appProfilesDir: join(stateDir, "app-profiles"),
    appLastInstanceFile: join(stateDir, "app-last-instance"),
  };
}

export async function readManagedAppPid(paths: ManagedAppStatePaths): Promise<number | null> {
  try {
    const raw = await readFile(paths.appPidFile, "utf8");
    const pid = Number(raw.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function writeManagedAppPid(
  paths: ManagedAppStatePaths,
  pid: number | null,
): Promise<void> {
  await mkdir(dirname(paths.appPidFile), { recursive: true });
  if (pid === null) {
    await rm(paths.appPidFile, { force: true });
    return;
  }
  await writeFile(paths.appPidFile, `${pid}\n`, "utf8");
}

export async function readLastManagedAppInstanceId(
  paths: ManagedAppStatePaths,
): Promise<string | null> {
  try {
    const raw = await readFile(paths.appLastInstanceFile, "utf8");
    const value = raw.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export async function listManagedAppInstances(
  paths: ManagedAppStatePaths,
): Promise<ManagedAppInstanceRecord[]> {
  try {
    const entries = await readDirPidFiles(paths.appInstancesDir);
    const instances = await Promise.all(entries.map(async ({ name, raw }) => {
        const pid = Number(raw.trim());
        if (!Number.isFinite(pid) || pid <= 0) {
          return null;
        }
        const instanceId = name.replace(/\.pid$/, "");
        const targetKey = await readFile(join(paths.appInstancesDir, `${instanceId}.target`), "utf8")
          .then((value) => value.trim() || undefined)
          .catch(() => undefined);
        return {
          instanceId,
          pid,
          ...(targetKey ? { targetKey } : {}),
        };
      }));
    return instances
      .filter((value): value is ManagedAppInstanceRecord => value !== null)
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  } catch {
    return [];
  }
}

export async function setManagedAppInstance(
  paths: ManagedAppStatePaths,
  input: ManagedAppInstanceRecord,
): Promise<void> {
  await mkdir(paths.appInstancesDir, { recursive: true });
  await writeFile(join(paths.appInstancesDir, `${input.instanceId}.pid`), `${input.pid}\n`, "utf8");
  if (input.targetKey) {
    await writeFile(join(paths.appInstancesDir, `${input.instanceId}.target`), `${input.targetKey}\n`, "utf8");
  } else {
    await rm(join(paths.appInstancesDir, `${input.instanceId}.target`), { force: true });
  }
  await writeFile(paths.appLastInstanceFile, `${input.instanceId}\n`, "utf8");
  await writeManagedAppPid(paths, input.pid);
}

export async function clearManagedAppInstance(
  paths: ManagedAppStatePaths,
  instanceId: string,
  removalOptions?: ManagedAppProfileRemovalOptions,
): Promise<void> {
  await removeManagedAppProfile(join(paths.appProfilesDir, instanceId), removalOptions);
  await rm(join(paths.appInstancesDir, `${instanceId}.pid`), { force: true });
  await rm(join(paths.appInstancesDir, `${instanceId}.target`), { force: true });
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

export async function removeManagedAppProfile(
  profilePath: string,
  options: ManagedAppProfileRemovalOptions = {},
): Promise<void> {
  const remove = options.remove ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 8;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await remove(profilePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!new Set(["ENOTEMPTY", "EBUSY", "EPERM"]).has(code ?? "") || attempt >= maxRetries) throw error;
      await delay((options.retryDelayMs ?? 75) * (attempt + 1));
    }
  }
}

export type ManagedAppStopper = (pid: number, applicationName?: string) => Promise<boolean>;
export type ManagedAppProcessProbe = (pid: number) => Promise<boolean>;

export async function reconcileManagedAppInstanceCount(
  paths: ManagedAppStatePaths,
  targetKey: string,
  probe: ManagedAppProcessProbe = defaultManagedAppProcessProbe,
): Promise<number | undefined> {
  const requestedScope = normalizeManagedAppScope(targetKey);
  if (!requestedScope) return undefined;
  const scopedInstances = (await listManagedAppInstances(paths))
    .filter((instance) => normalizeManagedAppScope(instance.targetKey) === requestedScope);
  if (scopedInstances.length === 0) return undefined;

  let runningCount = 0;
  for (const instance of scopedInstances) {
    let running = true;
    try {
      running = await probe(instance.pid);
    } catch {
      // A probe failure is not proof that the process exited. Preserve the
      // instance so permission or platform limitations cannot lose a window.
      running = true;
    }
    if (running) {
      runningCount += 1;
      continue;
    }
    await clearManagedAppInstance(paths, instance.instanceId).catch(() => undefined);
  }
  return runningCount;
}

export async function stopManagedAppPid(
  paths: ManagedAppStatePaths,
  stopper: ManagedAppStopper,
  applicationName?: string,
  targetKey?: string,
): Promise<boolean> {
  const lastInstanceId = await readLastManagedAppInstanceId(paths);
  const instances = await listManagedAppInstances(paths);
  const requestedScope = normalizeManagedAppScope(targetKey);
  let candidates = requestedScope
    ? instances.filter((instance) => normalizeManagedAppScope(instance.targetKey) === requestedScope)
    : instances;

  // Records created before environment scoping have no target metadata. The global
  // pointer is the only safe migration hint, so allow it as a one-time fallback.
  if (requestedScope && candidates.length === 0 && lastInstanceId) {
    const legacyCurrent = instances.find((instance) => instance.instanceId === lastInstanceId);
    if (legacyCurrent && !legacyCurrent.targetKey) candidates = [legacyCurrent];
  }

  if (!requestedScope && candidates.length === 0) {
    const pid = await readManagedAppPid(paths);
    if (pid === null) return false;
    const stopped = await stopper(pid, applicationName);
    if (stopped) await writeManagedAppPid(paths, null);
    return stopped;
  }

  let cleanedStaleRecord = false;
  let stoppedAny = false;
  for (const selected of [...candidates].reverse()) {
    const stopped = await stopper(selected.pid, applicationName);
    if (!stopped) {
      await clearManagedAppInstance(paths, selected.instanceId);
      if ((await readManagedAppPid(paths)) === selected.pid) {
        await writeManagedAppPid(paths, null);
      }
      cleanedStaleRecord = true;
      continue;
    }
    await clearManagedAppInstance(paths, selected.instanceId);
    if ((await readManagedAppPid(paths)) === selected.pid) {
      await writeManagedAppPid(paths, null);
    }
    stoppedAny = true;
    // A single environment owns one App window. Older versions could leave
    // multiple records behind, so drain every matching instance before the
    // replacement is launched. Unscoped callers retain the historical
    // newest-only behavior.
    if (!requestedScope) return true;
  }
  return stoppedAny || cleanedStaleRecord;
}

async function readDirPidFiles(
  dir: string,
): Promise<Array<{ name: string; raw: string }>> {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dir);
  const values = await Promise.all(
    names
      .filter((name) => name.endsWith(".pid"))
      .map(async (name) => ({
        name,
        raw: await readFile(join(dir, name), "utf8"),
      })),
  );
  return values;
}

async function defaultManagedAppProcessProbe(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
