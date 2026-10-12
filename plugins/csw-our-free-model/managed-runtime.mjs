import fs from "node:fs";
import path from "node:path";
import { startStandalone } from "./vendor/ofm/packages/standalone/service.mjs";

/**
 * Owns the embedded Our Free Model service for the lifetime of the provider
 * plugin process. This mirrors Magpie's managed runtime: the plugin starts a
 * loopback-only service, reads the generated forward key, and exposes the
 * resulting connection to the provider adapter.
 */
export function createManagedRuntime(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = path.resolve(
    env.CSW_OUR_FREE_MODEL_DATA_DIR?.trim() || env.CODEX_SWITCHER_PLUGIN_DATA_DIR?.trim() || path.join(cwd, ".our-free-model"),
  );
  const configuredPort = parsePort(env.CSW_OUR_FREE_MODEL_PORT);
  const logger = options.logger ?? { info() {}, warn() {}, error() {} };
  let service;
  let attachedConnection;
  let ownsService = false;
  let starting;

  async function ensure() {
    if (service || attachedConnection) return connection();
    if (starting) return starting;
    starting = (async () => {
      const existing = await attachExistingService(dataDir, fetchImpl);
      if (existing) {
        attachedConnection = existing;
        return existing;
      }
      recoverStaleLock(dataDir);
      try {
        service = await startStandalone({
          dataDir,
          host: "127.0.0.1",
          port: configuredPort,
          refresh: true,
          logger,
          parentPid: process.pid,
        });
        ownsService = true;
      } catch (error) {
        // Another plugin host may have won the startup race after the first
        // health check. Attach to it instead of treating the shared service
        // lock as a provider failure.
        const existing = await waitForExistingService(dataDir, fetchImpl);
        if (!existing) throw error;
        attachedConnection = existing;
        return existing;
      }
      return connection();
    })().catch((error) => {
      service = undefined;
      attachedConnection = undefined;
      ownsService = false;
      throw error;
    }).finally(() => {
      starting = undefined;
    });
    return starting;
  }

  function connection() {
    if (attachedConnection) return attachedConnection;
    if (!service) throw new Error("Our Free Model service is not running");
    const settings = JSON.parse(fs.readFileSync(service.keyFile, "utf8"));
    if (typeof settings.forwardKey !== "string" || !settings.forwardKey.trim()) {
      throw new Error("Our Free Model service did not provide a forward key");
    }
    return {
      baseUrl: `${service.url}/v1`,
      key: settings.forwardKey,
      managementUrl: service.managementUrl,
      port: service.port,
    };
  }

  async function models(signal) {
    const current = await ensure();
    const response = await fetchImpl(`${current.baseUrl}/models`, {
      headers: { accept: "application/json", authorization: `Bearer ${current.key}` },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Our Free Model catalogue returned HTTP ${response.status}`);
    }
    return response.json();
  }

  async function request(input) {
    const current = await ensure();
    const url = resolveLocalUrl(input.url, current.baseUrl);
    const headers = new Headers(input.headers ?? {});
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${current.key}`);
    if (input.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetchImpl(url, {
      method: input.method,
      headers,
      ...(input.body !== undefined ? { body: input.body } : {}),
      redirect: "manual",
      signal: input.signal,
    });
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (contentType.toLowerCase().includes("text/event-stream")) {
      return { status: response.status, headers: responseHeaders, events: parseSseEvents(text) };
    }
    if (!text.trim()) return { status: response.status, headers: responseHeaders };
    try {
      const payload = JSON.parse(text);
      return {
        status: response.status,
        headers: responseHeaders,
        body: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { data: payload },
      };
    } catch {
      return { status: response.status, headers: responseHeaders, body: { error: { message: text.slice(0, 16_384) } } };
    }
  }

  async function close() {
    if (starting) await starting.catch(() => undefined);
    if (!service || !ownsService) {
      attachedConnection = undefined;
      return;
    }
    const current = service;
    service = undefined;
    ownsService = false;
    await current.close();
  }

  return { ensure, models, request, connection, close, dataDir };
}

async function attachExistingService(dataDir, fetchImpl) {
  const candidate = readExistingServiceConnection(dataDir);
  if (!candidate) return undefined;
  try {
    const response = await fetchImpl(`${candidate.origin}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function waitForExistingService(dataDir, fetchImpl) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await attachExistingService(dataDir, fetchImpl);
    if (existing) return existing;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return undefined;
}

function readExistingServiceConnection(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dataDir, "service.lock"), "utf8"));
    if (lock?.product !== "our-free-model-standalone" || !Number.isInteger(lock?.pid) || lock.pid <= 0) return undefined;
    try {
      process.kill(lock.pid, 0);
    } catch {
      return undefined;
    }
    const settings = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    const port = Number(settings?.standalonePort);
    const key = typeof settings?.forwardKey === "string" ? settings.forwardKey.trim() : "";
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !key) return undefined;
    const origin = `http://127.0.0.1:${port}`;
    return { origin, baseUrl: `${origin}/v1`, key, managementUrl: origin, port };
  } catch {
    return undefined;
  }
}

function parsePort(value) {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("CSW_OUR_FREE_MODEL_PORT must be between 0 and 65535");
  return port;
}

function recoverStaleLock(dataDir) {
  const lockFile = path.join(dataDir, "service.lock");
  if (!fs.existsSync(lockFile)) return;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    if (lock?.product !== "our-free-model-standalone" || !Number.isInteger(lock?.pid) || lock.pid <= 0) return;
    try {
      process.kill(lock.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") fs.unlinkSync(lockFile);
    }
  } catch {
    // Keep malformed or unreadable locks in place. The standalone service will
    // fail closed instead of guessing that another process is dead.
  }
}

function resolveLocalUrl(input, base) {
  const incoming = new URL(input);
  const target = new URL(base);
  const marker = incoming.pathname.indexOf("/v1");
  const suffix = marker >= 0 ? incoming.pathname.slice(marker + 3) : incoming.pathname;
  target.pathname = `/v1${suffix.startsWith("/") ? suffix : `/${suffix}`}`.replace(/\/+/g, "/");
  target.search = incoming.search;
  return target.toString();
}

function parseSseEvents(text) {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return [];
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}
