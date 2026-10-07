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
export declare function validateGatewayProfile(value: unknown): value is GatewayProfile;
export declare function dispatchMode(profile: GatewayProfile): "manual-account" | "gateway-route";
export declare function buildTrayMenu(profile: GatewayProfile, accounts: readonly {
    id: string;
    displayName: string;
}[]): TrayMenuItem[];
export declare function chooseUpdate(currentVersion: string, manifest: UpdateManifest, platform: string, channel?: UpdateManifest["channel"]): UpdateManifest | null;
export declare function verifyArtifact(bytes: Uint8Array, expectedSha256: string): boolean;
