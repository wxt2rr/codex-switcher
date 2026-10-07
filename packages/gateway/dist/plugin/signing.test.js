import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { serializePluginManifestForSigning, verifyPluginManifestSignature } from "./signing.js";
test("provider plugin manifest signatures bind capabilities and directory checksum", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = {
        id: "signed-provider",
        name: "Signed Provider",
        version: "1.0.0",
        apiVersion: 1,
        entry: "index.js",
        permissions: ["provider", "network"],
    };
    const checksum = `sha256:${"a".repeat(64)}`;
    const payload = serializePluginManifestForSigning(manifest, checksum);
    assert.ok(payload);
    const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
    const signedManifest = { ...manifest, signature };
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.equal(verifyPluginManifestSignature(signedManifest, publicKeyPem, checksum), true);
    assert.equal(verifyPluginManifestSignature({ ...signedManifest, permissions: ["provider"] }, publicKeyPem, checksum), false);
    assert.equal(verifyPluginManifestSignature(signedManifest, publicKeyPem, `sha256:${"b".repeat(64)}`), false);
});
//# sourceMappingURL=signing.test.js.map