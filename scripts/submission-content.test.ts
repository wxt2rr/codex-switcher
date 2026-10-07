import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const prohibitedSequence = ["mag", "pie"].join("");
const ignoredDirectories = new Set([
  resolve(repoRoot, ".git"),
  resolve(repoRoot, "node_modules"),
  resolve(repoRoot, "apps/desktop/release"),
]);

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(resolve(path))) {
        files.push(...(await collectFiles(path)));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

test("submission files do not contain prohibited external terminology", async () => {
  const matches: string[] = [];
  for (const path of await collectFiles(repoRoot)) {
    const content = await readFile(path);
    if (content.includes(prohibitedSequence)) {
      matches.push(relative(repoRoot, path));
    }
  }

  assert.deepEqual(matches, [], "submission files contain prohibited external terminology");
});
