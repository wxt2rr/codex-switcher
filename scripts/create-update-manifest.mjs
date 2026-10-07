#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const artifact = required(args.artifact, "--artifact");
const version = required(args.version, "--version");
const channel = args.channel ?? "stable";
const platform = required(args.platform, "--platform");
const artifactUrl = required(args.url, "--url");
const privateKeyPem = args["key-file"] ? readFileSync(args["key-file"], "utf8") : process.env.CODEX_SWITCHER_UPDATE_SIGNING_KEY;
if (!privateKeyPem) throw new Error("missing --key-file or CODEX_SWITCHER_UPDATE_SIGNING_KEY");
if (!["stable", "beta", "nightly"].includes(channel)) throw new Error("--channel must be stable, beta or nightly");

const privateKey = createPrivateKey(privateKeyPem);
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
const manifest = {
  version,
  channel,
  platforms: [platform],
  artifactUrl,
  sha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
  publishedAt: Number(args.publishedAt ?? Date.now()),
  publicKey,
};
validateManifest(manifest);
manifest.signature = sign(null, Buffer.from(canonicalize(manifest)), privateKey).toString("base64url");
const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (args.out) writeFileSync(args.out, output, { mode: 0o600 });
else process.stdout.write(output);

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
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)) throw new Error("--version must be a semantic version");
  if (!Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.some((item) => !/^[a-z0-9][a-z0-9-]*$/.test(item))) throw new Error("--platform must be a valid platform id");
  try {
    const parsed = new URL(value.artifactUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new Error("--url must be an http(s) URL");
  }
  if (!/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error("artifact hash must be a SHA-256 hex digest");
  if (!Number.isFinite(value.publishedAt) || value.publishedAt <= 0) throw new Error("--publishedAt must be a positive timestamp");
}

function canonicalize(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}
