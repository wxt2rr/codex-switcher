import type { GatewayPluginManifest } from "./host.js";
/**
 * Serialize the provider manifest without its signature. The directory
 * checksum is included in the signed payload so a trusted key covers both
 * the declared capabilities and the exact installed plugin contents.
 */
export declare function serializePluginManifestForSigning(manifest: GatewayPluginManifest, checksum?: string): string | undefined;
export declare function verifyPluginManifestSignature(manifest: GatewayPluginManifest, trustedPublicKeyPem: string | undefined, checksum?: string): boolean;
