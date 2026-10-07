import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeFileAtomically } from "./atomic-file.js";

test("core atomic file writes replace content without leaving temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-atomic-file-"));
  try {
    const path = join(root, "nested", "state.json");
    await writeFileAtomically(path, "first\n", { encoding: "utf8", mode: 0o600 });
    await writeFileAtomically(path, "second\n", { encoding: "utf8", mode: 0o600 });
    assert.equal(await readFile(path, "utf8"), "second\n");
    assert.deepEqual(await readdir(join(root, "nested")), ["state.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
