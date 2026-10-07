import {
  verifyUpdateArtifact,
  verifyUpdateManifest,
  type DesktopUpdateManifest,
  type UpdateRollbackJournal,
} from "./update-security.js";

export type DesktopAutoUpdateState = "disabled" | "idle" | "checking" | "available" | "downloaded" | "error";

export interface DesktopAutoUpdateStatus {
  enabled: boolean;
  state: DesktopAutoUpdateState;
  version?: string;
  message?: string;
  checkedAt?: number;
  signatureVerified?: boolean;
  rollbackAvailable?: boolean;
  downloadedFile?: string;
}

export interface AutoUpdaterLike {
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): void | Promise<unknown>;
  quitAndInstall(): void;
  on(event: "checking-for-update" | "update-available" | "update-not-available" | "update-downloaded" | "error", listener: (...args: unknown[]) => void): void;
}

export interface DesktopAutoUpdateController {
  getStatus(): DesktopAutoUpdateStatus;
  check(): Promise<DesktopAutoUpdateStatus>;
  install(): DesktopAutoUpdateStatus;
  markHealthy(): void;
  beginBoot(restore?: (backupPath: string) => void): "armed" | "restored" | "cleared" | "none";
}

export function restartAfterRollback(
  bootResult: "armed" | "restored" | "cleared" | "none",
  actions: { relaunch(): void; exit(exitCode?: number): void },
): boolean {
  if (bootResult !== "restored") return false;
  actions.relaunch();
  actions.exit(0);
  return true;
}

export interface DesktopAutoUpdateOptions {
  feedUrl?: string;
  now?: () => number;
  manifest?: DesktopUpdateManifest;
  trustedPublicKeyPem?: string;
  requireSignedManifest?: boolean;
  rollbackJournal?: UpdateRollbackJournal;
  currentVersion?: string;
  backupPath?: string;
  prepareRollbackBackup?: (backupPath: string) => void;
  restoreRollbackBackup?: (backupPath: string) => void;
}

export function createDesktopAutoUpdateController(
  updater: AutoUpdaterLike,
  options: DesktopAutoUpdateOptions = {},
): DesktopAutoUpdateController {
  const now = options.now ?? Date.now;
  const feedUrl = options.feedUrl?.trim();
  const manifest = options.manifest;
  let status: DesktopAutoUpdateStatus = feedUrl
    ? { enabled: true, state: "idle" }
    : { enabled: false, state: "disabled", message: "Update feed is not configured" };

  if (feedUrl) {
    updater.setFeedURL({ provider: "generic", url: feedUrl });
    updater.on("checking-for-update", () => { status = { ...status, state: "checking", checkedAt: now(), message: undefined }; });
    updater.on("update-available", (...args) => { status = { ...status, state: "available", checkedAt: now(), ...(typeof args[0] === "object" && args[0] && "version" in args[0] && typeof args[0].version === "string" ? { version: args[0].version } : {}) }; });
    updater.on("update-not-available", () => { status = { ...status, state: "idle", checkedAt: now(), message: "Already up to date" }; });
    updater.on("update-downloaded", (...args) => {
      const metadata = isRecord(args[0]) ? args[0] : undefined;
      const version = metadata && typeof metadata.version === "string" ? metadata.version : undefined;
      const downloadedFile = metadata && typeof metadata.downloadedFile === "string"
        ? metadata.downloadedFile
        : metadata && typeof metadata.artifactPath === "string" ? metadata.artifactPath : undefined;
      if (manifest && (!downloadedFile || !verifyUpdateArtifact(downloadedFile, manifest.sha256))) {
        status = { ...status, state: "error", checkedAt: now(), message: "Downloaded update failed SHA-256 verification", downloadedFile };
        return;
      }
      status = {
        ...status,
        state: "downloaded",
        checkedAt: now(),
        ...(version ? { version } : {}),
        ...(downloadedFile ? { downloadedFile } : {}),
      };
    });
    updater.on("error", (...args) => { status = { ...status, state: "error", checkedAt: now(), message: args[0] instanceof Error ? args[0].message : String(args[0] ?? "Update failed") }; });
  }

  return {
    getStatus: () => ({ ...status }),
    async check() {
      if (!feedUrl) return { ...status };
      status = { ...status, state: "checking", checkedAt: now(), message: undefined };
      if (options.requireSignedManifest && !manifest) {
        status = {
          ...status,
          state: "error",
          checkedAt: now(),
          signatureVerified: false,
          message: "Signed update manifest is required but not configured",
        };
        return { ...status };
      }
      if (manifest) {
        const verification = verifyUpdateManifest(manifest, {
          trustedPublicKeyPem: options.trustedPublicKeyPem,
          requireSignature: options.requireSignedManifest,
        });
        if (!verification.ok) {
          status = { ...status, state: "error", checkedAt: now(), message: verification.reason, signatureVerified: false };
          return { ...status };
        }
        status = { ...status, signatureVerified: verification.signatureVerified };
      }
      try {
        await updater.checkForUpdates();
      } catch (error) {
        status = { ...status, state: "error", checkedAt: now(), message: error instanceof Error ? error.message : String(error) };
      }
      return { ...status };
    },
    install() {
      if (status.state !== "downloaded") throw new Error("No downloaded update is ready to install");
      if (options.rollbackJournal) {
        if (!options.currentVersion || !status.version || !options.backupPath) throw new Error("Update rollback metadata is not configured");
        options.prepareRollbackBackup?.(options.backupPath);
        options.rollbackJournal.prepare({ currentVersion: options.currentVersion, nextVersion: status.version, backupPath: options.backupPath }, now());
        status = { ...status, rollbackAvailable: true };
      }
      updater.quitAndInstall();
      return { ...status };
    },
    markHealthy() {
      if (options.rollbackJournal && options.currentVersion) options.rollbackJournal.markHealthy(options.currentVersion);
    },
    beginBoot(restore = options.restoreRollbackBackup) {
      if (!options.rollbackJournal || !options.currentVersion) return "none";
      return options.rollbackJournal.beginBoot(options.currentVersion, (record) => restore?.(record.backupPath), now());
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
