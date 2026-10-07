import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/verify-sandbox-evidence.mjs <evidence.json>");
  process.exit(2);
}

let value;
try {
  value = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  console.error(`invalid sandbox evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const expectedSandbox = {
  darwin: "macos-sandbox-exec",
  linux: "linux-bubblewrap",
  win32: "windows-app-container",
};
const checks = ["writeDenied", "homeReadDenied", "networkDenied", "markerAbsent"];
const valid = isRecord(value)
  && value.schemaVersion === 1
  && typeof value.platform === "string"
  && Object.hasOwn(expectedSandbox, value.platform)
  && value.sandbox === expectedSandbox[value.platform]
  && typeof value.nodeVersion === "string"
  && value.passed === true
  && isRecord(value.checks)
  && checks.every((key) => value.checks[key] === true)
  && (value.platform !== "win32" || value.checks.filesystemWriteGranted === true)
  && !containsSecretLikeValue(value);

if (!valid) {
  console.error("sandbox evidence did not satisfy the fail-closed schema");
  process.exit(1);
}

console.log(`sandbox evidence verified: ${value.platform}/${value.sandbox}`);

function isRecord(candidate) {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

function containsSecretLikeValue(candidate) {
  if (Array.isArray(candidate)) return candidate.some(containsSecretLikeValue);
  if (!isRecord(candidate)) return typeof candidate === "string" && /(sk-[A-Za-z0-9]|access_token|bearer\s+)/i.test(candidate);
  return Object.entries(candidate).some(([key, child]) => {
    if (/(token|secret|password|credential|api.?key)/i.test(key)) return true;
    return containsSecretLikeValue(child);
  });
}
