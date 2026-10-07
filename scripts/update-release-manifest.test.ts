import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("release manifest contains an artifact hash and verifiable Ed25519 signature", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-release-manifest-"));
  try {
    const artifact = join(root, "codex-switcher.dmg");
    const keyFile = join(root, "release-key.pem");
    const output = join(root, "manifest.json");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await writeFile(artifact, "release-bytes");
    await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
    await execFileAsync("node", ["scripts/create-update-manifest.mjs", "--artifact", artifact, "--key-file", keyFile, "--version", "2.0.0", "--channel", "stable", "--platform", "darwin-arm64", "--url", "https://updates.example.test/codex.dmg", "--publishedAt", "1", "--out", output], { cwd: process.cwd() });
    const verification = await execFileAsync("node", ["scripts/verify-update-manifest.mjs", "--manifest", output, "--artifact", artifact], { cwd: process.cwd() });
    assert.match(verification.stdout, /Verified update manifest/);
    await writeFile(artifact, "tampered-release-bytes");
    await assert.rejects(
      execFileAsync("node", ["scripts/verify-update-manifest.mjs", "--manifest", output, "--artifact", artifact], { cwd: process.cwd() }),
      /artifact hash mismatch/,
    );
    const manifest = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    assert.equal(manifest.sha256, createHash("sha256").update("release-bytes").digest("hex"));
    assert.equal(manifest.publishedAt, 1);
    const signature = String(manifest.signature);
    delete manifest.signature;
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, sortJson(manifest[key])] )));
    assert.equal(verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, "base64url")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest tooling rejects malformed metadata before signature verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-release-manifest-invalid-"));
  try {
    const artifact = join(root, "codex-switcher.dmg");
    const keyFile = join(root, "release-key.pem");
    const output = join(root, "manifest.json");
    const { privateKey } = generateKeyPairSync("ed25519");
    await writeFile(artifact, "release-bytes");
    await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
    await assert.rejects(
      execFileAsync("node", ["scripts/create-update-manifest.mjs", "--artifact", artifact, "--key-file", keyFile, "--version", "not-a-version", "--channel", "stable", "--platform", "darwin-arm64", "--url", "https://updates.example.test/codex.dmg", "--publishedAt", "1", "--out", output], { cwd: process.cwd() }),
      /semantic version/,
    );
    await writeFile(output, JSON.stringify({ version: "2.0.0", channel: "stable", platforms: ["darwin-arm64"], artifactUrl: "file:///unsafe", sha256: "0".repeat(64), publishedAt: 1, publicKey: "bad", signature: "bad" }));
    await assert.rejects(
      execFileAsync("node", ["scripts/verify-update-manifest.mjs", "--manifest", output, "--artifact", artifact], { cwd: process.cwd() }),
      /http\(s\) URL/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortJson(record[key])]));
}
