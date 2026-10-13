import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const releaseDir = resolve(scriptDir, "..", "release");
const target = (process.argv[2] ?? "all").toLowerCase();

const rules = {
  mac: {
    directories: new Set(["mac", "mac-arm64"]),
    files: /(?:\.dmg|(?:-arm64)?-mac\.zip)(?:\.blockmap)?$/i,
  },
  win: {
    directories: new Set(["win-unpacked"]),
    files: /\.exe(?:\.blockmap)?$/i,
  },
  linux: {
    directories: new Set(["linux-unpacked"]),
    files: /\.(?:AppImage|deb)(?:\.blockmap)?$/i,
  },
  all: {
    directories: undefined,
    files: undefined,
  },
};

if (!(target in rules)) {
  throw new Error(`Unknown desktop release target: ${target}`);
}

const rule = rules[target];
let removed = 0;

try {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  for (const entry of entries) {
    const shouldRemove = target === "all"
      || (entry.isDirectory() && rule.directories?.has(entry.name))
      || (entry.isFile() && rule.files?.test(entry.name));
    if (!shouldRemove) continue;
    await rm(join(releaseDir, entry.name), { recursive: true, force: true });
    removed += 1;
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(`Prepared desktop release output (${target}); removed ${removed} previous artifact(s).`);
