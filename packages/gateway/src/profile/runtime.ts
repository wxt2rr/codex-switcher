import { createHash } from "node:crypto";

export type GatewayOperatingMode = "manual" | "gateway";

export interface GatewayProfile {
  id: string;
  displayName: string;
  environmentId: string;
  mode: GatewayOperatingMode;
  selectedAccountId?: string;
  gatewayId?: string;
  defaultModelId?: string;
  updatedAt: number;
}

export interface UpdateManifest {
  version: string;
  channel: "stable" | "beta" | "nightly";
  platforms: string[];
  artifactUrl: string;
  sha256: string;
  publishedAt: number;
}

export interface TrayMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
}

export function validateGatewayProfile(value: unknown): value is GatewayProfile {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.displayName === "string" && typeof value.environmentId === "string"
    && (value.mode === "manual" || value.mode === "gateway") && typeof value.updatedAt === "number"
    && (value.selectedAccountId === undefined || typeof value.selectedAccountId === "string")
    && (value.gatewayId === undefined || typeof value.gatewayId === "string")
    && (value.defaultModelId === undefined || typeof value.defaultModelId === "string");
}

export function dispatchMode(profile: GatewayProfile): "manual-account" | "gateway-route" {
  return profile.mode === "gateway" ? "gateway-route" : "manual-account";
}

export function buildTrayMenu(profile: GatewayProfile, accounts: readonly { id: string; displayName: string }[]): TrayMenuItem[] {
  return [
    { id: "mode-manual", label: "Manual account switching", enabled: true, checked: profile.mode === "manual" },
    { id: "mode-gateway", label: "Gateway routing", enabled: Boolean(profile.gatewayId), checked: profile.mode === "gateway" },
    ...accounts.map((account) => ({ id: `account:${account.id}`, label: `Account: ${account.displayName}`, enabled: profile.mode === "manual", checked: profile.selectedAccountId === account.id })),
    { id: "gateway-status", label: "Open gateway status", enabled: true },
  ];
}

export function chooseUpdate(currentVersion: string, manifest: UpdateManifest, platform: string, channel: UpdateManifest["channel"] = "stable"): UpdateManifest | null {
  if (manifest.channel !== channel || !manifest.platforms.includes(platform) || compareVersions(manifest.version, currentVersion) <= 0) return null;
  return manifest;
}

export function verifyArtifact(bytes: Uint8Array, expectedSha256: string): boolean {
  return createHash("sha256").update(bytes).digest("hex") === expectedSha256.toLowerCase();
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number(part) || 0);
  const b = right.split(/[.-]/).map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
