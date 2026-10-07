import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const artifactPath = process.argv[2] || "release/mac-arm64/codex-switcher.app";

if (!artifactPath.endsWith(".app")) {
  assert.ok(existsSync(artifactPath), `Packaged artifact not found: ${artifactPath}`);
  const artifact = readFileSync(artifactPath);
  assert.ok(artifact.length > 0, `Packaged artifact is empty: ${artifactPath}`);
  if (artifactPath.endsWith(".exe")) assert.equal(artifact.subarray(0, 2).toString(), "MZ", "Windows installer is not a PE executable");
  if (artifactPath.endsWith(".AppImage")) assert.equal(artifact.subarray(0, 4).toString(), "\x7fELF", "Linux AppImage is not an ELF executable");
  if (artifactPath.endsWith(".deb")) assert.equal(artifact.subarray(0, 8).toString(), "!<arch>\n", "Linux package is not an ar archive");
  console.log(`Verified packaged artifact: ${artifactPath}`);
  process.exit(0);
}

const appRoot = artifactPath;
const infoPlistPath = join(appRoot, "Contents", "Info.plist");
const packagedIconPath = join(appRoot, "Contents", "Resources", "icon.icns");
const sourceIconPath = "build/icon.icns";

function readPlistAsJson(path) {
  const output = execFileSync("plutil", ["-convert", "json", "-o", "-", path], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function md5(path) {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

assert.ok(existsSync(appRoot), `Packaged app not found: ${appRoot}`);
assert.ok(existsSync(infoPlistPath), `Info.plist not found: ${infoPlistPath}`);
assert.ok(existsSync(packagedIconPath), `Packaged icon not found: ${packagedIconPath}`);
assert.ok(existsSync(sourceIconPath), `Source icon not found: ${sourceIconPath}`);

const plist = readPlistAsJson(infoPlistPath);

assert.equal(plist.CFBundleDisplayName, "codex-switcher");
assert.equal(plist.CFBundleName, "codex-switcher");
assert.equal(plist.CFBundleExecutable, "codex-switcher");
assert.equal(plist.CFBundleIdentifier, "com.wangxt.codex-switcher");
assert.equal(plist.CFBundleIconFile, "icon.icns");
assert.equal(md5(packagedIconPath), md5(sourceIconPath), "Packaged icon does not match build/icon.icns");

if (process.platform === "darwin") {
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appRoot,
  ], { stdio: "inherit" });
}

console.log(`Verified packaged app: ${appRoot}`);
