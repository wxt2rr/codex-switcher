import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AppEnvironmentBadgeAdapter,
  AppEnvironmentBadgeInstance,
  AppEnvironmentBadgePermission,
  AppEnvironmentBadgeSyncResult,
} from "./app-environment-badges.js";
import { getConfiguredResourcesPath, resolveRuntimeResource } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);

interface MacBadgeNativeModule {
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  getCodexDockRects(): Array<{ x: number; y: number; width: number; height: number }>;
  setEnvironmentBadges(instances: Array<{ label: string; color: string }>): number;
  clearEnvironmentBadges(): void;
}

function nativeResource(relativePath: string, currentFile: string): string {
  const resourcesPath = getConfiguredResourcesPath();
  const packaged = resolveRuntimeResource(join("native", relativePath), { currentFile, resourcesPath });
  if (existsSync(packaged)) return packaged;
  return resolveRuntimeResource(join("apps", "desktop", "resources", "native", relativePath), { currentFile });
}

export class MacDockBadgeAdapter implements AppEnvironmentBadgeAdapter {
  readonly platform = "macos" as const;
  readonly supported: boolean;
  private readonly native?: MacBadgeNativeModule;

  constructor(currentFile: string) {
    const nativePath = nativeResource(join("macos", "app-environment-badge-native.node"), currentFile);
    if (existsSync(nativePath)) {
      try {
        const nativeRequire = createRequire(join(currentFile, "app-environment-badge-native-loader.cjs"));
        this.native = nativeRequire(nativePath) as MacBadgeNativeModule;
      } catch {
        this.native = undefined;
      }
    }
    this.supported = Boolean(this.native);
  }

  async checkPermission(): Promise<AppEnvironmentBadgePermission> {
    if (!this.native) return "unsupported";
    return this.native.isTrustedAccessibilityClient(false) ? "granted" : "denied";
  }

  async requestPermission(): Promise<AppEnvironmentBadgePermission> {
    if (!this.native) return "unsupported";
    return this.native.isTrustedAccessibilityClient(true) ? "granted" : "denied";
  }

  async sync(instances: AppEnvironmentBadgeInstance[]): Promise<AppEnvironmentBadgeSyncResult> {
    if (!this.native) return { applied: 0, unresolved: instances.length, message: "macOS badge native module is unavailable" };
    const ordered = [...instances].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    const applied = this.native.setEnvironmentBadges(ordered.map((instance) => ({ label: instance.label, color: instance.color })));
    return {
      applied,
      unresolved: Math.max(0, instances.length - applied),
    };
  }

  async clear(): Promise<void> {
    this.native?.clearEnvironmentBadges();
  }
}

export class WindowsTaskbarBadgeAdapter implements AppEnvironmentBadgeAdapter {
  readonly platform = "windows" as const;
  readonly supported: boolean;
  private readonly helperPath: string;
  private lastInstances: AppEnvironmentBadgeInstance[] = [];

  constructor(currentFile: string) {
    this.helperPath = nativeResource(join("windows", "app-environment-badge.ps1"), currentFile);
    this.supported = existsSync(this.helperPath);
  }

  async checkPermission(): Promise<AppEnvironmentBadgePermission> { return this.supported ? "not-required" : "unsupported"; }
  async requestPermission(): Promise<AppEnvironmentBadgePermission> { return this.checkPermission(); }

  async sync(instances: AppEnvironmentBadgeInstance[]): Promise<AppEnvironmentBadgeSyncResult> {
    this.lastInstances = instances;
    return this.invoke("sync", instances);
  }

  async clear(): Promise<void> {
    await this.invoke("clear", this.lastInstances).catch(() => undefined);
    this.lastInstances = [];
  }

  private async invoke(action: "sync" | "clear", instances: AppEnvironmentBadgeInstance[]): Promise<AppEnvironmentBadgeSyncResult> {
    if (!this.supported) return { applied: 0, unresolved: instances.length, message: "Windows badge helper is unavailable" };
    const workDir = await mkdtemp(join(tmpdir(), "codex-switcher-app-badges-"));
    const requestPath = join(workDir, "request.json");
    try {
      await writeFile(requestPath, JSON.stringify({ action, instances }), "utf8");
      const shell = process.env.ComSpec?.toLowerCase().includes("powershell") ? process.env.ComSpec : "powershell.exe";
      const { stdout } = await execFileAsync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.helperPath, requestPath], { windowsHide: true, timeout: 8_000 });
      return JSON.parse(stdout.trim()) as AppEnvironmentBadgeSyncResult;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
