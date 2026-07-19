import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = join(
  process.cwd(),
  "resources",
  "skills",
  "recover-codex-generated-images",
  "scripts",
  "recover_current_image.py",
);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function fixture(records: unknown[]) {
  const codexHome = await mkdtemp(join(tmpdir(), "recover-codex-image-"));
  const sessionId = "019f-test-session";
  const sessionDir = join(codexHome, "sessions", "2026", "07", "19");
  await mkdir(sessionDir, { recursive: true });
  const transcript = join(sessionDir, `rollout-test-${sessionId}.jsonl`);
  await writeFile(transcript, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  return { codexHome, sessionId };
}

async function run(codexHome: string, sessionId: string) {
  const { stdout } = await execFileAsync("python3", [script, "--session-id", sessionId, "--json"], {
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  return JSON.parse(stdout) as { status: string; path?: string; call_id?: string; code?: string };
}

test("recovers a generating image result into the native generated_images path", async () => {
  const { codexHome, sessionId } = await fixture([
    { payload: { type: "message", role: "user", content: [{ type: "input_text", text: "生成图片" }] } },
    { payload: { type: "image_generation_call", id: "ig_current", status: "generating", result: png.toString("base64") } },
  ]);
  const result = await run(codexHome, sessionId);
  const expected = join(codexHome, "generated_images", sessionId, "ig_current.png");
  assert.deepEqual(result, { status: "recovered", path: await realpath(expected), call_id: "ig_current" });
  assert.deepEqual(await readFile(expected), png);
});

test("reuses a valid official saved_path without copying it", async () => {
  const { codexHome, sessionId } = await fixture([]);
  const official = join(codexHome, "official.png");
  await writeFile(official, png);
  const sessionDir = join(codexHome, "sessions", "2026", "07", "19");
  await writeFile(
    join(sessionDir, `rollout-official-${sessionId}.jsonl`),
    [
      { payload: { type: "message", role: "user" } },
      { payload: { type: "image_generation_call", id: "ig_official", status: "completed", saved_path: official } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
  assert.deepEqual(await run(codexHome, sessionId), {
    status: "official",
    path: await realpath(official),
    call_id: "ig_official",
  });
});

test("does not return an image from an earlier user turn", async () => {
  const { codexHome, sessionId } = await fixture([
    { payload: { type: "message", role: "user", content: [{ type: "input_text", text: "第一次" }] } },
    { payload: { type: "image_generation_call", id: "ig_old", status: "generating", result: png.toString("base64") } },
    { payload: { type: "message", role: "user", content: [{ type: "input_text", text: "第二次失败" }] } },
  ]);
  assert.deepEqual(await run(codexHome, sessionId), { status: "no_result" });
});

test("refuses to overwrite a different native file and still exits normally", async () => {
  const { codexHome, sessionId } = await fixture([
    { payload: { type: "message", role: "user" } },
    { payload: { type: "image_generation_call", id: "ig_conflict", status: "generating", result: png.toString("base64") } },
  ]);
  const output = join(codexHome, "generated_images", sessionId, "ig_conflict.png");
  await mkdir(join(codexHome, "generated_images", sessionId), { recursive: true });
  await writeFile(output, "different");
  assert.deepEqual(await run(codexHome, sessionId), {
    status: "error",
    code: "conflicting_existing_file",
    call_id: "ig_conflict",
  });
});
