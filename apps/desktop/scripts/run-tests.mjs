import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoots = [join(desktopRoot, "electron"), join(desktopRoot, "src")];
const testFiles = [];

for (const root of testRoots) await collectTests(root);
testFiles.sort((left, right) => left.localeCompare(right));
if (!testFiles.length) throw new Error("No desktop test files were found");

const loader = resolve(desktopRoot, "../../node_modules/tsx/dist/loader.mjs");
const child = spawn(process.execPath, [
  "--import", loader,
  "--test",
  "--test-concurrency=1",
  ...testFiles.map((path) => relative(desktopRoot, path)),
], { cwd: desktopRoot, stdio: "inherit" });

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Desktop test runner terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});

async function collectTests(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectTests(path);
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) testFiles.push(path);
  }
}
