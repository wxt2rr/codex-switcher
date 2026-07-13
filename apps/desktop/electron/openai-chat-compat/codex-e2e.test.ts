import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeChatModel } from "./fake-chat-model.js";
import { startUsageRouterService } from "../usage-router-service.js";

const execFileAsync = promisify(execFile);

function runCodex(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += Buffer.from(chunk).toString(); });
    child.stderr.on("data", (chunk) => { stderr += Buffer.from(chunk).toString(); });
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Codex timed out. stdout=${stdout} stderr=${stderr}`)); }, options.timeoutMs);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`Codex exited ${code}. stdout=${stdout} stderr=${stderr}`)); });
  });
}

test("installed Codex consumes the compatibility router Responses contract", {
  skip: process.env.CODEX_SWITCHER_RUN_CODEX_E2E !== "1" ? "Set CODEX_SWITCHER_RUN_CODEX_E2E=1 to run the installed Codex contract" : false,
  timeout: 60_000,
}, async (context) => {
  let codex = "";
  try { codex = (await execFileAsync(process.platform === "win32" ? "where" : "which", ["codex"])).stdout.trim().split(/\r?\n/)[0] ?? ""; }
  catch { context.skip("No installed Codex executable"); return; }
  const root = await mkdtemp(join(tmpdir(), "codex-compat-e2e-"));
  const model = await startFakeChatModel();
  const router = await startUsageRouterService({ stateDir: join(root, "router"), adminToken: "admin" });
  try {
    const route = { routeId: "e2e", envName: "e2e", accountName: "fake", upstreamBaseUrl: model.baseUrl,
      originalBaseUrl: model.baseUrl, protocol: "chat_completions", reasoningProfile: "auto", enabled: true,
      createdAt: Date.now(), updatedAt: Date.now() };
    const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
    await fetch(`${router.origin}/admin/routes/e2e`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) });
    await fetch(`${router.origin}/admin/routes/e2e/secret`, { method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ upstreamApiKey: "sk-fake", localRouteToken: "local-e2e" }) });
    const home = join(root, "home"); await mkdir(home, { recursive: true });
    await writeFile(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "local-e2e" }));
    await writeFile(join(home, "config.toml"), `model = "fake-model"\nmodel_provider = "local"\n[model_providers.local]\nname = "local"\nbase_url = "${router.origin}/routes/e2e"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n`);
    const result = await runCodex(codex, ["exec", "--skip-git-repo-check", "--ephemeral", "Reply exactly E2E_OK"], {
      cwd: root, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "local-e2e" }, timeoutMs: 45_000,
    });
    assert.match(`${result.stdout}\n${result.stderr}`, /E2E_OK/);
  } finally { await router.close(); await model.close(); }
});
