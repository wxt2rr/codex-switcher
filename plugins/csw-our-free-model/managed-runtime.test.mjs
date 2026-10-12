import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

test("managed runtime starts a loopback service and closes it", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "csw-our-free-model-runtime-"));
  try {
    const script = `import { createManagedRuntime } from ${JSON.stringify(new URL("./managed-runtime.mjs", import.meta.url).href)};\nconst runtime = createManagedRuntime({ env: process.env });\nconst connection = await runtime.ensure();\nconst health = await fetch(connection.baseUrl.replace(/\\/v1$/, "") + "/health");\nif (health.status !== 200 || !connection.key.startsWith("ofm-")) process.exit(2);\nawait runtime.close();\nconsole.log(connection.baseUrl);`;
    const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, CSW_OUR_FREE_MODEL_DATA_DIR: dataDir, CSW_OUR_FREE_MODEL_PORT: "0" } });
    assert.match(result.stdout, /^http:\/\/127\.0\.0\.1:\d+\/v1\s*$/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
