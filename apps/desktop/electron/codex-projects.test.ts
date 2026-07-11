import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findCodexResumeSession, readCodexProjects } from "./codex-projects.js";

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

test("findCodexResumeSession filters by cwd and selects the nth most recently active session", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-resume-"));
  const project = join(root, "project");
  const other = join(root, "other");
  const sessions = join(root, "sessions", "2026", "07", "11");
  await mkdir(project);
  await mkdir(other);
  await mkdir(sessions, { recursive: true });
  const records = [
    { id: "session-a", cwd: project, updatedAt: "2026-07-11T10:00:00Z" },
    { id: "session-b", cwd: project, updatedAt: "2026-07-11T12:00:00Z" },
    { id: "session-other", cwd: other, updatedAt: "2026-07-11T13:00:00Z" },
  ];
  for (const record of records) {
    await writeFile(join(sessions, `${record.id}.jsonl`), `${JSON.stringify({
      timestamp: record.updatedAt,
      type: "session_meta",
      payload: { id: record.id, cwd: record.cwd, timestamp: record.updatedAt },
    })}\n`);
  }
  await writeFile(join(root, "session_index.jsonl"), records.map((record) => JSON.stringify({
    id: record.id,
    updated_at: record.updatedAt,
  })).join("\n"));

  assert.equal((await findCodexResumeSession(root, project, 1))?.id, "session-b");
  assert.equal((await findCodexResumeSession(root, project, 2))?.id, "session-a");
  assert.equal(await findCodexResumeSession(root, project, 3), undefined);
});

test("findCodexResumeSession skips corrupt session files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-resume-corrupt-"));
  await mkdir(join(root, "sessions"));
  await writeFile(join(root, "sessions", "broken.jsonl"), "not-json\n");
  assert.equal(await findCodexResumeSession(root, root, 1), undefined);
});
