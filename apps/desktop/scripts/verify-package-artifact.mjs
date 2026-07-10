import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const appRoot = process.argv[2] || "release/mac-arm64/codex-switcher.app";
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

console.log(`Verified packaged app: ${appRoot}`);
