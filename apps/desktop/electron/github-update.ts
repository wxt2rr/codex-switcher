import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";

import {
  validateUpdateIndex,
  verifyUpdateArtifact,
  verifyUpdateIndex,
  type DesktopUpdateArtifact,
  type DesktopUpdateIndex,
} from "./update-security.js";

export type DesktopUpdateChannel = "stable" | "beta" | "nightly" | "all";

export interface GitHubUpdateCandidate {
  index: DesktopUpdateIndex;
  artifact: DesktopUpdateArtifact;
  releaseTag: string;
  signatureVerified: boolean;
}

export interface GitHubUpdateClientOptions {
  owner: string;
  repo: string;
  platform: string;
  currentVersion: string;
  channel?: DesktopUpdateChannel;
  trustedPublicKeyPem?: string;
  requireSignedIndex?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface DownloadedUpdate {
  path: string;
  candidate: GitHubUpdateCandidate;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

export async function findGitHubUpdate(options: GitHubUpdateClientOptions): Promise<GitHubUpdateCandidate | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const channel = options.channel ?? "all";
  const releasesResponse = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/releases?per_page=30`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "codex-switcher-updater" } },
  );
  if (!releasesResponse.ok) throw new Error(`GitHub release query failed (${releasesResponse.status})`);
  const releases = await releasesResponse.json() as unknown;
  if (!Array.isArray(releases)) throw new Error("GitHub release response is invalid");

  const sorted = releases
    .filter(isRelease)
    .filter((release) => !release.draft && typeof release.tag_name === "string" && release.tag_name.startsWith("desktop-v"))
    .sort((left, right) => compareVersions(extractVersion(right.tag_name as string), extractVersion(left.tag_name as string)));

  for (const release of sorted) {
    const version = extractVersion(release.tag_name as string);
    if (!version || compareVersions(version, options.currentVersion) <= 0) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => isAsset(item) && item.name === "latest.json");
    if (!asset || !isAsset(asset) || typeof asset.browser_download_url !== "string") continue;
    const indexResponse = await fetchImpl(asset.browser_download_url, {
      headers: { Accept: "application/octet-stream", "User-Agent": "codex-switcher-updater" },
    });
    if (!indexResponse.ok) throw new Error(`GitHub update index download failed (${indexResponse.status})`);
    const index = await indexResponse.json() as unknown;
    if (!isUpdateIndex(index)) continue;
    if (channel !== "all" && index.channel !== channel) continue;
    const verification = verifyUpdateIndex(index, {
      trustedPublicKeyPem: options.trustedPublicKeyPem,
      requireSignature: options.requireSignedIndex,
    });
    if (!verification.ok) throw new Error(verification.reason);
    const artifact = index.artifacts.find((item) => item.platform === options.platform);
    if (!artifact) continue;
    if (compareVersions(index.version, options.currentVersion) <= 0) continue;
    return { index, artifact, releaseTag: release.tag_name as string, signatureVerified: verification.signatureVerified };
  }
  return undefined;
}

export async function downloadUpdate(
  candidate: GitHubUpdateCandidate,
  directory: string,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadedUpdate> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `${candidate.artifact.fileName}.${process.pid}.download`);
  const outputPath = join(directory, candidate.artifact.fileName);
  rmSync(temporaryPath, { force: true });
  const response = await fetchImpl(candidate.artifact.url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "codex-switcher-updater" },
  });
  if (!response.ok) throw new Error(`Update download failed (${response.status})`);
  const totalBytes = parseContentLength(response.headers.get("content-length")) ?? candidate.artifact.size;
  let receivedBytes = 0;
  const output = createWriteStream(temporaryPath, { mode: 0o600 });
  try {
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value;
        receivedBytes += value.byteLength;
        if (!output.write(Buffer.from(value))) await once(output, "drain");
        onProgress?.({ receivedBytes, totalBytes, percent: totalBytes ? Math.min(100, receivedBytes / totalBytes * 100) : undefined });
      }
    } else {
      const value = Buffer.from(await response.arrayBuffer());
      receivedBytes = value.byteLength;
      output.write(value);
      onProgress?.({ receivedBytes, totalBytes, percent: totalBytes ? Math.min(100, receivedBytes / totalBytes * 100) : undefined });
    }
    output.end();
    await once(output, "close");
    if (!verifyUpdateArtifact(temporaryPath, candidate.artifact.sha256)) throw new Error("Downloaded update failed SHA-256 verification");
    renameSync(temporaryPath, outputPath);
    return { path: outputPath, candidate };
  } catch (error) {
    output.destroy();
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function isUpdateIndex(value: unknown): value is DesktopUpdateIndex {
  return validateUpdateIndex(value);
}

function isRelease(value: unknown): value is GitHubRelease {
  return Boolean(value && typeof value === "object");
}

function isAsset(value: unknown): value is { name: string; browser_download_url?: string } {
  return Boolean(value && typeof value === "object" && "name" in value && typeof value.name === "string");
}

function extractVersion(tag: string): string {
  return tag.replace(/^desktop-v/, "");
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
  const b = right.split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
