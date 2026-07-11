import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCliAutoResumeSettings, saveCliAutoResumeSettings } from "./desktop-settings.js";

test("CLI auto resume settings default to disabled and session one", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-settings-"));
  assert.deepEqual(await readCliAutoResumeSettings(join(root, "settings.json")), { enabled: false, sessionNumber: 1 });
});

test("CLI auto resume settings persist without removing tool paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-settings-save-"));
  const path = join(root, "settings.json");
  await writeFile(path, JSON.stringify({ cliPath: "/bin/codex" }));
  assert.deepEqual(await saveCliAutoResumeSettings(path, { enabled: true, sessionNumber: 3 }), { enabled: true, sessionNumber: 3 });
  assert.equal(JSON.parse(await readFile(path, "utf8")).cliPath, "/bin/codex");
});
