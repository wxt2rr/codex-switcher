import { createHash } from "node:crypto";
export function validateGatewayProfile(value) {
    if (!isRecord(value))
        return false;
    return typeof value.id === "string" && typeof value.displayName === "string" && typeof value.environmentId === "string"
        && (value.mode === "manual" || value.mode === "gateway") && typeof value.updatedAt === "number"
        && (value.selectedAccountId === undefined || typeof value.selectedAccountId === "string")
        && (value.gatewayId === undefined || typeof value.gatewayId === "string")
        && (value.defaultModelId === undefined || typeof value.defaultModelId === "string");
}
export function dispatchMode(profile) {
    return profile.mode === "gateway" ? "gateway-route" : "manual-account";
}
export function buildTrayMenu(profile, accounts) {
    return [
        { id: "mode-manual", label: "Manual account switching", enabled: true, checked: profile.mode === "manual" },
        { id: "mode-gateway", label: "Gateway routing", enabled: Boolean(profile.gatewayId), checked: profile.mode === "gateway" },
        ...accounts.map((account) => ({ id: `account:${account.id}`, label: `Account: ${account.displayName}`, enabled: profile.mode === "manual", checked: profile.selectedAccountId === account.id })),
        { id: "gateway-status", label: "Open gateway status", enabled: true },
    ];
}
export function chooseUpdate(currentVersion, manifest, platform, channel = "stable") {
    if (manifest.channel !== channel || !manifest.platforms.includes(platform) || compareVersions(manifest.version, currentVersion) <= 0)
        return null;
    return manifest;
}
export function verifyArtifact(bytes, expectedSha256) {
    return createHash("sha256").update(bytes).digest("hex") === expectedSha256.toLowerCase();
}
function compareVersions(left, right) {
    const a = left.split(/[.-]/).map((part) => Number(part) || 0);
    const b = right.split(/[.-]/).map((part) => Number(part) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1)
        if ((a[index] ?? 0) !== (b[index] ?? 0))
            return (a[index] ?? 0) - (b[index] ?? 0);
    return 0;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
//# sourceMappingURL=runtime.js.map