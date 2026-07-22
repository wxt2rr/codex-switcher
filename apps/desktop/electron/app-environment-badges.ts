export type AppEnvironmentBadgePlatform = "macos" | "windows" | "unsupported";
export type AppEnvironmentBadgePermission = "granted" | "denied" | "not-required" | "unsupported";

export interface AppEnvironmentBadgeInstance {
  instanceId: string;
  pid: number;
  environment: string;
  label: string;
  color: string;
}

export interface AppEnvironmentBadgeSyncResult {
  applied: number;
  unresolved: number;
  message?: string;
}

export interface AppEnvironmentBadgeStatus extends AppEnvironmentBadgeSyncResult {
  enabled: boolean;
  supported: boolean;
  platform: AppEnvironmentBadgePlatform;
  permission: AppEnvironmentBadgePermission;
}

export interface AppEnvironmentBadgeAdapter {
  readonly platform: AppEnvironmentBadgePlatform;
  readonly supported: boolean;
  checkPermission(): Promise<AppEnvironmentBadgePermission>;
  requestPermission(): Promise<AppEnvironmentBadgePermission>;
  sync(instances: AppEnvironmentBadgeInstance[]): Promise<AppEnvironmentBadgeSyncResult>;
  clear(): Promise<void>;
}

export interface ManagedBadgeInstanceRecord {
  instanceId: string;
  pid: number;
  targetKey?: string;
}

export interface AppEnvironmentBadgeManagerOptions {
  adapter: AppEnvironmentBadgeAdapter;
  readEnabled: () => Promise<boolean>;
  saveEnabled: (enabled: boolean) => Promise<void>;
  listInstances: () => Promise<ManagedBadgeInstanceRecord[]>;
}

const BADGE_COLORS = ["#0A84FF", "#34C759", "#FF9F0A", "#AF52DE", "#FF375F", "#5AC8FA", "#64D2FF"];

export function createEnvironmentBadgeIdentity(environment: string): Pick<AppEnvironmentBadgeInstance, "environment" | "label" | "color"> {
  const normalized = environment.trim();
  const grapheme = Array.from(normalized)[0] ?? "?";
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return {
    environment: normalized || "Unknown",
    label: /[a-z]/i.test(grapheme) ? grapheme.toLocaleUpperCase() : grapheme,
    color: BADGE_COLORS[(hash >>> 0) % BADGE_COLORS.length],
  };
}

export function managedRecordToBadgeInstance(record: ManagedBadgeInstanceRecord): AppEnvironmentBadgeInstance | null {
  const environment = record.targetKey?.trim().split("/", 1)[0]?.trim();
  if (!environment || !Number.isInteger(record.pid) || record.pid <= 0) return null;
  return { instanceId: record.instanceId, pid: record.pid, ...createEnvironmentBadgeIdentity(environment) };
}

export class AppEnvironmentBadgeManager {
  private lastResult: AppEnvironmentBadgeSyncResult = { applied: 0, unresolved: 0 };
  private queue: Promise<AppEnvironmentBadgeStatus>;

  constructor(private readonly options: AppEnvironmentBadgeManagerOptions) {
    this.queue = Promise.resolve(this.baseStatus(false, "unsupported"));
  }

  getStatus(): Promise<AppEnvironmentBadgeStatus> {
    return this.enqueue(async () => {
      const enabled = await this.options.readEnabled();
      const permission = await this.options.adapter.checkPermission();
      return this.status(enabled, permission);
    });
  }

  requestPermission(): Promise<AppEnvironmentBadgeStatus> {
    return this.enqueue(async () => {
      const permission = await this.options.adapter.requestPermission();
      if (!this.options.adapter.supported || !new Set<AppEnvironmentBadgePermission>(["granted", "not-required"]).has(permission)) {
        await this.options.saveEnabled(false);
        return this.status(false, permission);
      }
      await this.options.saveEnabled(true);
      return this.syncUnlocked(permission);
    });
  }

  setEnabled(enabled: boolean): Promise<AppEnvironmentBadgeStatus> {
    return this.enqueue(async () => {
      if (!enabled) {
        await this.options.saveEnabled(false);
        await this.options.adapter.clear().catch(() => undefined);
        this.lastResult = { applied: 0, unresolved: 0 };
        return this.status(false, await this.options.adapter.checkPermission());
      }
      const permission = await this.options.adapter.checkPermission();
      if (!this.options.adapter.supported || !new Set<AppEnvironmentBadgePermission>(["granted", "not-required"]).has(permission)) {
        await this.options.saveEnabled(false);
        return this.status(false, permission);
      }
      await this.options.saveEnabled(true);
      return this.syncUnlocked(permission);
    });
  }

  sync(): Promise<AppEnvironmentBadgeStatus> {
    return this.enqueue(async () => {
      const enabled = await this.options.readEnabled();
      const permission = await this.options.adapter.checkPermission();
      if (!enabled || !this.options.adapter.supported || !new Set<AppEnvironmentBadgePermission>(["granted", "not-required"]).has(permission)) {
        if (enabled && permission !== "unsupported") await this.options.saveEnabled(false);
        await this.options.adapter.clear().catch(() => undefined);
        this.lastResult = { applied: 0, unresolved: 0 };
        return this.status(false, permission);
      }
      return this.syncUnlocked(permission);
    });
  }

  private async syncUnlocked(permission: AppEnvironmentBadgePermission): Promise<AppEnvironmentBadgeStatus> {
    const instances = (await this.options.listInstances())
      .map(managedRecordToBadgeInstance)
      .filter((item): item is AppEnvironmentBadgeInstance => item !== null);
    try {
      this.lastResult = await this.options.adapter.sync(instances);
    } catch (error) {
      this.lastResult = {
        applied: 0,
        unresolved: instances.length,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return this.status(true, permission);
  }

  private enqueue(operation: () => Promise<AppEnvironmentBadgeStatus>): Promise<AppEnvironmentBadgeStatus> {
    const next = this.queue.catch(() => this.baseStatus(false, "unsupported")).then(operation);
    this.queue = next;
    return next;
  }

  private status(enabled: boolean, permission: AppEnvironmentBadgePermission): AppEnvironmentBadgeStatus {
    return { ...this.baseStatus(enabled, permission), ...this.lastResult };
  }

  private baseStatus(enabled: boolean, permission: AppEnvironmentBadgePermission): AppEnvironmentBadgeStatus {
    return {
      enabled,
      supported: this.options.adapter.supported,
      platform: this.options.adapter.platform,
      permission,
      applied: 0,
      unresolved: 0,
    };
  }
}

export function createUnsupportedBadgeAdapter(): AppEnvironmentBadgeAdapter {
  return {
    platform: "unsupported",
    supported: false,
    checkPermission: async () => "unsupported",
    requestPermission: async () => "unsupported",
    sync: async (instances) => ({ applied: 0, unresolved: instances.length, message: "Unsupported platform" }),
    clear: async () => undefined,
  };
}
