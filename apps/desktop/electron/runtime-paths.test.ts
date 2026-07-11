import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveRuntimeResource,
  resolveRuntimeRoot,
} from "./runtime-paths.js";

async function createCoreMarker(root: string): Promise<void> {
  const apiDir = join(root, "packages", "core", "dist", "api");
  await mkdir(apiDir, { recursive: true });
  await writeFile(join(apiDir, "core-api.js"), "export {};\n");
}

test("packaged runtime resolves resources outside app.asar", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-packaged-"));
  const resourcesPath = join(root, "resources");
  const currentFile = join(resourcesPath, "app.asar", "electron-dist", "electron", "bridge.cjs");
  await createCoreMarker(resourcesPath);

  assert.equal(
    resolveRuntimeRoot({ currentFile, resourcesPath }),
    resourcesPath,
  );
  assert.equal(
    resolveRuntimeResource(join("packages", "core", "dist"), { currentFile, resourcesPath }),
    join(resourcesPath, "packages", "core", "dist"),
  );
});

test("development runtime falls back to the source workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-workspace-"));
  const workspaceRoot = join(root, "repo");
  const currentFile = join(workspaceRoot, "apps", "desktop", "electron", "bridge.ts");
  await createCoreMarker(workspaceRoot);
  await writeFile(join(workspaceRoot, "package.json"), "{}\n");

  assert.equal(resolveRuntimeRoot({ currentFile }), workspaceRoot);
  assert.equal(
    resolveRuntimeResource(join("packages", "core", "dist"), { currentFile }),
    join(workspaceRoot, "packages", "core", "dist"),
  );
});
