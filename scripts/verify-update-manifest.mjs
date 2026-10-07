#!/usr/bin/env node
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const manifestPath = required(args.manifest, "--manifest");
const artifactPath = required(args.artifact, "--artifact");
const trustedPublicKeyPath = typeof args["trusted-public-key-file"] === "string" ? args["trusted-public-key-file"] : undefined;
const trustedPublicKeyPem = trustedPublicKeyPath
  ? readFileSync(trustedPublicKeyPath, "utf8")
  : process.env.CODEX_SWITCHER_UPDATE_TRUSTED_PUBLIC_KEY;
if (!existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
if (!existsSync(artifactPath)) throw new Error(`artifact not found: ${artifactPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validateManifest(manifest);

const actualHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
if (actualHash !== manifest.sha256.toLowerCase()) throw new Error(`artifact hash mismatch: expected ${manifest.sha256}, got ${actualHash}`);

const unsigned = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "signature"));
let verificationKey;
try {
  const declaredKey = createPublicKey(manifest.publicKey);
  verificationKey = trustedPublicKeyPem ? createPublicKey(trustedPublicKeyPem) : declaredKey;
  if (trustedPublicKeyPem && !Buffer.from(declaredKey.export({ type: "spki", format: "der" })).equals(Buffer.from(verificationKey.export({ type: "spki", format: "der" })))) {
    throw new Error("manifest public key does not match the trusted release key");
  }
} catch (error) {
  throw new Error(error instanceof Error && error.message.includes("does not match")
    ? error.message
    : "manifest public key is invalid");
}
const validSignature = verify(
  null,
  Buffer.from(canonicalize(unsigned)),
  verificationKey,
  Buffer.from(manifest.signature, "base64url"),
);
if (!validSignature) throw new Error("manifest signature verification failed");
console.log(`Verified update manifest: ${manifestPath}`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? "";
    if (!value.startsWith("--")) throw new Error(`unexpected argument '${value}'`);
    const key = value.slice(2);
    result[key] = values[index + 1]?.startsWith("--") || values[index + 1] === undefined ? true : values[++index];
  }
  return result;
}

function required(value, flag) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing ${flag}`);
  return value;
}

function validateManifest(value) {
  if (!isRecord(value)) throw new Error("manifest must be an object");
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)) throw new Error("manifest version is invalid");
  if (value.channel !== "stable" && value.channel !== "beta" && value.channel !== "nightly") throw new Error("manifest channel is invalid");
  if (!Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.some((item) => typeof item !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item))) throw new Error("manifest platforms are invalid");
  if (typeof value.artifactUrl !== "string") throw new Error("manifest artifactUrl is invalid");
  try {
    const parsed = new URL(value.artifactUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new Error("manifest artifactUrl must be an http(s) URL");
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error("manifest sha256 is invalid");
  if (typeof value.publishedAt !== "number" || !Number.isFinite(value.publishedAt) || value.publishedAt <= 0) throw new Error("manifest publishedAt is invalid");
  if (typeof value.publicKey !== "string" || !value.publicKey.trim() || typeof value.signature !== "string" || !value.signature.trim()) throw new Error("manifest must include publicKey and signature");
}

function canonicalize(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
