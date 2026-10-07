import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DesktopUpdateManifest {
  version: string;
  channel: "stable" | "beta" | "nightly";
  platforms: string[];
  artifactUrl: string;
  sha256: string;
  publishedAt: number;
  signature?: string;
  publicKey?: string;
}

export function validateUpdateManifest(value: unknown): value is DesktopUpdateManifest {
  if (!isRecord(value)) return false;
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)) return false;
  if (value.channel !== "stable" && value.channel !== "beta" && value.channel !== "nightly") return false;
  if (!Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.some((item) => typeof item !== "string" || !item.trim())) return false;
  if (typeof value.artifactUrl !== "string" || !value.artifactUrl.trim()) return false;
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) return false;
  if (typeof value.publishedAt !== "number" || !Number.isFinite(value.publishedAt) || value.publishedAt <= 0) return false;
  if (value.signature !== undefined && typeof value.signature !== "string") return false;
  if (value.publicKey !== undefined && typeof value.publicKey !== "string") return false;
  return true;
}

export interface UpdateRollbackRecord {
  state: "pending";
  currentVersion: string;
  nextVersion: string;
  backupPath: string;
  preparedAt: number;
  bootStartedAt?: number;
}

export interface UpdateRollbackJournal {
  read(): UpdateRollbackRecord | undefined;
  prepare(input: Omit<UpdateRollbackRecord, "state" | "preparedAt">, now?: number): UpdateRollbackRecord;
  beginBoot(currentVersion: string, restore: (record: UpdateRollbackRecord) => void, now?: number): "armed" | "restored" | "cleared" | "none";
  markHealthy(version: string): void;
  recover(currentVersion: string, restore: (record: UpdateRollbackRecord) => void): "restored" | "cleared" | "none";
}

export function canonicalizeUpdateManifest(manifest: DesktopUpdateManifest): string {
  const unsigned = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "signature"));
  return JSON.stringify(sortJson(unsigned));
}

export function signUpdateManifest(manifest: DesktopUpdateManifest, privateKeyPem: string): string {
  return sign(null, Buffer.from(canonicalizeUpdateManifest(manifest)), createPrivateKey(privateKeyPem)).toString("base64url");
}

export function verifyUpdateManifestSignature(manifest: DesktopUpdateManifest, trustedPublicKeyPem?: string): boolean {
  if (!validateUpdateManifest(manifest) || !manifest.signature || !trustedPublicKeyPem) return false;
  try {
    return verify(
      null,
      Buffer.from(canonicalizeUpdateManifest(manifest)),
      createPublicKey(trustedPublicKeyPem),
      Buffer.from(manifest.signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function verifyUpdateManifest(
  manifest: DesktopUpdateManifest,
  options: { trustedPublicKeyPem?: string; requireSignature?: boolean } = {},
): { ok: true; signatureVerified: boolean } | { ok: false; reason: string } {
  if (!validateUpdateManifest(manifest)) return { ok: false, reason: "Update manifest metadata is invalid" };
  const requireSignature = options.requireSignature ?? Boolean(options.trustedPublicKeyPem);
  const signatureProvided = Boolean(manifest.signature);
  const signatureVerified = signatureProvided && Boolean(options.trustedPublicKeyPem) && verifyUpdateManifestSignature(manifest, options.trustedPublicKeyPem);
  if ((requireSignature || signatureProvided || options.trustedPublicKeyPem) && !signatureVerified) {
    return { ok: false, reason: "Update manifest signature verification failed" };
  }
  return { ok: true, signatureVerified };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyUpdateArtifact(path: string, expectedSha256: string): boolean {
  return existsSync(path) && sha256File(path) === expectedSha256.trim().toLowerCase();
}

export function createUpdateRollbackJournal(path: string): UpdateRollbackJournal {
  function read(): UpdateRollbackRecord | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(value) || value.state !== "pending" || typeof value.currentVersion !== "string" || typeof value.nextVersion !== "string" || typeof value.backupPath !== "string" || typeof value.preparedAt !== "number" || (value.bootStartedAt !== undefined && typeof value.bootStartedAt !== "number")) return undefined;
      return value as unknown as UpdateRollbackRecord;
    } catch {
      return undefined;
    }
  }

  function write(record: UpdateRollbackRecord): void {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      renameSync(temporaryPath, path);
    } catch (error) {
      try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  function clear(): void {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, "", { mode: 0o600 });
      renameSync(temporaryPath, path);
    } catch (error) {
      try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  return {
    read,
    prepare(input, now = Date.now()) {
      const record: UpdateRollbackRecord = { state: "pending", ...input, preparedAt: now };
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      write(record);
      return record;
    },
    beginBoot(currentVersion, restore, now = Date.now()) {
      const record = read();
      if (!record) return "none";
      if (record.currentVersion === currentVersion) {
        clear();
        return "cleared";
      }
      if (record.nextVersion !== currentVersion) return "none";
      if (record.bootStartedAt !== undefined) {
        restore(record);
        clear();
        return "restored";
      }
      write({ ...record, bootStartedAt: now });
      return "armed";
    },
    markHealthy(version) {
      const record = read();
      if (record && (record.nextVersion === version || record.currentVersion === version)) {
        clear();
      }
    },
    recover(currentVersion, restore) {
      const record = read();
      if (!record) return "none";
      if (record.currentVersion === currentVersion) {
        clear();
        return "cleared";
      }
      if (record.nextVersion !== currentVersion) return "none";
      restore(record);
      clear();
      return "restored";
    },
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveUpdateJournalPath(userDataPath: string): string {
  return join(userDataPath, "updates", "install-rollback.json");
}
