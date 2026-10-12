import readline from "node:readline";
import { createOurFreeModelProvider } from "./plugin-core.mjs";

const provider = createOurFreeModelProvider();
const rl = readline.createInterface({ input: process.stdin });

function send(id, result, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error: { code: -32000, message: error } } : { result }) })}\n`);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  try {
    const params = request.params ?? {};
    if (request.method === "plugin.describe") return send(request.id, { kinds: ["provider"] });
    if (request.method === "provider.describe") return send(request.id, { provider: provider.describe() });
    if (request.method === "provider.models") return send(request.id, { models: await provider.models({ account: object(params.account, "account"), secret: params.secret, secretRef: params.secretRef, settings: object(params.settings ?? {}, "settings") }) });
    if (request.method === "provider.quota") return send(request.id, await provider.quota({ account: object(params.account, "account"), secret: params.secret, secretRef: params.secretRef, settings: object(params.settings ?? {}, "settings") }));
    if (request.method === "provider.request") return send(request.id, await provider.request({ account: object(params.account, "account"), secret: String(params.secret ?? ""), protocol: params.protocol, url: String(params.url ?? ""), method: String(params.method ?? "GET"), headers: object(params.headers ?? {}, "headers"), body: params.body, settings: object(params.settings ?? {}, "settings") }));
    if (request.method === "provider.refresh") return send(request.id, await provider.refresh(params));
    if (request.method === "provider.revoke") return send(request.id, await provider.revoke(params));
    throw new Error(`Unknown plugin method '${request.method}'`);
  } catch (error) {
    send(request?.id ?? "unknown", undefined, error instanceof Error ? error.message : String(error));
  }
});
