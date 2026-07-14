import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildWindowsPackagedAppStopCommand,
  prepareWindowsPackagedAppHome,
} from "./windows-packaged-app-profile.js";

test("packaged App projection preserves and restores the default Codex home", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-msix-profile-"));
  const stateDir = join(root, "state");
  const defaultHome = join(root, ".codex");
  const projectHome = join(root, "project");
  try {
    await writeSnapshot(defaultHome, "default-config\n", "default-auth\n");
    await writeSnapshot(projectHome, "project-config\n", "project-auth\n");

    await prepareWindowsPackagedAppHome({
      stateDir,
      defaultHome,
      sourceHome: projectHome,
      materialize: async (home) => writeFile(join(home, "config.toml"), "project-materialized\n"),
    });
    assert.equal(await readFile(join(defaultHome, "config.toml"), "utf8"), "project-materialized\n");
    assert.equal(await readFile(join(defaultHome, "auth.json"), "utf8"), "project-auth\n");

    await prepareWindowsPackagedAppHome({
      stateDir,
      defaultHome,
      sourceHome: defaultHome,
      materialize: async (home) => writeFile(join(home, "config.toml"), "default-materialized\n"),
    });
    assert.equal(await readFile(join(defaultHome, "config.toml"), "utf8"), "default-materialized\n");
    assert.equal(await readFile(join(defaultHome, "auth.json"), "utf8"), "default-auth\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged App projection rolls back files when materialization fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-msix-profile-"));
  const defaultHome = join(root, ".codex");
  const projectHome = join(root, "project");
  try {
    await writeSnapshot(defaultHome, "default-config\n", "default-auth\n");
    await writeSnapshot(projectHome, "project-config\n", "project-auth\n");
    await assert.rejects(() => prepareWindowsPackagedAppHome({
      stateDir: join(root, "state"),
      defaultHome,
      sourceHome: projectHome,
      materialize: async () => { throw new Error("materialize failed"); },
    }), /materialize failed/);
    assert.equal(await readFile(join(defaultHome, "config.toml"), "utf8"), "default-config\n");
    assert.equal(await readFile(join(defaultHome, "auth.json"), "utf8"), "default-auth\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged App stop command targets known ChatGPT and Codex process names", () => {
  const spec = buildWindowsPackagedAppStopCommand();
  assert.equal(spec.command, "powershell.exe");
  assert.match(spec.args.join(" "), /ChatGPT,Codex,CodexApp/);
  assert.match(spec.args.join(" "), /Get-AppxPackage/);
  assert.match(spec.args.join(" "), /StartsWith\(\$pkgRoot/);
  assert.match(spec.args.join(" "), /Stop-Process -Force/);
});

async function writeSnapshot(home: string, config: string, auth: string): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "config.toml"), config, "utf8");
  await writeFile(join(home, "auth.json"), auth, "utf8");
}
