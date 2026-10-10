#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const directory = required(args.dir, "--dir");
const version = required(args.version, "--version");
const channel = args.channel ?? "stable";
const releaseUrl = required(args["release-url"], "--release-url");
const artifactBaseUrl = required(args["artifact-base-url"], "--artifact-base-url");
const output = required(args.out, "--out");
const privateKeyPem = args["key-file"] ? readFileSync(args["key-file"], "utf8") : process.env.CODEX_SWITCHER_UPDATE_SIGNING_KEY;
const artifacts = [];

for (const fileName of readdirSync(directory)) {
  const kind = classify(fileName);
  if (!kind) continue;
  const filePath = join(directory, fileName);
  if (!statSync(filePath).isFile()) continue;
  artifacts.push({
    platform: platformFor(fileName, kind),
    kind,
    fileName,
    url: `${artifactBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`,
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    size: statSync(filePath).size,
  });
}

if (artifacts.length === 0) throw new Error("no desktop artifacts found");
const index = { version, channel, releaseUrl, publishedAt: Date.now(), artifacts };
if (privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  index.publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  index.signature = sign(null, Buffer.from(canonicalize(index)), privateKey).toString("base64url");
}
writeFileSync(output, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Created update index: ${output} (${artifacts.length} artifacts${privateKeyPem ? ", signed" : ""})`);

function classify(fileName) {
  if (fileName.endsWith("-arm64-mac.zip") || (fileName.endsWith("-mac.zip") && !fileName.includes("-arm64-mac"))) return "mac-zip";
  if (fileName.endsWith("-arm64.dmg") || (fileName.endsWith(".dmg") && !fileName.includes("-arm64.dmg"))) return "mac-dmg";
  if (fileName.endsWith(".exe") && !fileName.endsWith(".blockmap")) return "win-nsis";
  if (fileName.endsWith(".AppImage")) return "linux-appimage";
  if (fileName.endsWith(".deb")) return "linux-deb";
  return undefined;
}

function platformFor(fileName, kind) {
  if (kind.startsWith("mac-")) return fileName.includes("arm64") ? "darwin-arm64" : "darwin-x64";
  if (kind === "win-nsis") return fileName.includes("arm64") ? "win32-arm64" : "win32-x64";
  return fileName.includes("arm64") ? "linux-arm64" : "linux-x64";
}

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

function canonicalize(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}
