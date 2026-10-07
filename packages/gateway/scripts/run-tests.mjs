import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [];
await collectTests(join(gatewayRoot, "src"));
testFiles.sort((left, right) => left.localeCompare(right));
if (!testFiles.length) throw new Error("No Gateway test files were found");

const tsxCli = resolve(gatewayRoot, "../../node_modules/tsx/dist/cli.mjs");
const child = spawn(process.execPath, [
  tsxCli,
  "--test",
  "--test-concurrency=1",
  ...testFiles.map((path) => relative(gatewayRoot, path)),
], { cwd: gatewayRoot, stdio: "inherit" });

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Gateway test runner terminated by ${signal}`);
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
