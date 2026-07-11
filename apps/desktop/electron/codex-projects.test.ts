import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCodexProjects } from "./codex-projects.js";

test("readCodexProjects extracts existing project directories and sorts recent sessions first", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-projects-"));
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  await mkdir(alpha);
  await mkdir(beta);
  await writeFile(join(root, "config.toml"), [
    `[projects."${alpha}"]`,
    `trust_level = "trusted"`,
    `[projects."${beta}"]`,
    `trust_level = "trusted"`,
    `[projects."${join(root, "missing")}"]`,
    `trust_level = "trusted"`,
    `[projects."${alpha}"]`,
  ].join("\n"));
  await writeFile(join(root, "session_index.jsonl"), [
    JSON.stringify({ cwd: alpha, updated_at: "2026-07-10T10:00:00Z" }),
    JSON.stringify({ cwd: beta, updated_at: "2026-07-11T10:00:00Z" }),
    "not-json",
  ].join("\n"));

  assert.deepEqual(await readCodexProjects(root), [
    { path: beta, name: "beta", lastUsedAt: "2026-07-11T10:00:00.000Z" },
    { path: alpha, name: "alpha", lastUsedAt: "2026-07-10T10:00:00.000Z" },
  ]);
});

test("readCodexProjects tolerates missing configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-projects-empty-"));
  assert.deepEqual(await readCodexProjects(root), []);
});
