import { createPublicKey, verify } from "node:crypto";

import type { GatewayPluginManifest } from "./host.js";

/**
 * Serialize the provider manifest without its signature. The directory
 * checksum is included in the signed payload so a trusted key covers both
 * the declared capabilities and the exact installed plugin contents.
 */
export function serializePluginManifestForSigning(
  manifest: GatewayPluginManifest,
  checksum?: string,
): string | undefined {
  if (manifest.checksum && checksum && manifest.checksum.toLowerCase() !== checksum.toLowerCase()) return undefined;
  const unsigned = Object.fromEntries(
    Object.entries({
      ...manifest,
      ...(checksum ? { checksum } : {}),
    })
      .filter(([key]) => key !== "signature")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify(unsigned);
}

export function verifyPluginManifestSignature(
  manifest: GatewayPluginManifest,
  trustedPublicKeyPem: string | undefined,
  checksum?: string,
): boolean {
  if (!manifest.signature || !trustedPublicKeyPem?.trim()) return false;
  const payload = serializePluginManifestForSigning(manifest, checksum);
  if (!payload) return false;
  try {
    return verify(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(trustedPublicKeyPem),
      Buffer.from(manifest.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
