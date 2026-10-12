import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const example = join(root, "examples", "plugins", "csw-demo");

test("SDK example speaks the real plugin JSONL protocol", async () => {
  const child = spawn(process.execPath, [join(example, "plugin.mjs")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const replies = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    for (const line of buffer.split("\n").slice(0, -1)) {
      if (line.trim()) replies.push(JSON.parse(line));
    }
    buffer = buffer.split("\n").at(-1) ?? "";
  });
  const send = (id, method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
  send("1", "plugin.describe");
  send("2", "provider.describe");
  send("3", "provider.models", { account: { accountId: "demo", secretRef: "demo", authMethod: "api_key", status: "active" }, secretRef: "demo" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SDK example did not answer")), 3000);
    const check = () => replies.length >= 3 ? (clearTimeout(timer), resolve()) : setTimeout(check, 10);
    check();
  });
  assert.deepEqual(replies[0].result.kinds, ["provider"]);
  assert.equal(replies[1].result.provider.id, "csw-demo-provider");
  assert.equal(replies[2].result.models[0].id, "demo-model");
  child.kill();
});
