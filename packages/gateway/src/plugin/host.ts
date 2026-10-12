import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { buildPluginLaunchSpec, type PluginSandboxOptions } from "./sandbox.js";

export const PLUGIN_PROTOCOL_VERSION = 2;
export const SUPPORTED_PLUGIN_PROTOCOL_VERSIONS = [1, PLUGIN_PROTOCOL_VERSION] as const;
export const MAX_PLUGIN_FRAME_BYTES = 1024 * 1024;

export interface GatewayPluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
  permissions: PluginPermission[];
  kind?: PluginKind[];
  description?: string;
  author?: string;
  homepage?: string;
  icon?: string;
  providers?: PluginProviderDeclaration[];
  settingsSchema?: PluginSettingsSchema;
  trust?: PluginTrustLevel;
  signature?: string;
  checksum?: string;
}

export type PluginKind = "provider" | "middleware";
export type PluginTrustLevel = "official" | "verified" | "community" | "local";
export type PluginPermission = "provider" | "middleware" | "agent" | "usage" | "network" | "filesystem" | "secrets";

export interface PluginProviderDeclaration {
  id: string;
  displayName: string;
  icon?: string;
  authMethods?: string[];
  protocols?: string[];
}

export interface PluginSettingsSchema {
  type: "object";
  properties: Record<string, PluginSettingsProperty>;
  required?: string[];
}

export interface PluginSettingsProperty {
  type: "string" | "number" | "integer" | "boolean" | "select";
  title: string;
  description?: string;
  secret?: boolean;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  minimum?: number;
  maximum?: number;
}

export interface PluginRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface PluginRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface PluginTransport {
  send(request: PluginRpcRequest): Promise<PluginRpcResponse>;
  /** Cancel a request that exceeded the host deadline when the transport can release it. */
  cancel?(requestId: string): void;
  close(): Promise<void>;
}

export type PluginLogSink = (line: string) => void;

export interface PluginHostOptions {
  timeoutMs?: number;
  maxConcurrent?: number;
  maxQueue?: number;
  manifest?: GatewayPluginManifest;
  allowedPermissions?: readonly PluginPermission[];
  /** Shared across hosts to cap total in-flight plugin RPCs. */
  concurrencyLimiter?: PluginConcurrencyLimiter;
}

export interface PluginConcurrencyLimiterOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

/**
 * Bounds plugin RPC work across all ProviderPlugin hosts in one Gateway
 * runtime. Per-plugin limits still apply in PluginHost; this limiter prevents
 * several otherwise-healthy plugins from exhausting the Gateway together.
 */
export class PluginConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private active = 0;
  private closed = false;
  private readonly queue: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void }> = [];

  constructor(options: PluginConcurrencyLimiterOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 16);
    this.maxQueue = Math.max(0, options.maxQueue ?? 128);
  }

  acquire(): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error("Plugin concurrency limiter is closed"));
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new Error("Plugin global concurrency queue is full"));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("Plugin concurrency limiter is closed");
    while (this.queue.length) this.queue.shift()!.reject(error);
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.pump();
    };
  }

  private pump(): void {
    while (!this.closed && this.active < this.maxConcurrent && this.queue.length) {
      const item = this.queue.shift()!;
      this.active += 1;
      item.resolve(this.createRelease());
    }
  }
}

export function validatePluginManifest(value: unknown): value is GatewayPluginManifest {
  if (!isRecord(value)) return false;
  if (!/^[a-z][a-z0-9._-]{1,63}$/.test(String(value.id))) return false;
  if (typeof value.name !== "string" || !value.name.trim()) return false;
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version)) return false;
  if (!SUPPORTED_PLUGIN_PROTOCOL_VERSIONS.includes(value.apiVersion as 1 | 2) || typeof value.entry !== "string" || !isSafePluginEntry(value.entry)) return false;
  if (!Array.isArray(value.permissions) || value.permissions.some((permission) => !["provider", "middleware", "agent", "usage", "network", "filesystem", "secrets"].includes(String(permission)))) return false;
  if (value.kind !== undefined && (!Array.isArray(value.kind) || value.kind.length === 0 || value.kind.some((kind) => kind !== "provider" && kind !== "middleware"))) return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.author !== undefined && typeof value.author !== "string") return false;
  if (value.homepage !== undefined && typeof value.homepage !== "string") return false;
  if (value.icon !== undefined && typeof value.icon !== "string") return false;
  if (value.trust !== undefined && !["official", "verified", "community", "local"].includes(String(value.trust))) return false;
  if (value.providers !== undefined && (!Array.isArray(value.providers) || value.providers.some((provider) => !isRecord(provider) || typeof provider.id !== "string" || !/^[a-z][a-z0-9._-]{1,63}$/.test(provider.id) || typeof provider.displayName !== "string" || !provider.displayName.trim()))) return false;
  if (value.settingsSchema !== undefined && !isSettingsSchema(value.settingsSchema)) return false;
  if (value.signature !== undefined && typeof value.signature !== "string") return false;
  return value.checksum === undefined || typeof value.checksum === "string" && /^sha256:[a-f0-9]{64}$/i.test(value.checksum);
}

export function requiredPluginPermission(method: string): PluginPermission {
  const prefix = method.split(/[.:/]/, 1)[0]?.toLowerCase();
  if (prefix === "agent") return "agent";
  if (prefix === "usage") return "usage";
  if (prefix === "middleware" || prefix === "hook") return "middleware";
  if (prefix === "network") return "network";
  if (prefix === "filesystem" || prefix === "fs") return "filesystem";
  if (prefix === "secrets" || prefix === "secret") return "secrets";
  return "provider";
}

export class PluginPermissionError extends Error {
  constructor(public readonly permission: PluginPermission, method: string) {
    super("Plugin method '" + method + "' requires permission '" + permission + "'");
    this.name = "PluginPermissionError";
  }
}

export function encodePluginFrame(value: PluginRpcRequest | PluginRpcResponse): string {
  const encoded = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(encoded, "utf8") > MAX_PLUGIN_FRAME_BYTES) throw new Error("Plugin frame exceeds size limit");
  return encoded;
}

export function decodePluginFrame(value: string): PluginRpcRequest | PluginRpcResponse {
  if (Buffer.byteLength(value, "utf8") > MAX_PLUGIN_FRAME_BYTES) throw new Error("Plugin frame exceeds size limit");
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.id !== "string") throw new Error("Invalid plugin frame");
  return parsed as unknown as PluginRpcRequest | PluginRpcResponse;
}

export class PluginHost {
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private active = 0;
  private readonly queue: Array<{ request: PluginRpcRequest; resolve: (response: PluginRpcResponse) => void; reject: (error: Error) => void }> = [];
  private readonly manifest?: GatewayPluginManifest;
  private readonly allowedPermissions: ReadonlySet<PluginPermission>;
  private readonly concurrencyLimiter?: PluginConcurrencyLimiter;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly transport: PluginTransport, options: PluginHostOptions = {}) {
    this.timeoutMs = Math.max(10, options.timeoutMs ?? 10_000);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 4);
    this.maxQueue = Math.max(0, options.maxQueue ?? 32);
    this.manifest = options.manifest;
    this.allowedPermissions = new Set(options.allowedPermissions ?? options.manifest?.permissions ?? []);
    this.concurrencyLimiter = options.concurrencyLimiter;
  }

  call(method: string, params?: Record<string, unknown>): Promise<PluginRpcResponse> {
    return this.callWithPermission(method, params, requiredPluginPermission(method));
  }

  /**
   * Some provider lifecycle calls carry a secret resolved by the host. They
   * must opt into the stronger `secrets` permission explicitly; a provider
   * plugin cannot receive credential material merely because it can call a
   * normal provider method.
   */
  callWithPermission(method: string, params: Record<string, unknown> | undefined, permission: PluginPermission): Promise<PluginRpcResponse> {
    if (this.closed) return Promise.reject(new Error("Plugin host is closed"));
    if (this.manifest && (!this.manifest.permissions.includes(permission) || !this.allowedPermissions.has(permission))) {
      return Promise.reject(new PluginPermissionError(permission, method));
    }
    if (this.queue.length >= this.maxQueue && this.active >= this.maxConcurrent) return Promise.reject(new Error("Plugin host queue is full"));
    const request: PluginRpcRequest = { jsonrpc: "2.0", id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, method, ...(params ? { params } : {}) };
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const error = new Error("Plugin host is closed");
    while (this.queue.length) this.queue.shift()!.reject(error);
    this.closePromise = this.transport.close();
    await this.closePromise;
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const item = this.queue.shift()!;
      this.active += 1;
      void this.execute(item).finally(() => { this.active -= 1; this.pump(); });
    }
  }

  private async execute(item: typeof this.queue[number]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let release: (() => void) | undefined;
    try {
      release = await this.concurrencyLimiter?.acquire();
      const response = await Promise.race([
        this.transport.send(item.request),
        new Promise<PluginRpcResponse>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error("Plugin host request timed out"));
          }, this.timeoutMs);
        }),
      ]);
      if (response.error) item.reject(new Error(`${response.error.code}: ${response.error.message}`));
      else item.resolve(response);
    } catch (error) {
      if (timedOut) this.transport.cancel?.(item.request.id);
      item.reject(error instanceof Error ? error : new Error(String(error)));
    }
    finally {
      if (timer) clearTimeout(timer);
      release?.();
    }
  }
}

export class ProcessPluginTransport implements PluginTransport {
  private readonly pending = new Map<string, { resolve: (value: PluginRpcResponse) => void; reject: (error: Error) => void; bytes: number }>();
  private readonly maxPendingBytes: number;
  private pendingBytes = 0;
  private buffer = "";
  private writeChain: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;
  private closing = false;
  private stderrTail = "";

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly maxPending = 128,
    maxPendingBytes = MAX_PLUGIN_FRAME_BYTES * 4,
    private readonly log?: PluginLogSink,
  ) {
    this.maxPendingBytes = Math.max(1, maxPendingBytes);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.on("data", (chunk: string) => {
      const sanitized = redactPluginLog(chunk);
      if (!sanitized) return;
      this.stderrTail = `${this.stderrTail} ${sanitized}`.trim().slice(-4096);
      this.log?.(sanitized);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${String(code)}`;
      const detail = this.stderrTail ? `: ${this.stderrTail}` : "";
      this.failAll(new Error(this.closing ? "Plugin process closed" : `Plugin process exited with ${reason}${detail}`));
    });
  }

  static start(
    manifest: GatewayPluginManifest,
    cwd: string,
    environment: Record<string, string> = {},
    sandboxOptions: PluginSandboxOptions = {},
    log?: PluginLogSink,
  ): ProcessPluginTransport {
    const launch = buildPluginLaunchSpec(manifest, cwd, sandboxOptions);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: buildPluginProcessEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new ProcessPluginTransport(child, 128, MAX_PLUGIN_FRAME_BYTES * 4, log);
  }

  send(request: PluginRpcRequest): Promise<PluginRpcResponse> {
    const frame = encodePluginFrame(request);
    const frameBytes = Buffer.byteLength(frame, "utf8");
    return new Promise((resolve, reject) => {
      if (this.pending.size >= this.maxPending) {
        reject(new Error("Plugin host pending request limit reached"));
        return;
      }
      if (this.pendingBytes + frameBytes > this.maxPendingBytes) {
        reject(new Error("Plugin host pending request bytes limit reached"));
        return;
      }
      this.pending.set(request.id, { resolve, reject, bytes: frameBytes });
      this.pendingBytes += frameBytes;
      this.writeChain = this.writeChain.then(() => this.writeFrame(frame)).catch((error) => {
        const pending = this.pending.get(request.id);
        if (!pending) return;
        this.pending.delete(request.id);
        this.pendingBytes -= pending.bytes;
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.pendingBytes -= pending.bytes;
    pending.reject(new Error("Plugin request cancelled"));
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.failAll(new Error("Plugin transport closed"));

    // Closing stdin lets a well-behaved plugin run its async cleanup handler
    // (including releasing managed-service locks) before the next version is
    // started. The old implementation sent SIGTERM and returned immediately,
    // which made plugin updates race the previous process' shutdown.
    this.closePromise = new Promise<void>((resolve) => {
      const child = this.child;
      const hasEventApi = typeof (child as ChildProcessWithoutNullStreams & { once?: unknown }).once === "function";
      if (!hasEventApi) {
        if (!child.killed) child.kill();
        resolve();
        return;
      }

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        child.off("exit", finish);
        child.off("error", finish);
        resolve();
      };

      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }
      child.once("exit", finish);
      child.once("error", finish);
      try {
        child.stdin.end();
      } catch {
        // A closed stdin is equivalent to an already-closing child. The
        // timeout below still guarantees that a misbehaving plugin cannot
        // block an update forever.
      }
      timer = setTimeout(() => {
        if (settled) return;
        if (!child.killed) child.kill();
        forceTimer = setTimeout(finish, 250);
        forceTimer.unref?.();
      }, 2_000);
      timer.unref?.();
    });
    await this.closePromise;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_PLUGIN_FRAME_BYTES * 2) { this.failAll(new Error("Plugin output buffer exceeds size limit")); return; }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = decodePluginFrame(line) as PluginRpcResponse;
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);
        this.pendingBytes -= pending.bytes;
        pending.resolve(response);
      } catch (error) { this.failAll(error instanceof Error ? error : new Error(String(error))); }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.pendingBytes = 0;
  }

  private writeFrame(frame: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.child.stdin.off("drain", onDrain);
        this.child.stdin.off("error", onError);
      };
      const onDrain = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      this.child.stdin.once("error", onError);
      try {
        const accepted = this.child.stdin.write(frame, "utf8");
        if (accepted) onDrain();
        else this.child.stdin.once("drain", onDrain);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

/**
 * Electron's process.execPath is the Electron binary rather than node. The
 * child must opt into Electron's Node-compatible mode, while standalone Node
 * callers keep a minimal environment and never inherit host secrets.
 */
export function buildPluginProcessEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...overrides,
  };
}

export function redactPluginLog(value: string): string {
  return value
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie)\s*[=:]\s*)(?:Bearer\s+)?["']?[^\s,"']+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g, "sk-[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4096);
}

export class RestartingPluginTransport implements PluginTransport {
  private current: PluginTransport | undefined;
  private restarts = 0;
  private closed = false;

  constructor(
    private readonly factory: (attempt: number) => Promise<PluginTransport> | PluginTransport,
    private readonly maxRestarts = 2,
  ) {}

  async send(request: PluginRpcRequest): Promise<PluginRpcResponse> {
    if (this.closed) throw new Error("Plugin transport is closed");
    try {
      return await this.transport().then((transport) => transport.send(request));
    } catch (error) {
      if (this.closed || this.restarts >= this.maxRestarts) throw error;
      this.restarts += 1;
      await this.current?.close().catch(() => undefined);
      this.current = await this.factory(this.restarts);
      return this.current.send(request);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.current?.close();
    this.current = undefined;
  }

  cancel(requestId: string): void { this.current?.cancel?.(requestId); }

  private async transport(): Promise<PluginTransport> {
    if (!this.current) this.current = await this.factory(0);
    return this.current;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function isSettingsSchema(value: unknown): value is PluginSettingsSchema {
  if (!isRecord(value) || value.type !== "object" || !isRecord(value.properties)) return false;
  return Object.values(value.properties).every((property) => {
    if (!isRecord(property) || typeof property.title !== "string") return false;
    if (!["string", "number", "integer", "boolean", "select"].includes(String(property.type))) return false;
    if (property.secret !== undefined && typeof property.secret !== "boolean") return false;
    if (property.options !== undefined && (!Array.isArray(property.options) || property.options.some((option) => !isRecord(option) || typeof option.label !== "string" || typeof option.value !== "string"))) return false;
    return true;
  });
}

function isSafePluginEntry(value: string): boolean {
  const entry = value.trim();
  if (!entry || entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(entry)) return false;
  return entry.split(/[\\/]+/).every((part) => part.length > 0 && part !== "." && part !== "..");
}
